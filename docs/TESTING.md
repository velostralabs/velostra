# Testing

> Last verified against test files and package scripts: 2026-07-14.

## Test matrix

| Suite | Command | External dependency | Coverage utama |
|---|---|---|---|
| Frontend lint | `npm run lint` | None | OXLint source checks. |
| Frontend build | `npm run build` | None | TypeScript project build + Vite production bundle. |
| Backend build | `cd server && npm run build` | None | Strict TypeScript compile ke `dist/`. |
| Auth crypto | `cd server && npm run test:auth` | None | Real EVM keypair, valid signature, replay, spoof, missing challenge. |
| Contract E2E | `cd contracts && npm test` | None | Compile + deploy MockUSD/escrow ke in-process Ganache, 11 test groups. |
| Platform E2E | `cd server && npm run test:platform` | Running stack | Older signup→submit→approve→browse→free run→review→stats→dashboard flow. |
| Money-loop E2E | `cd server && npm run test:money` | Disposable Postgres | Full local EVM/API/worker/HMAC/financial recovery/race proof. |

## GitHub product verification

`.github/workflows/ci.yml` menjalankan empat job pada push/PR ke `main`: web
lint/build + production dependency audit, backend build/auth + production audit,
contract local-EVM suite, dan disposable-Postgres money-loop reconciliation.
## Static verification

```bash
npm run lint
npm run build
cd server
npm run build
```

Vite dapat memberi warning karena async Three.js scene chunk lebih dari default
500 kB threshold. Itu warning performance, bukan build failure. Route pages dan 3D
scene sudah lazy-loaded; performance budget formal tetap ada di roadmap.

## Auth crypto suite

```bash
cd server
npm run test:auth
```

Tidak memerlukan DB atau network. Ia menggunakan generated real EVM private keys
untuk membuktikan:

1. signature wallet yang benar valid;
2. signature/nonce tidak dapat dipakai ulang;
3. attacker signature tidak valid untuk victim wallet;
4. signature tanpa issued challenge gagal.

Suite ini belum membuktikan multi-instance nonce behavior karena nonce current
masih in-memory.

## Contract E2E

```bash
cd contracts
npm test
```

Test meng-compile source, menjalankan Ganache, deploy MockUSD 6-decimal dan escrow,
lalu menguji deposit, minimum, builder init, 90/10, callId correlation, duplicate
callId, owner access, claim, over-claim, withdrawal, fee cap, dan lifetime totals.

Belum mencakup future role separation, pause, solvency invariant, reorg, atau audit.

## Marketplace E2E

Prerequisites: Postgres, Redis, backend, mock agent, dan admin private key whose
address matches `ADMIN_WALLET`.

```bash
cd server
node test/mock-agent/serve.mjs
TEST_ADMIN_PK=0x... npm run test:platform
```

Di PowerShell:

```powershell
$env:TEST_ADMIN_PK='0x...'
npm run test:platform
```

Test ini memakai state database nyata dan dapat membuat builder/agent/review baru.
Gunakan database development disposable.

## Money-loop dan reconciliation E2E

Prerequisite: disposable Postgres database dengan schema current.

```bash
cd server
npm run db:push -- --force
npm run test:money
```

Suite secara otomatis:

- compile contract artifacts;
- start Ganache di port test;
- deploy MockUSD dan VelostraEscrow;
- start real Express backend dengan free tier dipaksa nol;
- start HMAC-validating mock builder endpoint;
- execute worker one-shot sebagai child process.

Coverage:

1. builder wallet login, register, dan onchain initialize;
2. ERC-20 approve + deposit dan normal `/api/dashboard/topup` report;
3. deposit hash replay rejection;
4. paid call, HMAC verification, user debit, 90/10 DB/onchain credit;
5. normal claim dan claim hash replay rejection;
6. paid call yang onchain success lalu final DB transaction dipaksa rollback;
7. durable exact call tetap `PROCESSING` dengan output dan correlation ID;
8. confirmed deposit tanpa memanggil top-up API;
9. confirmed claim tanpa memanggil claim API;
10. platform revenue withdrawal event;
11. worker backfill empat event, exact call recovery, user debit, builder credit,
    transaction link, dan agent stats;
12. persisted cursor dan zero per-contract drift;
13. retroactive rescan yang tidak menggandakan ledger;
14. live request dan worker bersamaan pada call yang sama; loser mendeteksi
    conditional-update winner dan no-op;
15. race menghasilkan tepat satu debit, satu builder credit, satu stats increment,
    satu settlement transaction link, dan zero drift.

Test memakai small block range agar multi-chunk catch-up ikut exercised.

## Manual reconciliation commands

```bash
cd server
npm run reconcile
npm run reconcile -- --from-block=123456
npm run reconcile -- --from-block=123456 --to-block=125000
npm run reconcile:worker
```

Gunakan env yang menunjuk ke disposable/local deployment ketika testing. Untuk
production build gunakan `node dist/jobs/reconcile.js ...`.

## Browser/manual QA checklist

Automated Playwright belum ada. Sebelum release, uji minimal:

- desktop 1440/1280, tablet 768/820, mobile 390/320;
- keyboard-only nav, skip link, Escape mobile menu, visible focus;
- reduced-motion OS preference dan touch pointer;
- direct refresh seluruh canonical route dan browser back/forward restoration;
- marketplace search/filter query URL sync;
- wallet connect/disconnect, wrong-chain, rejected signature/transaction;
- approve→deposit, paid call, reconciliation-pending response, claim;
- loading, empty, API error, slow RPC, and long content states.

## Coverage gaps / next suites

- Playwright browser-wallet E2E dan visual regression;
- SSRF adversarial endpoint suite;
- versioned migration upgrade/rollback and DB restore tests;
- Redis-backed multi-instance nonce test;
- RPC disconnect/timeout setelah tx broadcast tetapi sebelum receipt, lalu late
  confirmation harus direcover dari durable settlement attempt;
- one-hour API/worker/RPC outage catch-up drill;
- reorg simulation beyond fixed confirmations;
- load/pool exhaustion and concurrent paid-call signer pressure;
- RPC failover, 429 behavior, and large event-density scan;
- contract roles/pause/solvency tests after redesign;
- dependency/security pipeline.

Release gates dan urutannya ada di [ROADMAP.md](./ROADMAP.md).