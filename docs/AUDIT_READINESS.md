# Phase 1 audit readiness packet

> Prepared: 2026-07-15.
> Status: implementation baseline published; independent review not yet performed.

## Review objective

Give an external contract auditor and focused backend security reviewer a bounded,
reproducible scope. Local tests are evidence, not a substitute for independence.
No contract deployment should occur until this packet references the reviewed
commit and all Critical/High findings are closed.

## Frozen implementation record

- implementation baseline: `ea1b61de20613edd3727f90efb86766918152b07`;
- handoff evidence: [PHASE_1_HANDOFF.md](./PHASE_1_HANDOFF.md);
- GitHub evidence: [Product verification run 9](https://github.com/velostralabs/velostra/actions/runs/29403445476), four of four jobs passed;
- repository state at handoff: clean `main`, local and `origin/main` SHA identical;
- deployment state: no mainnet address recorded.

Documentation-only commits after that SHA do not alter the implementation baseline.
The signed external scope must still pin an immutable reviewed commit or tag.

## In-scope contract

- `contracts/VelostraEscrow.sol`
- `contracts/MockUSD.sol` only as test scaffolding
- `contracts/scripts/build.js`
- `contracts/scripts/deploy.js`
- `contracts/test/VelostraEscrow.e2e.test.js`

Review focus:

- role graph and two-day default-admin transfer delay;
- pause/unpause authority and claims while paused;
- 6-decimal token assumption and unsupported token behavior;
- liability/solvency arithmetic and fee rounding;
- `callId` uniqueness and event correlation;
- claim/revenue reentrancy and checks-effects-interactions;
- successor declaration and migration of only unencumbered liquidity;
- stranded-fund, griefing, direct-transfer, and token edge cases.

Frozen constructor shape:

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

Deployment policy requires a deployed multisig contract for `admin`; all four role
addresses must be explicit and distinct; token decimals must be 6.

## In-scope backend security boundary

- `server/src/lib/auth.ts`, `config.ts`, `redis.ts`, `security-readiness.ts`;
- `server/src/lib/gateway/ssrf.ts` and gateway HMAC/secrets/onchain/settlement files;
- `server/src/routes/agents.ts`, `dashboard.ts`, `builder.ts`, `admin.ts`;
- `server/src/jobs/reconcile.ts`;
- `server/src/db/schema.ts` and `server/drizzle/*.sql`;
- security, migration, money, and restore test suites.

Review focus: auth replay/multi-instance race, SSRF/DNS pinning, encrypted secret
lifecycle, RBAC/audit, exact decimal arithmetic, reservation/outbox transitions,
broadcast ambiguity, event-to-row correlation, live/worker race, cursor safety,
manual rescan, drift, and production fail-closed configuration.

## Explicitly out of scope for Phase 1 audit

- AI model correctness or builder output quality;
- frontend visual design;
- managed cloud configuration not yet provisioned;
- Phase 2 observability transport, load testing, reorg engine, multi-RPC failover,
  and real browser-wallet automation;
- SDKs, pagination, webhooks, and beta product features.

## Reproducible evidence

```bash
npm ci
npm run lint
npm run build

npm ci --prefix server
npm --prefix server run build
npm --prefix server run db:check
npm --prefix server run test:config
npm --prefix server run test:auth
npm --prefix server run test:ssrf
npm --prefix server run test:http-security
npm --prefix server run test:secrets
npm --prefix server run test:admin-policy
npm --prefix server run test:money-unit

npm ci --prefix contracts
npm test --prefix contracts

# disposable PostgreSQL with migrations applied
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm --prefix server run test:money
```

CI also performs production dependency audits and a pg_dump/pg_restore integrity
verification. See [TESTING.md](./TESTING.md).

## Toolchain snapshot

| Tool | Handoff version/policy |
|---|---|
| Node.js | 22.23.0 locally; CI major 22; documented minimum 22 |
| npm | 10.9.8 locally; lockfile installs use `npm ci` |
| Solidity compiler | `solc` 0.8.24; optimizer enabled, 200 runs |
| OpenZeppelin contracts | 5.6.1 |
| Ethers / Ganache | 6.17.0 / 7.9.2 |
| Drizzle ORM / Kit | 0.45.2 / 0.31.10 |
| PostgreSQL CI/restore | 16 |
| GitHub actions | `checkout@v6`, `setup-node@v6` |

`package-lock.json`, `server/package-lock.json`, and `contracts/package-lock.json`
are the dependency source of truth. Optimizer configuration is defined by
`contracts/scripts/build.js` and must not change after scope freeze without review.

## Design decisions frozen for review

- `userCreditBalance` is cumulative deposit evidence, never spendable authority.
- Postgres `credit_balances` is the spendable ledger.
- Contract earnings event carries `bytes32 callId = keccak256(agent_calls.id)`.
- Platform fee rounds down in token minor units; builder receives the remainder.
- Claims remain enabled during pause.
- Successor migration never moves outstanding builder/platform liabilities.
- Initial production uses one supervised worker and one logical signer writer.
- Confirmation delay mitigates reorg; a rollback engine is Phase 2.

## Findings register

Use one row per finding. Do not overwrite history.

| ID | Reviewer | Severity | Component | Status | Resolution / accepted-risk owner |
|---|---|---|---|---|---|
| EXT-PENDING | Independent reviewer TBD | Gate | Contract + backend | OPEN | External engagement required before mainnet. |

Policy:

- Critical/High: must be fixed and re-reviewed.
- Medium: fix or explicit written acceptance with owner, expiry, and compensating
  control.
- Low/Informational: tracked with disposition.
- Any contract fix after review requires affected-scope re-review and a new frozen
  commit SHA.

## Handoff checklist

- [x] Record implementation baseline SHA and clean-tree status.
- [x] Confirm no mainnet deployment address is recorded.
- [x] Provide compiler, optimizer, OpenZeppelin, Node, and lockfile versions.
- [x] Provide threat model, architecture, operations runbook, schema, and ABI docs.
- [x] Provide local/CI and restore evidence references.
- [ ] Provide proposed multisig, signer, treasury, guardian, token, fee, and limits.
- [ ] Receive signed scope and reviewer independence statement.
- [ ] Enter findings without filtering.
- [ ] Close/re-review findings and update this register.
- [ ] Only then mark Phase 1 complete in the release sense.
