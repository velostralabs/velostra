# Velostra status

> Last verified against the workspace: 2026-07-15.
> Phase 1 implementation baseline: [`ea1b61d`](./PHASE_1_HANDOFF.md); Phase 2 is next.

## Executive status

Velostra Phase 1 implementation is code-complete and locally/CI verified for contract
authority/solvency, backend trust boundaries, exact financial state, durable
outbox/reconciliation, migrations/indexes, and backup restore. It is still **not
mainnet-ready** because independent contract audit and focused backend review have
not been performed. No mainnet contract deployment is recorded. The canonical
implementation handoff, including the final second-pass closures, is recorded in
[PHASE_1_HANDOFF.md](./PHASE_1_HANDOFF.md).

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
| CI | Passing | [run 9](https://github.com/velostralabs/velostra/actions/runs/29403445476): web, backend, contract, money-loop, restore |
| External audit | Open pre-mainnet gate | audit packet ready; independent reviewer/sign-off still required |
| Production staging/observability | Phase 2 - next | managed services, KMS, alerts, chaos/load/reorg, wallet automation, soak |

## Phase 1 implementation handoff (DONE)

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
- Confirmed EarningsCredited amounts override the anticipated DB split, keeping
  authorized contract fee changes synchronized.
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
- the legacy full-platform smoke passes end to end against the local API and mock
  builder: builder signup, registration, submission, admin approval, marketplace,
  real free call, review, admin stats, and user dashboard;
- contract, migration, expanded money-loop, and final dump/clean-restore gates pass;
- backend and contract production dependency audits report zero vulnerabilities;
- web audit reports six moderate transitive `uuid` advisories through the MetaMask
  connector tree, with no upstream fix available. CI fails at High and this
  moderate risk remains explicitly tracked for Phase 2 reachability/upstream review;
- the pushed implementation baseline is `ea1b61de20613edd3727f90efb86766918152b07`;
  GitHub Product verification run `29403445476` passed all four jobs on Node.js 22
  with `actions/checkout@v6` and `actions/setup-node@v6`.

## Honest remaining release gates

### Independent review gate

- Independent contract audit.
- Independent focused backend review of auth, SSRF, signer, ledger, worker, and
  migration/recovery behavior.
- Close all Critical/High; fix or explicitly accept each Medium under the findings
  policy.

These cannot be truthfully self-certified by the implementation author. The scope,
commands, frozen decisions, and findings register are ready in
[AUDIT_READINESS.md](./AUDIT_READINESS.md).

### Phase 2 operational proof

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

## Next workstream

Begin Phase 2 staging and observability without deploying mainnet value. In
parallel, engage external reviewers using the ready audit packet. Phase 3 remains
blocked until the independent-review findings policy and every Phase 2 exit gate
are both satisfied.

See [ROADMAP.md](./ROADMAP.md).
