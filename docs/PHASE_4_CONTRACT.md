# Phase 4 platform contract

This document freezes the repository contract for Velostra Phase 4. The implementation
must preserve every Phase 0-3 financial, reconciliation, release, and operational
invariant while adding closed-beta platform capabilities.

## Interface contract

- Public platform routes use `/api/v1` and return `X-API-Version: 1`.
- Successful collection responses use `{ data, page: { next_cursor, has_more } }`.
- Successful object responses use `{ data }`.
- Errors retain `{ error, code, request_id, details? }` for backward compatibility.
- Cursors are opaque, versioned, tamper-evident encodings of a stable `(created_at,id)`
  boundary. Limits are bounded to `1..100` with a default of `25`.
- Retried mutations accept `Idempotency-Key`. The durable record binds the authenticated
  actor, operation, normalized request fingerprint, status, and replayable response.
  Reusing a key for a different request is a conflict.
- Legacy `/api/*` routes remain available during Phase 4 and advertise their successor
  through `Deprecation`, `Sunset`, and `Link` headers once a compatible v1 route exists.

## Agent lifecycle contract

- Published agent revisions are immutable.
- Each call records the revision used for execution.
- Publishing or rolling back changes the agent's active revision atomically.
- Endpoint probes reuse the production SSRF, redirect, timeout, and response-size policy.
- Secrets remain encrypted outside revisions and are never returned by list/history APIs.

## Integration contract

- Webhook events and deliveries have stable identities.
- Payloads are signed with an HMAC over timestamp, event id, and exact body bytes.
- Delivery is at-least-once; consumer effects are made idempotent with the event id.
- Attempts are durable, retries are bounded exponential backoff, and exhausted deliveries
  enter a dead-letter state that requires an audited operator replay.

## Trust and privacy contract

- Moderation evidence is size-bounded, classified, and cannot contain secrets or raw
  private prompts.
- User-facing deletion never destroys financial, settlement, security, or audit evidence
  that policy requires Velostra to retain. Personal fields are anonymized instead.
- Telemetry fields are allowlisted and classified before collection.
- Every privileged moderation, webhook, privacy, and retention action is RBAC-protected
  and audit logged.

## Exit contract

Phase 4 repository completion requires fresh and upgrade migrations, API and SDK contract
tests, concurrency/idempotency/webhook tests, browser regression gates, an isolated
synthetic closed-beta journey, zero unexplained financial or delivery drift, and updated
documentation. It does not authorize public traffic, mainnet deployment, or real value.
