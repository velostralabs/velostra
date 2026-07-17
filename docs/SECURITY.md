# Security posture

> Last verified against the workspace and public frontend: 2026-07-18.
> Phase state: Phase 0-4 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> Internal engineering/CI audit: PASS. Independent third-party audit: not claimed; required before mainnet release.

## Implemented controls

### Public frontend hosting boundary

- the canonical public preview is `https://velostra.xyz/`; valid TLS and the
  `www` redirect are provider-managed by Netlify;
- Git-linked `main` builds with Node.js 22 and publishes only Vite `dist/` through
  tracked `netlify.toml`; repository-root publication is explicitly prohibited;
- the current Netlify environment contains no `VITE_API_URL`, escrow address,
  settlement-token address, backend credential, or Netlify Function;
- the static CDN may deliver globally even though Netlify account metadata reports
  a US `us-east-2` functions region; no legal-office or user-location claim follows;
- the frontend is never trusted for auth, receipt, balance, pricing, settlement,
  signer, governance, or treasury truth.

This public preview expands the browser/supply-chain surface but does not expand
financial authority. API-backed and onchain actions remain inactive until the
separately gated US staging runtime exists.

### Wallet auth and HTTP boundary

- EIP-191 challenge binds wallet, domain, URI, Robinhood chain ID, issue time,
  expiry, and random nonce;
- Redis stores challenges and atomically compare-deletes on success;
- concurrent multi-instance verification produces exactly one winner;
- production rejects memory nonce mode and Redis fail-open;
- JWT cookie is httpOnly, secure in production, same-site lax, 24-hour expiry;
- exact-origin CORS, proxy config, 64 KiB default JSON cap, security headers,
  request correlation ID, structured machine error codes;
- malformed JSON, oversized body, unknown origin, and unknown route have stable
  error codes.

The frontend can discover MetaMask and EIP-6963/injected wallets, but a provider is
only transport. Server signature/receipt/contract checks remain authoritative.
Velostra never requests or stores a wallet private key or seed phrase.

### Builder egress and HMAC

- production endpoints are HTTPS-only; HTTP is restricted to local/test mocks, and
  ports remain allowlisted;
- DNS A/AAAA resolution with private, loopback, link-local, multicast,
  documentation, and reserved ranges blocked;
- requests connect to the validated resolved address while retaining TLS host/SNI;
- every redirect is revalidated and redirect count is capped;
- absolute request deadline, socket timeout, and maximum response bytes;
- test-only loopback exception is disabled by default;
- outbound payload uses per-agent HMAC-SHA256 over timestamp + raw body.

An infrastructure egress firewall remains defense in depth.

### Secrets

- agent HMAC secrets use AES-256-GCM envelope encryption with random IV and auth
  tag, version and key ID;
- old decrypt keys support rotation overlap;
- rotate and revoke APIs exist; secret material is omitted from normal responses;
- production startup scans for plaintext rows and fails closed;
- re-encryption tool migrates all stored envelopes.

Runtime JWT/DB/Redis/RPC/encryption secrets must come from a managed secret store.
Production rejects raw `BACKEND_SIGNER_PRIVATE_KEY`; settlement signing goes through
the allowlisted restricted HTTPS signer adapter and a separately injected bearer
credential. Repository and frontend env must never contain these values.

### Admin

Roles: `SUPER_ADMIN`, `AGENT_REVIEWER`, `REPORT_MODERATOR`, `FINANCE_VIEWER`, and
`AUDITOR`. Permissions are checked per route. Grant, revoke, agent decisions, and
report resolution create audit records with request ID. A Postgres advisory lock
prevents concurrent removal of the final active super admin.

`ADMIN_BOOTSTRAP_WALLETS` only seeds the first DB role. Legacy `ADMIN_WALLET` is
accepted as a compatibility bootstrap input, not ongoing authorization.

### Financial and chain integrity

- canonical 6-decimal integer money and Solidity-identical fee rounding;
- database nonnegative/reservation/split constraints;
- onchain receipt, destination, sender, event, amount, and replay verification;
- durable call + reservation + outbox before external side effects;
- no long SQL transaction around builder/RPC waits;
- correlated onchain call ID and replay guard;
- conditional exactly-once finalization shared by live path and worker;
- persistent event cursor, confirmation delay, adaptive RPC range handling,
  ordered primary/fallback RPC transport, pending retries, drift comparison, and
  safe retroactive cursor policy;
- role-separated, pausable, collateral-checked contract and safe successor path.

### Versioned platform, webhooks, and privacy

- /api/v1 uses bounded signed cursors and stable envelopes; legacy compatibility
  advertises explicit deprecation metadata.
- durable idempotency binds actor, operation, route, and normalized fingerprint;
  conflicts and uncertain expired processing states fail closed;
- published agent revisions are immutable and per-agent activation is serialized;
- webhook subscriptions are builder-owned and HTTPS-only; secrets are one-time
  plaintext, exact bodies are HMAC signed, and stable event IDs support deduplication;
- deliveries/attempts are durable with conditional claims, bounded retry, dead-letter,
  RBAC/audited replay, heartbeat, readiness, metrics, and alerts;
- moderation evidence is classified/size-bounded; conditional transition history,
  notifications, and audit records prevent silent overwrite;
- deletion anonymizes personal fields but retains required financial/settlement/
  security/audit evidence;
- telemetry fields must be classified, owned, bounded by retention, and enabled;
  prohibited/unclassified fields fail closed;
- public metadata is US-locale and Velostra-attributed; CI rejects local user-profile
  paths, private-key blocks, non-public email domains, and non-Velostra HEAD attribution
  while reporting only the category and file path.

## Production startup checks

In `NODE_ENV=production`, startup rejects missing/unsafe:

- PostgreSQL/Redis URLs and Redis failure mode;
- JWT, gateway HMAC, and 32-byte agent encryption key;
- canonical HTTPS auth/UI origins;
- memory nonce storage;
- zero/invalid escrow or restricted signer configuration; raw signer keys;
- non-required settlement mode;
- a chain mismatch for the declared environment: 46630 for non-mainnet staging and 4663 only for mainnet-like releases; non-6-decimal policy, zero deployment block, or non-HTTPS RPC;
- plaintext agent secrets or missing initial super-admin path;
- missing/short PLATFORM_CURSOR_SECRET, unsafe webhook worker limits, or production
  readiness not requiring the webhook worker.
- mainnet-like startup without explicit Phase 3 approval, exact deployed-manifest path/hash/release/environment/stage, or a safe paid-write mode;
- incomplete or mismatched authority/canary policy, manifest-reissued cap bypass, or
  public mode without a hash-bound passing decision and separate approval.
- the US staging deployment plan rejects any region outside GCP us-east4, Neon
  aws-us-east-1, and Upstash GCP us-east4; it also rejects mutable image references,
  mainnet chain identity, unbounded instances, and paid RPC policy.

API, reconciliation worker, webhook worker, and monitor run role-aware subsets of these checks.

## Residual risks and gates

| Risk | Current treatment | Required before mainnet |
|---|---|---|
| Independent review absent | release blocked | contract + focused backend review |
| Public static preview precedes managed backend | no client secrets or contract/API values; static build and routing only | bind exact origins, CSP, API, verified testnet contract, and real-wallet evidence before activation |
| Release/canary artifact tampering | canonical hashes, exact required sets, authority/constructor binding, deployment init-code provenance, immutable mounts, explicit approvals | protected operator artifact custody |
| Concurrent canary cap bypass | serialized transaction-scoped admission plus unique row and DB race test | initial canary intentionally serialized |
| Restricted signer custody not yet proven on managed staging | raw keys rejected; dedicated private signer, scoped invokers, managed software secp256k1 KMS implementation, nonce lock, and local signer tests are committed | apply the US KMS/signer deployment and capture rotation plus audit-log evidence |
| One logical signer writer | documented deployment constraint + bounded local load | managed nonce-pressure test before scale |
| Deep reorg after configured confirmations | canonical-safe-head policy + local snapshot/revert proof | managed staging drill and explicit incident decision |
| Sustained all-provider RPC outage/429 | ordered failover, cursor safety, retry/backoff | managed provider outage evidence + alert routing |
| Alert delivery not yet proven to a real operator | durable metrics/alerts and lifecycle implemented | inject every required failure and capture delivery/acknowledgement |
| Webhook receiver outage or replay | exact-body HMAC, stable event ID, durable attempts, bounded retry/dead-letter, audited replay | receiver must persist event-ID idempotency and prove rotation/incident drills |
| Real MetaMask staging evidence absent | automated picker/a11y/layout suite; guarded external test | execute real extension + injected-provider scenarios |
| Sensitive prompt/output exposure | prohibited telemetry fields, evidence classification, export/delete policy, anonymization | managed retention/legal review and storage controls |
| Six web transitive `uuid` moderate advisories | high threshold CI + tracking; no upstream fix | reachability/upstream review and acceptance/fix |

## Dependency and supply chain

CI uses lockfiles, read-only permissions, production audits at high severity, web
lint/build/browser/performance gates, evidence-packet tamper tests, backend security/
resilience/observability gates, contract E2E, migration/money-loop E2E, and restore
verification. Generated builds, `.env`, deployments, dumps, and credentials are
ignored. The historical Phase 1 evidence remains in
[PHASE_1_HANDOFF.md](./PHASE_1_HANDOFF.md); the current seven-job matrix is in
[TESTING.md](./TESTING.md).

Run dependency audits before release:

```bash
npm audit --omit=dev --audit-level=high
npm audit --prefix server --omit=dev --audit-level=high
npm audit --prefix contracts --omit=dev --audit-level=high
```

## Incident policy

Do not manually repair money rows without exact chain evidence and an incident
record. Pause new risk, preserve claims, keep ambiguous reservations, scan the exact
range, verify zero drift, then reopen. Detailed signer, drift, successor, secret,
and database procedures are in [OPERATIONS.md](./OPERATIONS.md).

The full asset/threat/control register is [THREAT_MODEL.md](./THREAT_MODEL.md).
External review handoff is [AUDIT_READINESS.md](./AUDIT_READINESS.md).
