# Velostra status

> Last verified against the workspace: 2026-07-15.

## Executive status

Velostra Phase 1 implementation is code-complete and locally verified for contract
authority/solvency, backend trust boundaries, exact financial state, durable
outbox/reconciliation, migrations/indexes, and backup restore. It is still **not
mainnet-ready** because independent contract audit and focused backend review have
not been performed. No mainnet contract deployment is recorded.

| Area | Status | Evidence |
|---|---|---|
| Product frontend | Current scope complete | canonical routes, Crystal V identity, wallet picker, desktop/browser QA, lint/build |
| Contract design | Frozen for external review | separated roles, pause, collateral guard, rotation, successor migration, 10 E2E groups |
| Auth/HTTP security | Implemented | atomic Redis nonce, bound challenge, strict CORS/cookies/headers/body, stable errors |
| Builder egress/secrets | Implemented | pinned SSRF-safe HTTP, caps/timeouts, AES-GCM envelopes, rotate/revoke |
| Admin | Implemented | database RBAC, granular permissions, audit log, final-admin guard |
| Financial ledger | Implemented | exact 6-decimal arithmetic, reservations, constraints, no long DB transaction |
| Outbox/reconciliation | Implemented | seven states, four events, hash-known/hash-unknown recovery, drift, cursor safety |
| Database release path | Implemented | five versioned migrations, fresh/upgrade tests, indexes, restore verifier |
| CI | Implemented | web, backend security, contract, migration/money-loop, dump/restore gates |
| External audit | Open blocker | audit packet ready; independent reviewer/sign-off still required |
| Production staging/observability | Phase 2 | managed services, KMS, alerts, chaos/load/reorg, wallet automation, soak |

## Phase 1 completed implementation

### Contract

- `AccessControlDefaultAdminRules` with a two-day default-admin transfer delay.
- Dedicated settler, treasury, pause guardian, fee manager, and governance roles.
- Deploy script requires a deployed admin multisig and four distinct role addresses.
- Exact 6-decimal token policy and fee-on-transfer deposit rejection.
- Explicit builder/platform liabilities and pre-credit solvency guard.
- Pause blocks new risk while keeping existing builder claims available.
- Settler grant/revoke rotation.
- One-time successor declaration permanently deprecates new risk.
- Treasury can migrate only unencumbered liquidity; predecessor retains all
  outstanding liability backing.
- `EarningsCredited` carries the exact `bytes32 callId`.

### Backend trust boundaries

- Redis-backed, atomic, multi-instance wallet nonce consume.
- Domain/URI/chain/time-bound signed challenge.
- Production secure cookie, exact-origin CORS, proxy policy, body cap, request ID,
  security headers, and machine-readable error codes.
- DNS-pinned builder egress with private/reserved rejection, redirect revalidation,
  port/scheme policy, timeout, and response cap.
- AES-256-GCM agent secrets with version/key ID, old-key overlap, rotate/revoke, and
  re-encryption tool.
- Database RBAC and admin audit trail; production plaintext-secret and admin
  readiness checks.
- Production config fails closed for unsafe DB/Redis/origin/auth/signer/chain/
  escrow/reconciliation settings.

### Money and recovery

- Canonical six-decimal integer arithmetic mirrors Solidity fee rounding.
- `credit_balances.reserved_usd` plus database nonnegative/within-balance checks.
- Call + reservation + outbox commit before builder/RPC side effects.
- Builder HTTP and chain waits occur without an open SQL transaction/row lock.
- Outbox states: PREPARED, READY, SUBMITTED, AMBIGUOUS, CONFIRMED, APPLIED, FAILED.
- Tx hash persists before receipt polling when available.
- Receipt timeout and post-chain DB rollback recover automatically.
- Lost broadcast response with no DB hash recovers from the exact correlated event.
- Live path/worker race shares conditional PROCESSING-to-SUCCESS and applies one
  debit, one builder credit, one agent update, and one ledger row.
- Retroactive scans are idempotent and cannot jump the normal cursor over a gap.
- Deposit, claim, earnings, and platform-withdrawal drift is reported each run.

### Database and operations

- Versioned migration baseline and Phase 1 migrations.
- Query indexes for marketplace/history/pending/admin/ledger/event paths.
- Fresh and upgrade migration paths verified against PostgreSQL.
- Actual disposable PostgreSQL dump/clean restore verified exact financial data,
  outbox states, migration history, constraints, and indexes.
- Threat model, incident/worker/backup/secret/successor runbooks, and external audit
  packet are in `docs/`.

## Verification evidence

Passed during the current Phase 1 work:

- backend TypeScript build and Drizzle migration check;
- production-config, auth, SSRF, HTTP security, secret, admin policy, and money
  unit suites;
- contract E2E: all 10 Phase 1 groups;
- migration E2E: fresh + upgrade + constraints + 17 tables + indexes;
- expanded money-loop E2E, including missed reports, forced post-chain DB failure,
  live/worker race, known-hash receipt ambiguity, unknown-hash broadcast ambiguity,
  cursor preservation, exactly-once effects, and zero drift;
- PostgreSQL dump/restore integrity drill.

Final full regression passed on 2026-07-15:

- frontend lint is warning-free and production build passes; Vite reports only the
  documented large async/main chunk performance warnings;
- every isolated backend security/unit gate passes;
- contract, migration, expanded money-loop, and final dump/clean-restore gates pass;
- backend and contract production dependency audits report zero vulnerabilities;
- web audit reports six moderate transitive `uuid` advisories through the MetaMask
  connector tree, with no upstream fix available. CI fails at High and this
  moderate risk remains explicitly tracked for Phase 2 reachability/upstream review.

## Honest remaining blockers

### Final Phase 1 sign-off

- Independent contract audit.
- Independent focused backend review of auth, SSRF, signer, ledger, worker, and
  migration/recovery behavior.
- Close all Critical/High; fix or explicitly accept each Medium under the findings
  policy.

These cannot be truthfully self-certified by the implementation author. The scope,
commands, frozen decisions, and findings register are ready in
[AUDIT_READINESS.md](./AUDIT_READINESS.md).

### Phase 2 before mainnet

- managed Postgres/Redis/RPC and secret-manager/KMS deployment;
- external metrics/error tracking/alerts and deep readiness;
- real MetaMask + injected wallet E2E;
- load/signer nonce pressure, one-hour outage timing, RPC throttle/failover, reorg,
  and managed PITR drills;
- 72-hour staging soak with zero unexplained drift.

## One-hour outage answer

Yes, the worker can catch up from a one-hour block gap without skipping data. It
uses a persistent cursor, 2,000-block default chunks, timeout, exponential retry,
adaptive range splitting, and commits only completed contiguous ranges. If RPC
returns sustained 429/down responses, catch-up safely pauses and resumes from the
same cursor; recovery time then depends on provider capacity. A dedicated RPC,
lag alert, and timed Phase 2 drill are required before promising an SLO.

## Next decision

The next authorized work after this local Phase 1 handoff is either:

1. engage external reviewers using the ready packet; and/or
2. begin Phase 2 staging infrastructure without deploying mainnet value.

See [ROADMAP.md](./ROADMAP.md).