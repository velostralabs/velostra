# Quickstart lokal

> Last verified against package scripts and env templates: 2026-07-15.

Run commands from the cloned repository root unless a section says otherwise.

## Prasyarat

- Node.js 20+ dan npm;
- PostgreSQL 14+;
- Redis 7 direkomendasikan, tetapi development tetap berjalan saat Redis down;
- MetaMask extension/mobile atau EIP-6963/injected wallet (misalnya Rainbow atau
  Coinbase) hanya diperlukan untuk manual wallet UI/write testing.

## 1. Jalankan Postgres dan Redis

Contoh Docker:

```powershell
docker run -d --name velostra-pg -e POSTGRES_PASSWORD=velostra -e POSTGRES_DB=velostra -p 5432:5432 postgres:16
docker run -d --name velostra-redis -p 6379:6379 redis:7
```

Gunakan database disposable untuk `test:money`; test tersebut mengubah/menambah
state dan tidak ditujukan ke database production.

## 2. Konfigurasi dan jalankan API

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run db:push
npm run dev
```

Minimum `.env` untuk browsing/auth/free-tier local:

```dotenv
DATABASE_URL=postgresql://postgres:velostra@localhost:5432/velostra
JWT_SECRET=replace-with-a-long-random-development-secret
ADMIN_WALLET=0xYourAdminWallet
WEB_ORIGIN=http://localhost:5173
REDIS_URL=redis://localhost:6379
```

Check:

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Paid-call/top-up/claim/worker membutuhkan tambahan:

```dotenv
VELOSTRA_ESCROW_ADDRESS=0x...
BACKEND_SIGNER_PRIVATE_KEY=0x...
SETTLEMENT_TOKEN_DECIMALS=6
ROBINHOOD_RPC_URL=http://127.0.0.1:8545
ROBINHOOD_CHAIN_ID=<local-chain-id>
ONCHAIN_SETTLEMENT_MODE=required
VELOSTRA_DEPLOYMENT_BLOCK=<deployment-block>
```

`ONCHAIN_SETTLEMENT_MODE=disabled` hanya untuk isolated local/test flow yang tidak
membuktikan settlement. Jangan gunakan di production.

## 3. Jalankan frontend

Terminal baru:

```powershell
# from the cloned repository root
Copy-Item .env.example .env
npm install
npm run dev
```

Root `.env`:

```dotenv
VITE_API_URL=http://localhost:8787
VITE_ESCROW_ADDRESS=
VITE_SETTLEMENT_TOKEN=
```

Buka `http://localhost:5173`. UI dan read-only/product preview dapat dilihat tanpa
contract address. Top-up, builder initialize, dan claim membutuhkan contract/token
address yang benar pada network wallet aktif.

Clean local URLs:

- `http://localhost:5173/system`
- `http://localhost:5173/proof`
- `http://localhost:5173/economics`
- `http://localhost:5173/marketplace`
- `http://localhost:5173/dashboard`
- `http://localhost:5173/builder`
- `http://localhost:5173/admin`
- `http://localhost:5173/docs`

### Wallet provider check

1. Klik `Connect Wallet`; picker harus menampilkan satu opsi MetaMask yang
   direkomendasikan dan `Other browser wallet`/named injected provider bila ada.
2. MetaMask memakai official connector untuk extension atau mobile handoff.
3. Rainbow, Coinbase, dan provider lain ditemukan melalui EIP-6963/injected path;
   urutan announcement browser tidak boleh memaksa koneksi otomatis.
4. Setelah connect, Velostra meminta Robinhood Chain `4663`; gunakan `Switch
   network` jika wallet berada di chain berbeda.
5. Sign-in memakai EIP-191 tanpa gas. Top-up/claim tetap menampilkan confirmation
   transaction di wallet dan hanya aktif jika contract/token address terisi.

Velostra tidak meminta seed phrase/private key. Jangan pernah menaruh credential
wallet di `.env` frontend atau paste ke browser UI.

Refresh direct route memerlukan SPA fallback di production host; Vite dev server
sudah menangani ini.

## 4. Worker

Jika contract/RPC sudah dikonfigurasi:

```powershell
cd server
npm run reconcile
npm run reconcile -- --from-block=123456 --to-block=125000
npm run reconcile:worker
```

- `reconcile`: one-shot sampai safe head;
- `--from-block/--to-block`: incident/retroactive range;
- `reconcile:worker`: loop setiap `RECONCILE_INTERVAL_MS` (default 30s).

Set `VELOSTRA_DEPLOYMENT_BLOCK` agar initial scan tidak dimulai dari genesis.

## 5. Verification suites

Frontend:

```powershell
# from the cloned repository root
npm run lint
npm run build
```

Backend auth/build:

```powershell
cd server
npm run build
npm run test:auth
```

Contract:

```powershell
cd contracts
npm install
npm test
```

Full money loop:

```powershell
cd server
$env:DATABASE_URL='postgresql://postgres:velostra@localhost:5432/velostra_money_test'
npm run db:push -- --force
npm run test:money
```

Test memulai Ganache, deploy MockUSD + escrow, memulai API + HMAC mock agent,
menjalankan worker, dan membersihkan child process. Hanya Postgres disposable yang
harus tersedia dari luar.

Older marketplace happy path membutuhkan API/Postgres/Redis dan mock agent yang
sudah berjalan:

```powershell
cd server
node test/mock-agent/serve.mjs
$env:TEST_ADMIN_PK='0x...'
npm run test:platform
```

Private key address harus sama dengan backend `ADMIN_WALLET`.

## Troubleshooting

- `ECONNREFUSED 5432`: Postgres/URL salah atau database belum dibuat.
- Redis errors: expected fail-open, tetapi rate limit tidak aktif sampai Redis pulih.
- Builder route `403`: session bukan builder; register lalu pakai cookie terbaru.
- Paid call config error: signer, escrow, RPC, chain ID, atau owner tidak cocok.
- Wallet write salah network: samakan wallet chain, frontend addresses, backend
  chain/RPC, dan deployment.
- MetaMask tidak terbuka: unlock/enable extension atau ulang mobile handoff; opsi
  browser lain memerlukan provider injected/EIP-6963 yang aktif.
- Worker scan genesis lambat: set exact `VELOSTRA_DEPLOYMENT_BLOCK`.
- Direct route 404 setelah deploy: tambahkan rewrite seluruh route ke `index.html`.

Coverage lengkap ada di [TESTING.md](./TESTING.md); production setup ada di
[DEPLOYMENT.md](./DEPLOYMENT.md).
