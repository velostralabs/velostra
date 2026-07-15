# Security posture

> Last verified against the workspace: 2026-07-15.
> Phase 1 implementation is locally verified; external audit is still open.

## Implemented controls

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

Runtime signer/JWT/DB/Redis/RPC/encryption secrets must come from a managed secret
store in Phase 2. Repository and frontend env must never contain them.

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
  pending retries, drift comparison, and safe retroactive cursor policy;
- role-separated, pausable, collateral-checked contract and safe successor path.

## Production startup checks

In `NODE_ENV=production`, startup rejects missing/unsafe:

- PostgreSQL/Redis URLs and Redis failure mode;
- JWT, gateway HMAC, and 32-byte agent encryption key;
- canonical HTTPS auth/UI origins;
- memory nonce storage;
- zero/invalid escrow or signer key;
- non-required settlement mode;
- non-4663 chain, non-6-decimal policy, zero deployment block, non-HTTPS RPC;
- plaintext agent secrets or missing initial super-admin path.

API and reconciliation worker both run these checks.

## Residual risks and gates

| Risk | Current treatment | Required before mainnet |
|---|---|---|
| Independent review absent | release blocked | contract + focused backend review |
| Signer key in process env | least-privilege SETTLER_ROLE | managed KMS/restricted signer + rotation drill |
| One logical signer writer | documented deployment constraint | load/nonce-pressure test before scale |
| Reorg after confirmations | delay only | staging reorg drill; decide rollback policy |
| Sustained RPC outage/429 | cursor safety + retry | dedicated RPC, alerts, failover decision |
| Alert transport absent | clear logs | metrics/error tracking/on-call routing |
| Real wallet automation absent | manual picker/browser QA | MetaMask + injected E2E |
| Prompt/output retention policy open | avoid sensitive logs | privacy/retention/delete/export policy |
| Six web transitive `uuid` moderate advisories | high threshold CI + tracking; no upstream fix | reachability/upstream review and acceptance/fix |

## Dependency and supply chain

CI uses lockfiles, read-only permissions, production audits at high severity, web
lint/build, all backend security/unit gates, contract E2E, migration/money-loop
E2E, and restore verification. Generated builds, `.env`, deployments, dumps, and
credentials are ignored.

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