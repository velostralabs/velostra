# Dokumentasi Velostra

> Last verified against the workspace: 2026-07-15.

Mulai dari [STATUS.md](./STATUS.md) untuk posisi aktual, lalu
[ROADMAP.md](./ROADMAP.md) untuk urutan kerja berikutnya. Dokumen lain menjelaskan
cara sistem bekerja dan cara mengoperasikannya. Snapshot ini juga mencakup Crystal V
brand system, semantic routing, dan provider picker MetaMask/injected terbaru.

| Dokumen | Isi |
|---|---|
| [STATUS.md](./STATUS.md) | Apa yang sudah selesai, terverifikasi, belum selesai, dan blocker production. |
| [ROADMAP.md](./ROADMAP.md) | Flow kerja dari foundation yang sudah selesai sampai mainnet, beta, dan scale. |
| [QUICKSTART.md](./QUICKSTART.md) | Menyalakan frontend, API, Postgres, Redis, worker, wallet provider, dan local verification. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Batas authority, data flow, paid-call settlement, reconciliation, dan race safety. |
| [API_REFERENCE.md](./API_REFERENCE.md) | Route Express yang benar-benar tersedia beserta input, output, dan error penting. |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Tabel Drizzle, relasi, unique constraint, cursor, dan raw chain-event ledger. |
| [SMART_CONTRACT.md](./SMART_CONTRACT.md) | ABI `VelostraEscrow`, event correlation, economics, test, dan risiko pre-mainnet. |
| [BUILDER_GUIDE.md](./BUILDER_GUIDE.md) | Cara builder mendaftarkan agent dan memverifikasi request HMAC. |
| [SECURITY.md](./SECURITY.md) | Wallet/provider boundary, key/secrets, replay protection, SSRF, dan hardening checklist. |
| [TESTING.md](./TESTING.md) | Test matrix, browser/wallet QA, reconciliation/race coverage, dan coverage gap. |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Topologi production, env, provider smoke, release order, worker operations, dan rollback. |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Crystal V identity, typography, wallet UX, responsive layout, motion, 3D, accessibility, dan performance. |

## Aturan source of truth

Jika dokumen dan kode berbeda, urutan authority-nya adalah:

1. `contracts/VelostraEscrow.sol` untuk state dan event onchain;
2. `server/src/db/schema.ts` untuk schema database;
3. `server/src/routes/*` untuk HTTP API;
4. `server/src/jobs/reconcile.ts` untuk recovery behavior;
5. `src/lib/chain.ts` dan `src/components/WalletButton.tsx` untuk chain/provider wallet;
6. `src/App.tsx` dan `src/components/RouteManager.tsx` untuk route frontend.

Setiap perubahan behavior wajib mengubah test terkait, `STATUS.md`, dan dokumen
domain terkait. Perubahan prioritas atau scope juga wajib mengubah `ROADMAP.md`.

## Batas dokumentasi ini

Dokumen menjelaskan implementasi yang ada, bukan menjanjikan production readiness.
Contract audit, mainnet deployment, deployment automation, external alert delivery,
real MetaMask/injected browser-wallet E2E, versioned migrations, dan SDK publik belum
selesai kecuali statusnya nanti
diubah secara eksplisit di `STATUS.md`.
