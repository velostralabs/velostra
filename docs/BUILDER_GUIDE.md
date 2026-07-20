# Builder guide

> Last verified against builder routes, SDKs, egress, HMAC, webhooks, and managed
> staging status: 2026-07-20.
> Phase state: Phase 0-4 repository implementation is complete; no mainnet deployment
> or closed-beta activation is claimed.
> The public `velostra.xyz` preview has no staging API/escrow values. A separate
> isolated US testnet runtime is live, but onboarding mutations remain gated while
> paid writes are disabled.
> A bounded synthetic builder call and claim reached exact reconciled chain/database
> state on 2026-07-20; this is evidence, not public builder activation. See
> [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md).

Velostra owns discovery, access, metering, reservation, settlement, recovery, and
delivery evidence. Builders own endpoint quality, availability, schema, and
idempotent execution.

## Onboarding

1. Connect and sign in with MetaMask or another explicit EIP-6963/injected wallet.
2. Register at /builder.
3. Initialize the same builder wallet on the active escrow.
4. Submit an HTTPS endpoint, listing metadata, and price (minimum $0.08).
5. Store the returned gateway secret; plaintext is shown only on create/rotate.
6. Create/test a revision, publish it, then wait for admin approval.
7. Observe notifications, calls, analytics, webhook deliveries, earnings, and claims.

A revoked gateway secret stops execution until rotation and endpoint configuration
are synchronized.

## SDKs

- sdk/javascript provides a typed browser/Node client.
- sdk/python provides a dependency-free typed Python client.
- Both support /api/v1 auth, cursor pagination, stable errors, Idempotency-Key,
  agent execution, reports, gateway HMAC, and webhook verification.
- Shared fixtures prove exact signing compatibility with the server.

Generate one idempotency key per business intent and reuse it only for network retry.
If the server returns IDEMPOTENCY_INDETERMINATE, inspect resource/call state before
creating a new key.

## Gateway request protocol

Velostra sends POST JSON containing input, user_id, and call_id. Headers:

~~~text
Content-Type: application/json
X-Velostra-Agent-Id: <agent id>
X-Velostra-Timestamp: <unix seconds>
X-Velostra-Signature: <lowercase hex HMAC-SHA256>
~~~

Canonical signature bytes are:

~~~text
<timestamp>.<exact raw request body>
~~~

Capture the raw body before JSON parsing. Enforce a short timestamp window, use a
constant-time comparison, and retain call_id as a replay/idempotency key when the
work has external effects. Re-serializing JSON may change the signature.

## Egress contract and endpoint probe

Builder endpoints should use stable public HTTPS DNS on an allowed port, answer
inside the configured deadline, remain within the response cap, and return 2xx only
for success. Velostra validates DNS, blocks private/reserved/metadata addresses,
pins the resolved connection with correct TLS host/SNI, revalidates redirects, and
bounds time/bytes.

The revision test action uses the same production SSRF, redirect, timeout, HMAC, and
response-size path. A passing probe proves reachability under current policy; it
does not certify model quality or future availability.

## Revisions and approval

- Creating a revision copies a complete agent snapshot into DRAFT.
- Publishing is serialized per agent and only a DRAFT can win.
- Published snapshots are immutable.
- Publish/rollback sets agents.active_revision_id, copies the selected public
  configuration, and resets listing status to PENDING for review.
- Each call stores agent_revision_id, so execution, analytics, and disputes remain
  attributable to an exact version.
- Rollback selects a prior PUBLISHED snapshot; it is an auditable new activation,
  not history mutation.

Use the Builder Platform panel for revision history, probe, publish/rollback,
notifications, call history, and analytics.

## Paid-call recovery

For a paid call Velostra:

1. commits PROCESSING call, exact reservation, and PREPARED outbox;
2. invokes the builder with call_id;
3. persists output and changes the attempt to READY;
4. submits creditBuilderEarnings(builder,gross,keccak256(call_id));
5. persists/observes chain evidence and finalizes once.

The worker can recover after API/RPC/DB failure, including a lost broadcast response
without a stored tx hash. The contract rejects reused call IDs and the database
conditional transition lets only one live/worker path apply money.

A 503 with reconciliation_pending is not permission to execute the work again.
Track call_id until SUCCESS/APPLIED or a verified definitive failure.

## Analytics and notifications

Builder analytics accept a bounded date range up to 366 days plus optional agent and
revision filters. Returned aggregates use database count/sum/average over persisted
calls and claims. Cursor call history is filter-scoped and stable.

Notifications cover revision, approval, report, privacy, and other platform state.
Marking read is owner-scoped.

## Webhooks

Subscriptions are builder-owned, HTTPS-only, event-filtered, pausable, rotatable,
and soft-deletable. Secret plaintext is returned only on create/rotation.

Events:

- agent.revision.published
- agent.revision.rolled_back
- agent.approved
- agent.rejected
- call.settled
- claim.confirmed
- report.created
- report.resolved

Delivery body:

~~~json
{
  "id": "stable event id",
  "type": "call.settled",
  "created_at": "RFC3339 timestamp",
  "data": {}
}
~~~

Signature headers include event ID, event type, timestamp, and lowercase hex
signature. Verify HMAC-SHA256 over timestamp + "." + event_id + "." + exact body.
Delivery is at least once: deduplicate business effects by event ID before returning
2xx.

The worker claims due rows with a bounded lock, records every attempt, retries with
bounded exponential backoff, and dead-letters exhausted delivery. Operators can
inspect attempts and perform an audited replay. Rotation affects future deliveries;
keep old/new validation overlap only for the controlled cutover window.

## Claims

Call claimEarnings(amount) from the builder wallet, wait for confirmation, then
report amount and tx_hash to /api/v1/builder/claim. If the report is lost, Claimed
event reconciliation backfills it. Claims remain available while escrow is paused
or deprecated.

## Security and reliability checklist

- HMAC/timestamp validation before expensive work;
- call ID and webhook event ID deduplication;
- p95 comfortably below the platform timeout;
- no secrets, cookies, private prompts, or raw sensitive outputs in telemetry;
- searchable structured logs without sensitive payloads;
- documented schema/failure behavior;
- retain call-to-execution mapping for disputes;
- independent abuse/DDoS protection;
- rotate/revoke secrets through the documented one-time plaintext flow.
