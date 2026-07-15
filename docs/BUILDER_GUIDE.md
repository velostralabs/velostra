# Builder guide

> Last verified against builder routes, egress policy, and HMAC code: 2026-07-16.
> Phase state: Phase 0-3 repository preparation has passed internal engineering/CI
> audit. Mainnet deployment remains gated; builder behavior documented here is the
> current application contract.

Velostra accepts framework-agnostic HTTP agents. The platform owns discovery,
access, metering, reservation, settlement, and recovery; the builder owns execution
quality and endpoint availability. Contract is not mainnet-deployed yet.

## Onboarding

1. connect/sign in with MetaMask or another injected wallet;
2. register at `/builder`;
3. initialize the same builder wallet on the active escrow;
4. submit an HTTPS agent endpoint and price (minimum $0.08);
5. store the returned `secret_key`; plaintext is shown only in submit/rotate
   responses;
6. admin approves the pending listing;
7. observe calls/earnings and claim from the same wallet.

Secret rotation and revoke are available. A revoked agent cannot execute until a
new secret is rotated and the builder endpoint configuration is synchronized.

## Request protocol

Velostra sends POST JSON:

```json
{
  "input": "user input",
  "user_id": "internal user id",
  "call_id": "durable call id"
}
```

Headers:

```text
Content-Type: application/json
X-Velostra-Agent-Id: <agent id>
X-Velostra-Timestamp: <unix seconds>
X-Velostra-Signature: <lowercase hex HMAC-SHA256>
```

Canonical bytes are:

```text
<timestamp>.<exact raw request body>
```

Node verification:

```js
import crypto from 'node:crypto'

export function verifyVelostra(rawBody, headers, secret) {
  const timestamp = String(headers['x-velostra-timestamp'] ?? '')
  const signature = String(headers['x-velostra-signature'] ?? '')
  const parsed = Number(timestamp)
  if (!Number.isInteger(parsed)) return false
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed) > 300) return false

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

Capture raw bytes before JSON parsing. Re-serialization may change the signature.
Keep a short-lived `call_id` replay cache if execution is not naturally idempotent.

## Egress requirements

The platform validates and pins endpoint DNS before connecting. Production builder
endpoints should:

- use HTTPS on an allowed port with stable public DNS;
- never resolve to private, loopback, link-local, metadata, multicast, or reserved
  networks;
- keep redirects public and minimal;
- return before the configured 30-second timeout;
- keep response below the configured 1 MiB default cap;
- use 2xx for success and a deterministic non-2xx for failure;
- avoid secrets or sensitive internals in response/logs.

JSON and plain text are accepted. The platform does not hold a database transaction
open while waiting for the endpoint.

## Paid-call recovery

For paid calls the platform:

1. commits `PROCESSING` call, exact credit reservation, and `PREPARED` outbox;
2. sends the HMAC request containing `call_id`;
3. persists output and marks the attempt `READY`;
4. submits `creditBuilderEarnings(builder,gross,keccak256(call_id))`;
5. persists/observes the transaction and finalizes exactly once.

If API/RPC/DB fails, the worker can recover from the outbox or correlated event,
including a lost broadcast response where no tx hash reached Postgres. The builder
is never credited twice because the contract rejects duplicate call IDs and the DB
uses conditional finalization/unique constraints.

A 503 with `reconciliation_pending: true` is not permission to rerun the same user
work. Support should track the returned `call_id` until `SUCCESS/APPLIED` or a
verified definitive failure.

## Claim

Call `claimEarnings(amount)` from the builder wallet, wait for confirmation, then
report `{ amount, tx_hash }` to `/api/builder/claim`. If the browser/API report is
lost, `Claimed` event reconciliation backfills it. Claims remain available while
the escrow is paused/deprecated.

## Rotation and revoke

- `POST /api/builder/agents/:id/secret/rotate`: returns the new plaintext once and
  stores an encrypted envelope;
- update the builder service atomically during a maintenance window;
- `POST /api/builder/agents/:id/secret/revoke`: emergency stop for gateway calls;
- never commit or log the secret.

Platform encryption-key rotation is an operator concern and does not change the
builder plaintext secret unless the builder explicitly rotates it.

## Builder reliability checklist

- HMAC/timestamp validation before expensive work;
- call ID idempotency and searchable structured logs;
- p95 comfortably below timeout;
- health/readiness and dependency timeouts;
- no raw user secrets in telemetry;
- documented response schema and failure behavior;
- retain call-to-execution mapping for disputes;
- independent DDoS/abuse protection; do not rely only on platform limits.

## Current product gaps

Public JS/Python SDKs, agent edit/versioning, approval webhook, test console,
time-series analytics, and pagination are Phase 4 roadmap work. SSRF protection,
response caps, encrypted secrets, rotation/revoke, recovery correlation, and stable
errors are implemented.
