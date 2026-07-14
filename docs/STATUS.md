# Status Velostra

> Last verified against the workspace: 2026-07-14.

## Executive snapshot

Velostra sudah memiliki product surface yang responsif, core marketplace API,
local EVM settlement, dan reconciliation safety net yang menutup gap antara
receipt onchain dan commit Postgres. Ini adalah foundation yang kuat untuk masuk
ke hardening, tetapi belum production-ready atau mainnet-ready.

| Area | Status | Bukti / catatan |
|---|---|---|
| Frontend | Selesai untuk current scope | Vite build dan lint; clean routes; responsive UI; adaptive 3D; reduced-motion dan keyboard basics. |
| Auth + marketplace | Implemented | EIP-191 login, builder registration, submission, approval, discovery, execution, review, dashboard. |
| Paid money loop | Implemented di local EVM | Top-up, paid call 90/10, claim, receipt verification, replay protection. |
| Reconciliation | Implemented dan E2E-tested | Cursor, chunk scan, four events, backfill, retry pending, drift log, retroactive scan. |
| Paid-call correlation | Implemented | `keccak256(agent_calls.id)` dikirim sebagai `bytes32 callId`. |
| Race safety | Implemented dan E2E-tested | Live path dan worker berbagi conditional `PROCESSING -> SUCCESS`. |
| Contract mainnet | Belum | Belum audit, belum final authority design, belum deploy. |
| Production operations | Sebagian | GitHub CI memverifikasi web, API/auth, contract, dan money loop; deployment CD, migrations, external alerts, secrets manager, dan incident runbook belum lengkap. |

## Foundation yang sudah selesai

### Product dan frontend

- Landing page premium, marketplace, agent detail, dashboard, builder console,
  admin console, protocol docs, dan not-found page.
- Canonical URL `/system`, `/proof`, `/economics`, `/marketplace`,
  `/agents/:slug`, `/dashboard`, `/builder`, `/admin`, `/docs`.
- Legacy `/#proof`-style URL dikonversi ke semantic path; `/agent/:slug`
  redirect ke `/agents/:slug`.
- Marketplace search/category/sort tersimpan di query string dan dinormalisasi.
- Route lazy-loading, transition, scroll restoration, mobile menu, skip link,
  focus styling, form labels, responsive breakpoints, dan reduced motion.
- WebGL execution artifact hanya diaktifkan pada viewport yang cukup besar tanpa
  reduced-motion; mobile/reduced-motion memakai poster fallback.

### API dan gateway

- Wallet auth EIP-191 dengan single-use nonce dan JWT cookie.
- Builder registration langsung memperbarui session claim `is_builder`.
- Agent endpoint menerima JSON bertanda HMAC dan memiliki timeout configurable.
- Free tier, Postgres fallback, Redis rate limit, paid balance check, review,
  moderation, dashboard, dan stats tersedia.
- Top-up dan claim API memverifikasi receipt, escrow address, sender, event,
  amount, dan unique transaction hash.

### Contract dan money loop

- `VelostraEscrow.sol` mendukung deposit, builder initialization,
  correlated earnings credit, claim, platform withdrawal, dan fee update.
- Economics default 90% builder / 10% platform; fee hard-cap 50%.
- `creditBuilderEarnings(address,uint256,bytes32)` menolak zero/reused call ID.
- Contract suite menjalankan 11 test group terhadap Ganache/local EVM.

### Reconciliation dan consistency

- `chain_sync_state` menyimpan cursor per `chain_id + contract_address`.
- `chain_events` menyimpan raw event dengan unique `(tx_hash, log_index)`.
- Worker mengindeks `Deposit`, `EarningsCredited`, `Claimed`, dan
  `PlatformRevenueWithdrawn` sampai safe head setelah confirmation delay.
- Event yang belum dapat dipetakan tetap pending dan dicoba lagi.
- `EarningsCredited.callId` memulihkan call spesifik, user debit, builder credit,
  transaction link, agent totals, output, dan final status.
- Live path dan worker memakai conditional update yang sama. Hanya pemenang yang
  boleh menjalankan side effect ledger/stat; jalur yang kalah menjadi no-op.
- Drift log membandingkan total event onchain dengan ledger Postgres per deployment.
- Manual rescan dan overlapping execution aman karena unique constraints dan
  conditional finalization.

## Yang belum selesai

### Blocker sebelum mainnet

1. Finalisasi authority model contract. Saat ini `creditBuilderEarnings`, fee
   update, dan withdrawal sama-sama `onlyOwner`; backend hot signer dan multisig
   owner tidak dapat dipisahkan tanpa perubahan contract.
2. Buat durable settlement-attempt/outbox state. Current signer helper baru
   mengembalikan tx hash setelah receipt selesai; RPC error setelah broadcast dapat
   membuat live path menandai call `FAILED` walaupun tx kemudian confirmed. Hash
   harus disimpan segera setelah submit dan worker harus menangani state ambigu.
3. Hindari long database transaction/row lock selama builder HTTP call dan chain
   wait; gunakan reservation/state machine yang tetap exactly-once.
4. Independent smart-contract audit dan perbaikan hasil audit.
5. Review solvency/accounting invariant, pause/emergency control, role separation,
   dan deployment/migration strategy contract.
6. SSRF defense untuk builder-controlled `endpoint_url`.
7. Versioned database migrations; hentikan `db:push` untuk production data.
8. KMS/secret manager untuk backend signer, JWT secret, database credentials, dan
   encrypted agent HMAC secrets.
9. Redis-backed auth nonce, secure production cookie, multi-instance behavior,
   structured audit log, dan hardened rate limiting.
10. Production observability: worker cursor lag, pending events, drift, RPC errors,
    API error rate, key balance/gas, dan alert delivery.
11. Browser-wallet E2E pada target chain/config serta load, outage, receipt
    ambiguity, and reorg drills.

### Product/scale gap setelah hardening

- SDK JavaScript/Python belum ada di workspace.
- Agent edit/versioning, builder webhook, analytics time-series, pagination, API
  versioning, user report creation, dan multi-admin RBAC belum ada.
- `platform_stats` belum diisi oleh scheduled rollup.
- Product-verification CI sudah tersedia; preview/staging environment, deployment
  promotion, dan rollback automation belum dibangun.

## Verification evidence terbaru

Dijalankan ulang pada 2026-07-14 setelah docs audit:

- frontend `npm run lint`: pass;
- frontend `npm run build`: pass, dengan expected warning untuk async 3D chunk;
- backend `npm run build`: pass;
- backend `npm run test:auth`: 4 assertions pass;
- contract `npm test`: seluruh 11 test groups pass di local EVM.

`test:money` tidak dijalankan ulang pada docs-only pass ini karena membutuhkan
Postgres disposable. Coverage recovery/race yang dicatat di atas berasal dari
suite integration yang sudah ada dan telah digunakan untuk membuktikan flow itu;
jalankan ulang sebagai release gate setelah disposable DB tersedia.
## Command utama

```bash
# frontend
npm run lint
npm run build

# backend
cd server
npm run build
npm run test:auth
npm run test:money

# worker
npm run reconcile
npm run reconcile -- --from-block=123456 --to-block=125000
npm run reconcile:worker

# contract
cd ../contracts
npm test
```

## Keputusan berikutnya

Pekerjaan berikutnya bukan menambah visual atau fitur acak. Urutan resmi dimulai
dari Phase 1 di [ROADMAP.md](./ROADMAP.md): freeze mainnet design, pisahkan
contract roles, harden trust boundaries, buat migration/observability, lalu baru
production-like staging dan deployment.