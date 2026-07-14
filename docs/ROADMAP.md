# Roadmap Velostra

> Dibuat dari audit codebase pada 2026-07-14. `STATUS.md` adalah snapshot keadaan;
> dokumen ini adalah urutan eksekusi.

## Cara memakai roadmap

Kerjakan phase secara berurutan. Item boleh dikerjakan paralel hanya jika tidak
mengubah invariant phase sebelumnya. Sebuah phase dianggap selesai ketika seluruh
exit gate-nya terbukti dengan code, test, dan dokumen—bukan hanya karena fitur
sudah terlihat di UI.

Status:

- **DONE**: sudah ada dan punya bukti lokal/E2E.
- **NEXT**: prioritas aktif berikutnya.
- **LATER**: menunggu dependency phase sebelumnya.

## Phase 0 — Foundation lengkap (DONE)

Tujuan: membangun satu loop produk yang benar dan recoverable sebelum production.

Sudah selesai:

- responsive premium frontend, adaptive 3D/motion, clean semantic routes, dan
  URL/query-state synchronization;
- EVM wallet auth, marketplace, builder onboarding, approval, agent execution,
  reviews, dashboard, earnings, dan admin basics;
- ERC-20 escrow, 90/10 settlement, top-up, builder claim, dan platform withdrawal;
- receipt verification dan transaction-hash replay protection;
- durable paid-call intent dan `bytes32 callId = keccak256(agent_calls.id)`;
- reconciliation cursor/raw event ledger untuk empat event contract;
- automatic backfill top-up, claim, platform withdrawal, dan exact paid call;
- pending-event retry, drift warning, retroactive scan, chunked catch-up, RPC retry;
- live request/worker race safety dengan conditional `PROCESSING -> SUCCESS`;
- contract E2E dan full money-loop E2E di local EVM.

Exit gate: tercapai untuk local foundation. Belum berarti production-ready.

## Phase 1 — Mainnet design freeze dan security hardening (NEXT)

Tujuan: hilangkan risiko arsitektur yang mahal atau irreversible sebelum contract
di-deploy.

### 1.1 Contract authority dan solvency

- Pisahkan settlement operator dari governance/treasury owner. Rekomendasi:
  role-based access (`SETTLER_ROLE`) untuk backend signer, multisig untuk admin,
  fee, pause, dan treasury actions.
- Putuskan apakah `userCreditBalance` tetap cumulative audit counter atau menjadi
  spendable onchain ledger; dokumentasikan invariant tunggalnya.
- Tambahkan/validasi solvency guard, emergency pause, role rotation, dan migration
  path bila deployment harus diganti.
- Finalisasi settlement token address/decimals dan deployment parameters.
- Perluas contract tests untuk roles, pause, solvency, rotation, dan failure cases.

Exit gate: ABI dan authority model dibekukan; threat model direview; seluruh
contract tests hijau; tidak ada unresolved design decision yang memerlukan
redeploy setelah launch.

### 1.2 Backend trust-boundary hardening

- Blokir SSRF: DNS resolution, private/loopback/link-local rejection, redirect
  validation, port/scheme policy, response-size cap, dan egress restriction.
- Pindahkan auth nonce ke Redis dengan atomic consume dan multi-instance test.
- Aktifkan secure cookie berdasarkan production mode, explicit proxy/TLS config,
  stricter CORS, request-size limit, security headers, dan machine-readable errors.
- Enkripsi `agents.secret_key` at rest dan tambahkan rotation/revoke flow.
- Pisahkan admin authorization dari satu env wallet ke RBAC + audit log.
- Review fail-open Redis policy untuk paid/abuse-sensitive operations.

Exit gate: automated security tests lolos; multi-instance auth lolos; endpoint
SSRF suite lolos; tidak ada plaintext operational secret di database atau repo.

### 1.3 Database dan financial invariants

- Buat versioned Drizzle migrations dan baseline migration untuk semua tabel.
- Buat durable `settlement_attempts`/outbox: simpan call ID dan tx hash segera
  setelah broadcast, representasikan submitted/confirmed/failed/ambiguous state,
  dan izinkan worker menyelesaikan confirmed event dari recoverable state.
- Refactor paid path menjadi reservation/state machine agar tidak memegang DB
  transaction dan balance row lock selama builder HTTP call + chain receipt wait.
- Tambahkan test RPC timeout/disconnect sesudah broadcast tetapi sebelum receipt;
  event yang kemudian confirmed harus tetap finalize tepat sekali.
- Tambahkan query/index audit untuk call history, pending reconciliation, admin
  queue, dan time-based queries.
- Buat invariant test: chain totals, transaction totals, credit balances,
  builder earnings, claims, dan agent totals selalu reconcile.
- Definisikan precision/rounding policy end-to-end tanpa bergantung pada JS float
  untuk keputusan finansial kritis.
- Definisikan backup, point-in-time recovery, retention, dan restore drill.

Exit gate: fresh install dan upgrade migration keduanya lolos; ambiguous broadcast
recovery dan no-long-transaction design terbukti E2E; restore drill terbukti;
invariant suite hijau.

### 1.4 Independent review

- Contract audit eksternal setelah code freeze.
- Backend focused security review untuk auth, SSRF, signer, ledger, dan worker.
- Tutup findings berdasarkan severity sebelum lanjut.

Exit gate: tidak ada open Critical/High; Medium memiliki fix atau accepted-risk
record yang eksplisit.

## Phase 2 — Production-like staging dan observability (LATER)

Tujuan: membuktikan sistem operasional, bukan hanya correctness unit/E2E.

- Buat staging dengan managed Postgres, Redis, dedicated RPC, API, worker, dan
  frontend SPA fallback.
- Simpan secrets di provider secret manager/KMS; signer memiliki gas monitor dan
  minimum-balance alert.
- Tambahkan structured logs, request/call correlation, error tracking, metrics,
  health/readiness, dan alert routing.
- Metric minimum: API latency/error, upstream agent latency/error, DB pool,
  Redis errors, signer nonce queue, worker cursor lag, safe-head lag, pending
  event age/count, RPC 429/timeout, dan reconciliation drift.
- Jalankan browser-wallet Playwright E2E untuk responsive breakpoints dan full
  top-up → call → earnings → claim flow.
- Jalankan chaos drills: API mati 1 jam, worker mati 1 jam, RPC throttling, DB
  disconnect, Redis outage, process restart mid-settlement, dan reorg simulation.
- Tambahkan load test concurrent paid calls dan signer nonce pressure.

Exit gate: staging soak minimal 72 jam tanpa unexplained drift; alert terbukti
sampai channel operator; one-hour catch-up memenuhi target operasional yang
disepakati; runbook dipakai dalam drill.

## Phase 3 — Mainnet release (LATER)

Tujuan: release terkontrol dengan nilai dan user terbatas.

1. Deploy audited contract dengan verified bytecode dan final parameters.
2. Catat deployment block; konfigurasi API dan worker dari block tersebut.
3. Jalankan worker catch-up dan pastikan drift nol sebelum frontend write action
   dibuka.
4. Deploy API + worker, smoke test read-only, lalu deploy frontend.
5. Buka allowlisted internal canary dengan deposit/claim limit rendah.
6. Verifikasi ledger, escrow token balance, builder balances, treasury revenue,
   cursor, dan alerts secara manual.
7. Buka closed beta bertahap hanya setelah canary exit gate lolos.

Exit gate: contract verified, drift nol, canary money loop lolos, recovery drill
lolos pada deployment nyata, dan rollback/emergency procedure siap.

## Phase 4 — Closed beta dan builder platform (LATER)

Tujuan: membuat produk bisa dipakai builder eksternal dengan aman.

- JavaScript SDK dan Python SDK untuk HMAC verification + request/response types.
- Agent edit/versioning, secret rotation, endpoint health check, submission test,
  approval/rejection notifications, dan builder analytics.
- User report creation, moderation audit trail, multi-admin RBAC.
- Cursor pagination, API versioning, idempotency keys, documented error codes,
  webhook delivery with retries/signatures.
- Product telemetry dan funnel tanpa merekam prompt/output sensitif secara default.

Exit gate: onboarding builder dapat diselesaikan dari docs tanpa bantuan internal;
SLO beta tercapai; abuse/moderation flow dapat diaudit.

## Phase 5 — Scale dan product expansion (LATER)

- Horizontal API/worker scaling dengan DB/advisory lock atau leased worker ownership.
- Multi-RPC failover, backpressure, autoscaling, and cost controls.
- Daily rollup ke `platform_stats`, analytics time-series, exports, dan finance
  reconciliation reports.
- Multi-contract/deployment migration tooling dan historical index strategy.
- Performance budget frontend, asset telemetry, dan device-tier visual quality.
- Evaluasi multi-chain hanya setelah satu deployment stabil dan operasional.

## Flow kerja setiap task

Untuk menjaga ritme dan mencegah docs tertinggal:

1. Pilih task teratas dari phase aktif dan tulis acceptance criteria.
2. Catat invariant/security impact sebelum coding.
3. Implementasikan code + automated test pada perubahan yang sama.
4. Jalankan test proporsional: static, unit, integration, E2E, atau chaos drill.
5. Update doc domain, `STATUS.md`, dan roadmap bila scope berubah.
6. Review bukti dan exit gate; baru merge/deploy.
7. Catat follow-up sebagai task terurut, bukan perubahan acak di tengah phase.

## Urutan kerja paling dekat

Backlog berikutnya yang direkomendasikan:

1. Design dan implement separation `SETTLER_ROLE` vs multisig admin/treasury.
2. Implement durable settlement-attempt/outbox dan ambiguous receipt recovery.
3. Tambahkan contract pause/solvency tests dan freeze ABI.
4. Implement SSRF-safe builder egress.
5. Buat versioned migrations + financial invariant suite.
6. Pindahkan nonce/secrets ke Redis/KMS-compatible design.
7. Tambahkan metrics/alerts worker dan production-like staging.
8. Jalankan audit, browser-wallet E2E, load test, dan one-hour outage drill.

Jangan melakukan mainnet deploy sebelum item 1–8 memenuhi exit gate Phase 1–2.