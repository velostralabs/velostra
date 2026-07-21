# Smart contract - VelostraEscrow

> Last verified against contracts/VelostraEscrow.sol and deployment status: 2026-07-20.
> Phase state: Phase 0-4 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> Status: local/Linux-CI EVM tested and deployed on Robinhood testnet chain 46630 with
> three verified Safe authorities plus a synthetic 6-decimal token; 23 live bytecode,
> receipt, role, event, token, and solvency checks pass. It is not independently
> audited and is not deployed to mainnet.
> The canonical public testnet frontend contains the verified public escrow/token
> identifiers and is bound to the managed chain-46630 API.
> Bounded wallet/claim reconciliation and read-only authority/solvency evidence passed
> on 2026-07-20; no custody mutation or mainnet authorization is implied. See
> [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md).

## Build

- Solidity 0.8.24;
- OpenZeppelin 5 `AccessControlDefaultAdminRules`, `Pausable`, `SafeERC20`, and
  `ReentrancyGuard`;
- optimizer enabled with 200 runs by the deploy script;
- Ganache + ethers E2E.

```bash
npm ci --prefix contracts
npm test --prefix contracts
```

## Constructor and deployment policy

```solidity
constructor(
    address settlementToken,
    uint16 platformFeeBps,
    address admin,
    address settler,
    address treasury,
    address pauseGuardian
)
```

- every address must be non-zero;
- deploy script requires admin, settler, treasury, and guardian to be distinct;
- admin must be a deployed multisig contract;
- settlement token is immutable and must report exactly 6 decimals;
- fee defaults to 1,000 bps in the deploy script and cannot exceed 5,000 bps;
- default-admin transfer delay is two days.

## Roles

| Role | Authority |
|---|---|
| `DEFAULT_ADMIN_ROLE` | grant/revoke roles, delayed admin transfer, unpause, successor declaration |
| `SETTLER_ROLE` | `creditBuilderEarnings` only |
| `TREASURY_ROLE` | withdraw platform revenue and migrate unencumbered liquidity |
| `PAUSER_ROLE` | pause only |
| `FEE_MANAGER_ROLE` | update fee within hard cap |

The backend signer cannot withdraw, change fee, pause, unpause, or administer roles.
The pause guardian cannot unpause or move funds.

## Accounting

```text
platformCut = floor(grossAmount * platformFeeBps / 10_000)
builderCut  = grossAmount - platformCut
totalLiabilities = totalBuilderLiability + platformRevenueAvailable
```

Before new earnings are credited:

```text
settlementToken.balanceOf(escrow) >= totalLiabilities + grossAmount
```

Claims and platform withdrawals reduce their matching liability before transfer.
`isSolvent()` verifies current token balance covers all explicit liabilities.
Fee-on-transfer deposits are rejected by an exact balance-delta check.

`userCreditBalance` and `totalDeposited` are cumulative audit counters. They are
not spendable authority and do not decrease when an offchain call is paid.

## Public and privileged functions

### `depositCredits(uint256 amount)`

Transfers an exact amount of the 6-decimal token, minimum `1e6`. Blocked while
paused or after successor declaration. Emits `Deposit`.

### `initializeBuilder()`

One-time onchain builder initialization. Blocked while paused/deprecated.

### `creditBuilderEarnings(address builder, uint256 grossAmount, bytes32 callId)`

Requires `SETTLER_ROLE`, initialized builder, positive gross, non-zero unused call
ID, active contract, and sufficient collateral. Marks call ID settled and emits:

```solidity
event EarningsCredited(
    address indexed builder,
    bytes32 indexed callId,
    uint256 amount,       // builder cut
    uint256 platformCut
);
```

Backend correlation is `callId = keccak256(bytes(agent_calls.id))`.

### `claimEarnings(uint256 amount)`

Builder claims available earnings. Claims intentionally remain enabled during
pause and after successor declaration so emergency controls cannot trap earned
funds.

### `withdrawPlatformRevenue(address to, uint256 amount)`

`TREASURY_ROLE` only; cannot exceed platform revenue available.

### `setPlatformFeeBps(uint16 value)`

FEE_MANAGER_ROLE only; maximum 50%. The backend treats the confirmed
EarningsCredited builder/platform amounts as authoritative, so an authorized
fee update cannot leave the offchain split stale.

### `pause()` / `unpause()`

Guardian pauses; governance alone unpauses. Pause blocks deposits, builder init,
and new settlement liabilities, not claims or existing platform withdrawal.

### `declareSuccessorEscrow(address successor)`

Governance only, while paused, one time. Permanently closes the predecessor to new
deposits and settlements.

### `migrateAvailableLiquidity()`

Treasury only and only after successor declaration. Transfers exactly:

```text
max(tokenBalance - totalLiabilities, 0)
```

The predecessor retains full backing for every builder/platform exit. Empty or
pre-declaration migration reverts.

## Indexed events

Worker consumes `Deposit`, `EarningsCredited`, `Claimed`, and
`PlatformRevenueWithdrawn`. Lifecycle/governance monitors should also watch
`BuilderInitialized`, `PlatformFeeUpdated`, `SuccessorEscrowDeclared`,
`AvailableLiquidityMigrated`, and OpenZeppelin role/pause events.

## Contract E2E evidence

Ten Phase 1 groups cover:

1. constructor roles, admin delay, and token policy;
2. exact/minimum deposits and cumulative counters;
3. builder lifecycle and role isolation;
4. correlated settlement and explicit liabilities;
5. duplicate call and undercollateralized settlement rejection;
6. pause behavior with claims preserved;
7. treasury/fee separation and hard cap;
8. settler rotation and revocation;
9. successor declaration, exact unencumbered migration, and predecessor exits;
10. lifetime accounting consistency.

## Guarded US staging deployment

The testnet path is isolated to Robinhood testnet chain 46630 and GCP us-east4.
Governance, treasury, and pause guardian must each be a canonical Safe 1.4.1 account
with exactly three disjoint owners and threshold two. The SETTLER role uses the
separate address derived from the managed secp256k1 KMS public key and must remain an
EOA. Arbitrary role EOAs, shared owner sets, wrong Safe versions/thresholds, contract
settlers, non-US configuration, dirty-tree broadcast, and mainnet chains fail closed.

Testnet owner/deployer keys are CSPRNG-generated and DPAPI-encrypted below ignored
artifacts; they are synthetic testnet custody and never qualify as mainnet governance.
The read-only preflight predicts the three Safes and verifies canonical factory code
without decrypting keys. Guarded wrappers then deploy/verify the Safes before a
6-decimal MockUSD and VelostraEscrow can be broadcast.

The verifier checks Safe owners/threshold/version and isolation plus receipt success,
runtime bytecode with immutable references, token decimals, fee, unpaused/solvent
state, unset successor, deployment block, and all constructor roles. Outputs stay
under ignored artifacts/staging. This path does not weaken or authorize mainnet.

## Guarded Phase 3 deployment

`deploy:robinhood` is no longer a plain environment-driven broadcast. It first
rebuilds the reproducible artifact and is inert unless `--broadcast` is supplied.
A broadcast additionally requires the explicit mainnet sentinel, exact
`broadcast-approved` manifest/hash/release/ticket, matching deployer and constructor,
chain 4663, reviewed 6-decimal token, and role separation.

After confirmation, `release:finalize` creates the `deployed` manifest and
`verify:robinhood` checks receipt, runtime bytecode with immutable references,
constructor token/fee, pause, solvency, successor, and all authority assignments.
Neither a local deployment JSON nor a successful transaction alone authorizes API
startup or paid traffic.

## Remaining release gate

The token choice, role addresses, fee, multisig policy, and frozen commit must be
provided to an independent auditor. No mainnet deployment before findings policy in
[AUDIT_READINESS.md](./AUDIT_READINESS.md) is satisfied.
