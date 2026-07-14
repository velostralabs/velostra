# API reference

> Last verified against `server/src/routes/*`: 2026-07-14.

Base URL lokal: `http://localhost:8787`. Health check: `GET /health`.

Semua body/response menggunakan JSON. Authenticated routes membaca JWT dari
httpOnly cookie `velostra_token` atau `Authorization: Bearer <token>`. Error dasar
berbentuk `{ "error": "message" }`; machine-readable error code belum tersedia.

Money value pada API dinyatakan sebagai decimal USD number. Onchain contract
menggunakan smallest token unit dan backend mengonversi memakai
`SETTLEMENT_TOKEN_DECIMALS` (default 6).

## Auth — `/api/auth`

### `POST /api/auth/nonce`

Body:

```json
{ "walletAddress": "0x..." }
```

Response: `{ "message": "...", "nonce": "..." }`. Wallet harus EVM-valid.

### `POST /api/auth/login`

Body:

```json
{ "walletAddress": "0x...", "signature": "0x..." }
```

Memverifikasi EIP-191 message dan single-use nonce. Response berisi `token` dan
`user`, sekaligus memasang cookie 24 jam. Invalid/expired/reused challenge: `401`.

### `POST /api/auth/logout`

Menghapus cookie. Response: `{ "ok": true }`.

### `GET /api/auth/me`

Response: `{ "auth": <session|null> }`.

## Marketplace — `/api/agents`

### `GET /api/agents`

Approved agents saja, maksimum 60 row.

Optional query:

- `q`: pencarian case-insensitive pada nama;
- `category`: salah satu enum category;
- `sort`: `featured` (default), `popular`, atau `price`.

Response: `{ "agents": [...] }` dengan builder display name dan verified state.

### `GET /api/agents/:slug`

Detail approved agent, builder summary, tags, dan 10 review terbaru. Tidak ditemukan
atau belum approved: `404`.

### `POST /api/agents/:slug/run` — auth

Body:

```json
{ "input": "1-10000 characters" }
```

Gateway mengecek global/user/agent rate limit, free tier atau balance, membuat
durable `PROCESSING` call, memanggil endpoint builder dengan HMAC, dan melakukan
onchain settlement untuk paid call.

Success:

```json
{
  "call_id": "cuid2",
  "output": {},
  "execution_ms": 123,
  "is_free_tier": false,
  "settlement_tx_hash": "0x..."
}
```

Important errors:

- `400`: invalid input;
- `402`: credit tidak cukup;
- `404`: agent tidak ada/tidak approved;
- `429`: rate limit;
- `502`: upstream atau onchain settlement gagal, call tidak di-charge;
- `503`: chain settlement confirmed tetapi final DB commit gagal. Response berisi
  `call_id`, `settlement_tx_hash`, dan `reconciliation_pending: true`; worker akan
  memperbaiki exact call.

### `POST /api/agents/:slug/review` — auth

Body: `{ "rating": 1, "comment": "optional, max 1000" }`, rating 1–5.
Review unique per user + agent; submit ulang meng-update review yang sama dan
menghitung ulang aggregate rating.

## Builder — `/api/builder`

### `POST /api/builder/register` — auth

Body:

```json
{
  "display_name": "2-60 chars",
  "bio": "optional, max 500",
  "website_url": "optional URL",
  "twitter_url": "optional URL",
  "github_url": "optional URL"
}
```

Membuat builder + earnings row dan reissue JWT dengan `is_builder: true`.
Sudah terdaftar: `409`.

### `GET /api/builder/me` — auth + builder

Mengembalikan profile, earnings, dan seluruh submitted agents milik builder.

### `POST /api/builder/agents` — auth + builder

Body fields:

- `name`: 2–60 chars;
- `description`: 10–280 chars;
- `long_description`: optional, max 4000;
- `category`: enum category;
- `endpoint_url`: URL;
- `price_per_call`: minimum `0.08`;
- `logo_url`: optional URL;
- `tags`: optional, maksimum 8.

Response berisi agent `PENDING` dan `secret_key`. Secret hanya diberikan pada
response submit; simpan segera. Endpoint update/rotation belum tersedia.

### `GET /api/builder/earnings` — auth + builder

Mengembalikan earnings row dan 20 claim terbaru.

### `POST /api/builder/claim` — auth + builder

Builder harus lebih dulu memanggil `claimEarnings(amount)` dari wallet sendiri dan
menunggu confirmation.

Body:

```json
{ "amount": 1.5, "tx_hash": "0x<64 hex>" }
```

API memverifikasi receipt, escrow, sender, event, dan amount; lalu meng-update
Postgres. Hash replay: `409`. Amount di atas offchain available: `400`. Jika API
tidak pernah dipanggil, worker dapat backfill dari `Claimed` event.

## Dashboard — `/api/dashboard`

Seluruh route membutuhkan auth.

### `GET /api/dashboard`

Response:

```json
{
  "balance_usd": 0,
  "free_tier": { "used": 0, "remaining": 10, "limit": 10, "hasRemaining": true },
  "recent_calls": []
}
```

Recent calls maksimum 20.

### `POST /api/dashboard/topup`

User harus lebih dulu approve settlement token dan memanggil
`depositCredits(amount)` dari wallet sendiri.

Body:

```json
{ "amount_usd": 2, "tx_hash": "0x<64 hex>" }
```

Minimum $1. API memverifikasi receipt + event dan menambah Postgres credit. Hash
replay: `409`. Missed API report dapat dibackfill worker dari `Deposit` event.

## Admin — `/api/admin`

Semua route membutuhkan auth dan wallet yang sama dengan `ADMIN_WALLET`.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/agents/pending` | Semua pending agent, oldest first. |
| `POST` | `/agents/:id/decision` | Body `{ "decision": "APPROVE"|"REJECT" }`. |
| `GET` | `/reports?status=PENDING` | Filter report berdasarkan status enum. |
| `POST` | `/reports/:id/resolve` | Status `REVIEWED`, `WARNING_SENT`, `SUSPENDED`, atau `REMOVED`, optional `admin_note`. |
| `GET` | `/stats` | User, builder, live agent, volume, revenue, dan call totals. |

Resolve ke `SUSPENDED`/`REMOVED` juga mengubah status agent. User-facing endpoint
untuk membuat report belum ada.

## HMAC request ke builder endpoint

Ini outbound gateway protocol, bukan route publik Velostra.

Body exact:

```json
{ "input": "...", "user_id": "...", "call_id": "..." }
```

Headers:

- `Content-Type: application/json`;
- `X-Velostra-Agent-Id`;
- `X-Velostra-Timestamp` (Unix seconds);
- `X-Velostra-Signature`.

Signature adalah lowercase hex HMAC-SHA256 atas
`timestamp + "." + rawBody`, dengan per-agent secret. Builder harus memakai raw
body yang sama, timing-safe compare, dan menolak timestamp lama. Default upstream
timeout 30 detik, configurable lewat `AGENT_TIMEOUT_MS`.

## Enum penting

Agent category: `CRYPTO_DEFI`, `WALLET_ANALYSIS`, `TOKEN_RESEARCH`, `TRADING`,
`WRITING`, `RESEARCH`, `PRODUCTIVITY`, `DATA_ANALYSIS`, `CODE`, `OTHER`.

## API gaps

- belum versioned (`/api/v1`);
- belum ada cursor pagination;
- belum ada stable machine-readable error codes;
- belum ada builder edit, secret rotation, webhook, atau user report creation;
- admin masih single-wallet, bukan RBAC;
- callback verification helper ada tetapi belum dipakai route callback.