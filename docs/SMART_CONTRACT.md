# Smart contract — VelostraEscrow

> Last verified against `contracts/VelostraEscrow.sol`: 2026-07-14.
>
> Status: tested on Ganache/local EVM; not audited and not deployed to mainnet.

## Build stack

- Solidity `0.8.24`;
- OpenZeppelin `SafeERC20`, `ReentrancyGuard`, dan `Ownable`;
- `solc` npm package untuk compile;
- Ganache + ethers untuk E2E.

```bash
cd contracts
npm install
npm run build
npm test
```

## Constructor

```solidity
constructor(address settlementToken, uint16 platformFeeBps, address owner)
```

- settlement token bersifat immutable;
- default deployment example memakai fee `1000` bps = 10%;
- fee maksimum 5000 bps = 50%;
- owner saat ini memiliki settlement, fee, dan treasury authority sekaligus.

Token address/decimals dan owner model harus final sebelum deploy. `MIN_TOPUP = 1e6`
diasumsikan sebagai $1 untuk token 6-decimal; backend env decimal tidak dapat
mengubah constant contract ini.

## Storage dan economics

- `builders[address]`: total earned, available to claim, total claimed, initialized;
- `userCreditBalance[address]`: cumulative deposited amount, bukan spendable ledger;
- `settledCallIds[bytes32]`: mencegah logical paid call disettle dua kali;
- `totalVolume`, `totalPlatformRevenue`, `platformRevenueAvailable`;
- `lastDeposit[address]`.

Pada `grossAmount` dan fee 10%:

```text
platformCut = grossAmount * 1000 / 10000
builderCut  = grossAmount - platformCut
```

Integer division membulatkan platform cut ke bawah dalam smallest token unit.
Backend harus memakai economics/rounding yang identik.

## Public/external functions

### `depositCredits(uint256 amount)`

User mentransfer ERC-20 ke escrow setelah approve. Minimum `MIN_TOPUP` dan
`nonReentrant`. Mengemit `Deposit(user, amount, timestamp)`.

### `initializeBuilder()`

Builder membuat account onchain satu kali. Call kedua revert `already initialized`.

### `creditBuilderEarnings(address builder, uint256 grossAmount, bytes32 callId)`

`onlyOwner`. Memerlukan builder initialized, gross > 0, nonzero callId, dan callId
belum settled. Menandai ID settled sebelum update balances, lalu mengkredit builder
cut dan platform revenue.

Backend mengirim:

```text
callId = keccak256(bytes(agent_calls.id))
```

Event:

```solidity
event EarningsCredited(
    address indexed builder,
    bytes32 indexed callId,
    uint256 amount,       // builder cut, bukan gross
    uint256 platformCut
);
```

Correlation ini memungkinkan worker merekonstruksi `agent_calls` spesifik bila
receipt confirmed tetapi final Postgres transaction gagal.

### `claimEarnings(uint256 amount)`

Builder menarik available earnings ke `msg.sender`. Zero atau amount lebih besar
dari available revert. Mengemit `Claimed(builder, amount, timestamp)`.

### `withdrawPlatformRevenue(address to, uint256 amount)`

`onlyOwner`, `nonReentrant`. Menarik accumulated platform revenue dan mengemit
`PlatformRevenueWithdrawn(to, amount)`.

### `setPlatformFeeBps(uint16 newFeeBps)`

`onlyOwner`, maksimum 50%, berlaku hanya untuk credit berikutnya.

### `getBuilderAccount(address builder)`

View helper untuk seluruh builder struct.

## Events

| Event | Dipakai worker | Catatan |
|---|---|---|
| `Deposit` | Ya | Backfill top-up berdasarkan user + amount. |
| `BuilderInitialized` | Tidak | Lifecycle event. |
| `EarningsCredited` | Ya | Builder + callId + builder/platform cut. |
| `Claimed` | Ya | Backfill claim berdasarkan builder + amount. |
| `PlatformRevenueWithdrawn` | Ya | Backfill platform withdrawal ledger. |
| `PlatformFeeUpdated` | Tidak | Governance/config event. |

Worker mengambil authoritative block timestamp melalui RPC `getBlock`, bukan
mempercayai timestamp field event sebagai database timestamp.

## Test coverage

`contracts/test/VelostraEscrow.e2e.test.js` menjalankan 11 group:

1. deposit;
2. minimum deposit revert;
3. builder initialization requirement;
4. 90/10 credit dan correlated callId event;
5. duplicate callId revert;
6. only-owner credit;
7. claim dan wallet balance movement;
8. over-claim revert;
9. platform withdrawal;
10. fee cap;
11. lifetime volume/revenue totals.

Ini functional local-EVM evidence, bukan independent audit.

## Pre-mainnet risks

### Authority concentration

Semua privileged function menggunakan `onlyOwner`. Jika owner adalah multisig,
backend hot signer tidak bisa settle paid calls. Jika owner adalah hot signer,
key tersebut juga bisa mengubah fee dan menarik treasury. Roadmap menetapkan
separation `SETTLER_ROLE` dan multisig governance/treasury sebagai prioritas pertama.

### Solvency trust

`creditBuilderEarnings` tidak memastikan aggregate outstanding builder claims
selalu ditopang token balance atau deposited/spent ledger. Bug/compromise owner
dapat mengakui earnings melebihi assets; claim kemudian revert saat saldo token
kurang. Perlu invariant/guard dan monitoring sebelum dana nyata.

### Operational controls

- tidak ada pause/emergency stop;
- tidak upgradeable dan belum ada migration mechanism;
- immutable token address;
- tidak ada role rotation selain transfer ownership model OpenZeppelin;
- belum audit independen atau formal verification;
- `MIN_TOPUP` hardcoded untuk 6 decimals.

Keputusan/fix contract harus selesai sebelum deploy karena perubahan setelahnya
memerlukan deployment dan balance migration baru. Lihat [ROADMAP.md](./ROADMAP.md).