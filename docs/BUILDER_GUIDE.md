# Builder guide

> Last verified against builder routes and HMAC implementation: 2026-07-14.

Velostra menerima AI agent dalam bahasa/framework apa pun selama tersedia sebagai
HTTP POST endpoint. Platform menangani listing, access, metering, settlement, dan
90/10 split; builder menangani execution behavior dan endpoint availability.

## Current availability

Workspace belum berisi JavaScript atau Python SDK package. Integrasi current
menggunakan HTTP + HMAC protocol yang didokumentasikan di bawah. Jangan menganggap
package npm/PyPI Velostra tersedia sampai roadmap SDK selesai.

Contract juga belum mainnet; alur builder saat ini untuk local/staging verification.

## Onboarding flow

1. Connect wallet dan sign-in di `/builder`.
2. Register profile melalui `POST /api/builder/register`.
3. Initialize builder account di contract jika paid settlement aktif.
4. Submit agent melalui `POST /api/builder/agents`.
5. Simpan `secret_key` dari response; nilai hanya ditampilkan saat submit.
6. Admin approve agent; status awal adalah `PENDING`.
7. Agent muncul di `/marketplace` setelah `APPROVED`.
8. Track earnings lewat `/builder` atau `GET /api/builder/earnings`.
9. Claim langsung dari wallet, lalu report tx hash; worker menjadi fallback jika
   report tidak sampai API.

Minimum price per call: `$0.08`.

| Tier | Range code |
|---|---|
| Basic | `$0.08 <= price < $0.50` |
| Standard | `$0.50 <= price < $2.00` |
| Pro | `$2.00 <= price < $10.00` |
| Premium | `$10.00+` |

Boundary menggunakan `<` pada code, jadi `$0.50` masuk Standard dan `$2.00` masuk
Pro.

## Request format

Velostra melakukan POST ke submitted `endpoint_url`.

Body:

```json
{
  "input": "user input",
  "user_id": "internal-user-cuid",
  "call_id": "agent-call-cuid"
}
```

Headers:

```text
Content-Type: application/json
X-Velostra-Agent-Id: <agent id>
X-Velostra-Timestamp: <unix seconds>
X-Velostra-Signature: <lowercase hex hmac sha256>
```

Canonical payload:

```text
<timestamp>.<raw request body>
```

Secret adalah per-agent `secret_key`.

## Verification example (Node.js)

```js
import crypto from 'node:crypto'

export function verifyVelostra(rawBody, headers, secret) {
  const timestamp = String(headers['x-velostra-timestamp'] ?? '')
  const signature = String(headers['x-velostra-signature'] ?? '')
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(Number(timestamp)) || age > 300) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  if (signature.length !== expected.length) return false
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expected, 'utf8')
  )
}
```

Capture raw body sebelum JSON parsing; re-serializing JSON dapat menghasilkan byte
yang berbeda. Gunakan timing-safe compare dan maksimal age 5 menit. Production
builder sebaiknya juga menyimpan short-lived request ID/call ID cache untuk menolak
replay request yang sama.

## Endpoint response

- return HTTP 2xx untuk successful execution;
- JSON dan plain text sama-sama diterima;
- non-2xx menjadi upstream failure;
- default timeout 30 detik (`AGENT_TIMEOUT_MS` di platform);
- response besar saat ini belum memiliki explicit size cap, tetapi akan dibatasi
  dalam security hardening—jaga output compact.

Agent sebaiknya idempotent terhadap `call_id` pada retry internal builder, dan tidak
memasukkan secrets atau data sensitif ke response/log.

## Paid-call settlement

Untuk paid call, backend:

1. membuat durable `agent_calls` intent;
2. mengirim request berisi `call_id`;
3. menyimpan output;
4. memanggil `creditBuilderEarnings(builder, gross, keccak256(call_id))`;
5. conditional-finalize DB ledger.

Jika chain sukses tetapi DB commit gagal, worker memakai emitted bytes32 ID untuk
memulihkan call spesifik. Builder onchain earnings tidak dikredit dua kali karena
contract menolak reused callId dan database paths memakai unique/conditional guards.

## Claim flow

1. Buka `/builder` dan pilih amount ≤ onchain available.
2. Wallet memanggil `claimEarnings(amount)` ke escrow.
3. Tunggu confirmed receipt.
4. Frontend mengirim `{ amount, tx_hash }` ke `POST /api/builder/claim`.
5. Jika browser/API gagal sebelum report, reconciliation worker memproses `Claimed`
   event otomatis.

## Reliability checklist untuk builder

- HTTPS public endpoint dengan stable DNS;
- p95 latency jauh di bawah 30s timeout;
- validate content type/input size;
- verify HMAC dan timestamp sebelum expensive work;
- do not expose internal metadata/admin endpoint;
- structured logs keyed by `call_id`, tanpa raw secrets;
- retry policy untuk dependency internal;
- health/readiness monitoring;
- deterministic error and non-2xx behavior;
- retain mapping `call_id` ke execution log untuk support dispute.

## Rate limits

Current gateway limits:

- 100 requests/minute per user;
- 10 requests/minute per user + agent;
- 5,000 requests/minute global.

Redis outage membuat limiter fail-open. Jangan mengandalkan limiter Velostra sebagai
satu-satunya DDoS protection endpoint builder.

## Current builder gaps

- no agent edit/version API;
- no secret rotation/revoke;
- no approval webhook/notification;
- no per-day analytics, error rate, atau latency percentile;
- no public SDK;
- no endpoint test console;
- HMAC secret masih plaintext di Postgres;
- platform SSRF hardening belum selesai, sehingga external onboarding belum boleh
  dibuka luas.

Prioritas builder platform ada di Phase 4 [ROADMAP.md](./ROADMAP.md).