# API reference

> API contract refreshed 2026-07-22 against current v1 routes, public-testnet
> deployment truth, durable idempotency, correlated settlement, and platform controls.
> Phase state: Phase 0-4 and public testnet are complete; mainnet activation remains gated.
> Local base URL: http://localhost:8787.
> Managed public-testnet API: live behind the canonical `velostra.xyz/testnet` surface, deep-ready 8/8, and bounded for synthetic paid writes. Server auth, quotas, receipts, and settlement remain authoritative; see [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md).

## Version and response contract

New integrations use /api/v1. Every v1 response includes X-API-Version: 1.

- Successful objects are wrapped as { data: ... }.
- Collections use { data: [...], page: { next_cursor, has_more } }.
- Errors keep { error, code, request_id, details? }.
- Cursor limits are 1..100, default 25.
- Cursors are opaque, signed, versioned, filter-scoped, and bound to the stable
  (created_at,id) boundary. Tampering or using one under different filters fails.
- Compatible /api routes remain available during migration and emit Deprecation,
  Sunset, and Link headers pointing to /api/v1.

Authenticated routes accept the httpOnly velostra_token cookie or a Bearer token.
Financial decisions use exact 6-decimal strings/minor units internally; JSON values
are presentation numbers.

## Durable idempotency

Externally retried v1 mutations accept Idempotency-Key. The server binds a key to
the authenticated actor, HTTP operation, route, and normalized request fingerprint.

- Same key + same request after completion replays the stored status/body.
- Same key + different request returns IDEMPOTENCY_CONFLICT.
- A concurrent duplicate waits for or replays the one owner.
- An expired PROCESSING record is not blindly reclaimed because the mutation may
  already have committed before a crash. It returns IDEMPOTENCY_INDETERMINATE;
  inspect resource state, then use a new key only when safe.

Clients should generate a unique key per business intent and retain it through
network retries.

## Health and operations

| Method | Path | Purpose |
|---|---|---|
| GET | /health | shallow process and chain identity |
| GET | /ready | dependency, contract, reconciliation, and configured webhook-worker readiness |
| GET | /metrics | bearer-protected Prometheus exposition |

## Authentication

Base: /api/v1/auth.

| Method | Path | Behavior |
|---|---|---|
| POST | /nonce | create wallet/domain/URI/chain/time-bound challenge |
| POST | /login | atomic one-use EIP-191 verification |
| POST | /logout | clear auth cookie |
| GET | /me | current session or null |

Important codes include INVALID_WALLET_INPUT, AUTH_VERIFICATION_FAILED, and
AUTH_REQUIRED.

## Marketplace and execution

| Method | Path | Behavior |
|---|---|---|
| GET | /api/v1/agents | approved agents; q, category, limit, cursor |
| GET | /api/v1/agents/:slug | detail, builder, tags, latest reviews |
| POST | /api/v1/agents/:slug/run | authenticated free/paid execution |
| POST | /api/v1/agents/:slug/review | upsert rating 1..5 and optional comment |
| GET | /api/v1/dashboard/calls/:callId | owner-scoped call and settlement recovery status |

Paid execution first commits PROCESSING call, reservation, and PREPARED settlement
attempt. A recovery response can include call_id, settlement_tx_hash when known, and
reconciliation_pending. Never rerun user work merely because receipt polling timed out.
Use the returned call_id with the owner-scoped dashboard call-status endpoint until the
call becomes SUCCESS or a verified definitive failure. PROCESSING plus a settlement
attempt in PREPARED, READY, SUBMITTED, AMBIGUOUS, or CONFIRMED remains a recovery state,
not permission to submit the agent work again.

Important codes include INSUFFICIENT_CREDITS, AGENT_ENDPOINT_FAILED,
SETTLEMENT_REVERTED, SETTLEMENT_AMBIGUOUS, RECONCILIATION_PENDING, and the
PHASE3_CANARY_* gate codes.

## Builder core

Base: /api/v1/builder. Builder authentication is required.

| Method | Path | Behavior |
|---|---|---|
| POST | /register | create builder and earnings account |
| GET | /me | builder profile, agents, earnings |
| POST | /agents | submit agent and return plaintext gateway secret once |
| POST | /agents/:id/secret/rotate | replace secret; plaintext returned once |
| POST | /agents/:id/secret/revoke | stop gateway execution |
| GET | /earnings | exact earnings and recent claims |
| POST | /claim | verify and reconcile confirmed wallet claim |

Agent endpoint, price, logo, and tags remain bounded. Normal responses never expose
encrypted secret storage.

## Revisions, probes, history, analytics, and notifications

| Method | Path | Behavior |
|---|---|---|
| GET | /api/v1/builder/agents/:id/revisions | cursor revision history |
| POST | /api/v1/builder/agents/:id/revisions | create immutable draft |
| POST | /api/v1/builder/agents/:id/revisions/:revisionId/test | production-policy endpoint probe |
| POST | /api/v1/builder/agents/:id/revisions/:revisionId/publish | publish and reset approval to PENDING |
| POST | /api/v1/builder/agents/:id/revisions/:revisionId/rollback | activate a published revision and reset approval |
| GET | /api/v1/builder/calls | cursor history; optional agent_id/status |
| GET | /api/v1/builder/analytics | exact bounded range; optional agent_id/revision_id |
| GET | /api/v1/builder/notifications | cursor inbox |
| PATCH | /api/v1/builder/notifications/:id/read | mark owned notification read |

Publishing is serialized per agent. A call records agent_revision_id, so analytics
and disputes remain attributable to the executed revision.

## Builder webhooks

| Method | Path | Behavior |
|---|---|---|
| POST | /api/v1/builder/webhooks | create HTTPS subscription; secret returned once |
| GET | /api/v1/builder/webhooks | list owned subscriptions |
| PATCH | /api/v1/builder/webhooks/:id/status | PAUSE or RESUME |
| POST | /api/v1/builder/webhooks/:id/rotate-secret | rotate secret; returned once |
| DELETE | /api/v1/builder/webhooks/:id | soft-delete subscription |
| GET | /api/v1/builder/webhooks/:id/deliveries | bounded delivery history |

Supported events are defined by server/src/lib/platform/webhooks.ts. Delivery headers:

- X-Velostra-Event-Id
- X-Velostra-Event-Type
- X-Velostra-Timestamp
- X-Velostra-Signature

The lowercase hex HMAC-SHA256 signs timestamp + "." + event_id + "." + exact body
bytes. Delivery is at least once; consumers must deduplicate by event ID.

## Trust and privacy

| Method | Path | Behavior |
|---|---|---|
| POST | /api/v1/trust/agents/:id/reports | create evidence-safe report |
| GET | /api/v1/trust/reports | current user's cursor report history |
| GET | /api/v1/privacy/policy | public retention/anonymization policy |
| POST | /api/v1/privacy/requests | request EXPORT or DELETE |
| GET | /api/v1/privacy/requests | current user's cursor request history |
| GET | /api/v1/privacy/requests/:id/export | download completed owned export |

Raw secrets/private prompts are rejected as moderation evidence. DELETE anonymizes
personal product fields while preserving required financial, settlement, security,
and audit evidence.

## Governance operations

All routes below require DB-backed permissions and privileged mutations are audited.

| Method | Path | Permission |
|---|---|---|
| GET | /api/v1/admin/reports | report:read |
| POST | /api/v1/admin/reports/:id/assign | report:resolve |
| POST | /api/v1/admin/reports/:id/resolve | report:resolve |
| GET | /api/v1/admin/privacy/requests | privacy:operate |
| POST | /api/v1/admin/privacy/requests/:id/process | privacy:operate |
| GET | /api/v1/admin/telemetry/fields | telemetry:manage |
| PUT | /api/v1/admin/telemetry/fields/:name | telemetry:manage |
| GET | /api/v1/admin/webhooks/dead-letter | webhook:operate |
| GET | /api/v1/admin/webhooks/deliveries/:id/attempts | webhook:operate |
| POST | /api/v1/admin/webhooks/deliveries/:id/replay | webhook:operate |
| POST | /api/v1/admin/webhooks/subscriptions/:id/pause | webhook:operate |

Legacy admin agent decisions, statistics, roles, and audit-log endpoints are also
mounted under /api/v1/admin and retain their permission checks.

## Gateway HMAC

Outbound agent JSON contains input, user_id, and call_id. Headers are
X-Velostra-Agent-Id, X-Velostra-Timestamp, and X-Velostra-Signature.
The signature is lowercase HMAC-SHA256 over timestamp + "." + exactRawBody using
the per-agent secret. Capture bytes before JSON parsing, enforce freshness, compare
in constant time, and deduplicate call_id when execution is not naturally idempotent.

Use sdk/javascript or sdk/python for typed pagination, errors, idempotent calls,
gateway signing, and webhook verification.
