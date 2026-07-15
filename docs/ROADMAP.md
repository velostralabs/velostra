# Velostra roadmap

> Updated from the verified Phase 1 implementation handoff: 2026-07-15.
> Baseline: [`ea1b61d`](./PHASE_1_HANDOFF.md); Phase 2 is ready to start.

## Status model

- **DONE**: implemented, tested, and documented in the repository.
- **EXTERNAL GATE**: repository work is ready; independent evidence is required.
- **NEXT**: next active phase after the gate.
- **LATER**: intentionally sequenced after earlier exit gates.

A phase is not complete in the release sense until every exit gate has evidence.

## Phase 0 - Recoverable product foundation (DONE)

Delivered:

- premium responsive frontend, semantic URLs/query state, Crystal V assets, and
  MetaMask + EIP-6963/injected provider picker;
- wallet auth, marketplace, builder/admin/dashboard product surfaces;
- escrow top-up, paid 90/10 call, claim, platform withdrawal;
- `bytes32 callId` correlation, four-event indexer, missed-report backfill, drift,
  retroactive scan, and conditional race safety.

Exit gate: one local recoverable end-to-end product loop. Passed.

## Phase 1 - Mainnet design freeze and security hardening (IMPLEMENTATION DONE)

Status: **implementation DONE; independent review EXTERNAL GATE**.

### 1.1 Contract authority and solvency (DONE)

- [x] Separate `SETTLER_ROLE` from governance and treasury.
- [x] Separate pause guardian and fee manager.
- [x] Two-day delayed default-admin transfer.
- [x] Require deployed multisig admin and distinct deployment roles.
- [x] Freeze `userCreditBalance` as cumulative audit evidence, not spendable state.
- [x] Require immutable 6-decimal standard token and exact deposits.
- [x] Track explicit builder/platform liabilities and reject undercollateralized
  earnings credit.
- [x] Preserve claims during pause.
- [x] Test settler rotation/revoke and fee/treasury isolation.
- [x] Add permanent successor declaration and migrate only unencumbered liquidity.
- [x] Expand contract suite across authority, pause, solvency, rotation, migration,
  and accounting.

Exit evidence: ABI/authority design frozen for audit; 10 contract E2E groups pass.

### 1.2 Backend trust-boundary hardening (DONE)

- [x] SSRF-safe DNS resolution/pinning, private/reserved rejection, redirect
  revalidation, scheme/port policy, timeouts, and response cap.
- [x] Redis atomic multi-instance auth nonce.
- [x] Bound wallet challenge and production-secure session/cookie/origin/proxy
  behavior.
- [x] Request size/security headers/request ID/stable error codes.
- [x] AES-256-GCM agent secret envelopes, rotation, revocation, and migration.
- [x] Database admin RBAC, granular permissions, audit log, final-admin guard.
- [x] Production Redis/auth and startup readiness fail closed.
- [x] Adversarial auth, SSRF, HTTP, secret, admin, and production-config tests.

Exit evidence: automated security suites pass; no plaintext operational secret is
required in repository/database.

### 1.3 Database and financial invariants (DONE)

- [x] Versioned Drizzle SQL baseline and Phase 1 migrations.
- [x] Exact 6-decimal arithmetic without JS float for financial decisions.
- [x] Balance/reservation/split database constraints.
- [x] Durable settlement attempt/outbox state machine.
- [x] Reservation before external work; no long DB transaction around HTTP/RPC.
- [x] Persist returned tx hash before receipt wait.
- [x] Recover known-hash receipt timeout and confirmed-chain/failed-DB commit.
- [x] Recover lost broadcast response with no DB hash via correlated event.
- [x] Authoritative successful event safely resolves ambiguous candidate hashes.
- [x] Conditional live/worker finalization and concurrent exact-once E2E.
- [x] Four-event reconciliation, pending retries, drift, RPC retry/splitting.
- [x] Retroactive scans preserve normal cursor and cannot introduce skipped gaps.
- [x] Query/index audit for marketplace, history, queues, admin, ledger, and events.
- [x] Fresh + upgrade migration E2E.
- [x] PostgreSQL dump/restore exact-integrity drill and operations policy.

Exit evidence: migration, money-loop, invariant, ambiguity, race, and restore gates
pass locally.

### 1.4 Independent review (EXTERNAL GATE)

Repository preparation:

- [x] Threat model.
- [x] Contract/backend audit scope and reproducible commands.
- [x] Frozen design decisions and deployment checklist.
- [x] Findings severity/closure policy.
- [x] Incident, pause/rotation, successor, reconciliation, and recovery runbooks.

External actions still required:

- [ ] independent smart-contract audit;
- [ ] independent focused backend security review;
- [ ] findings entered without filtering;
- [ ] zero open Critical/High;
- [ ] every Medium fixed or explicitly accepted with owner and expiry;
- [ ] reviewed commit SHA frozen.

Phase 1 implementation is complete. Mainnet release authorization remains blocked
until these external-review boxes close.

## Phase 2 - Production-like staging and observability (NEXT)

Status: **READY TO START**. Goal: prove operational behavior, not only local
correctness. Phase 2 uses isolated, non-mainnet-value infrastructure and may run in
parallel with independent review.

### 2.1 Staging foundation

- [ ] provision managed Postgres with PITR, Redis, dedicated RPC, TLS frontend/API,
  and a separately supervised reconciliation worker;
- [ ] define environment ownership, network boundaries, least-privilege service
  identities, resource limits, and cost guardrails;
- [ ] apply versioned migrations, seed only synthetic data, run deep health checks,
  and prove the worker starts from the configured deployment block;
- [ ] record infrastructure/configuration as reproducible code or an equivalently
  reviewable change record.

Exit evidence: staging topology is reproducible, isolated, healthy, backed up, and
contains no production/mainnet secret or value.

### 2.2 Secrets, signer, and authority operations

- [ ] place JWT, gateway, database, Redis, RPC, and envelope keys in a managed secret
  store; no plaintext operational secret in image, repository, or frontend env;
- [ ] use KMS/restricted signer custody, enforce one logical nonce writer, and monitor
  signer address, nonce, gas balance, submission age, and replacement behavior;
- [ ] configure proposed multisig, treasury, guardian, fee manager, and settler roles
  with named owners and escalation paths;
- [ ] drill envelope-key rotation, agent secret rotation/revoke, settler rotation,
  pause/unpause authorization, and signer compromise response.

Exit evidence: every secret/authority has an owner, least privilege, monitored use,
and a successful rotation/revocation drill.

### 2.3 Observability and operator readiness

- [ ] emit structured logs and deploy metrics, error tracking, dashboards, deep
  readiness, worker heartbeat, and alert transport;
- [ ] cover API/upstream latency/error, DB pool, Redis failure, signer nonce/gas,
  outbox state/age, cursor/safe-head lag, RPC 429/timeout, pending events, drift,
  solvency, and backup age;
- [ ] route actionable alerts to a real operator with severity, runbook, dedupe,
  acknowledgement, and escalation policy;
- [ ] prove alert delivery for stale worker, drift, signer low balance, RPC failure,
  database pressure, and backup/PITR failure.

Exit evidence: injected failures reach an operator and link to a usable runbook.

### 2.4 Real wallet and product validation

- [ ] automate real MetaMask and at least one injected-wallet path: connect, reject,
  reconnect, wrong chain, auth, deposit, paid call, ambiguous recovery, earnings,
  claim, and session expiry;
- [ ] run accessibility and visual regression on critical routes/states;
- [ ] establish per-route JS/LCP/INP/CLS/WebGL budgets and capture a staging baseline;
- [ ] investigate reachability and upstream disposition for the six transitive
  MetaMask-tree Moderate advisories.

Exit evidence: critical wallet/money journeys pass in a real browser and performance,
accessibility, and dependency-risk decisions are recorded.

### 2.5 Load, failure, and recovery drills

- [ ] load concurrent paid calls, signer nonce pressure, API/worker throughput, DB
  pool saturation, Redis quota pressure, and dense event ranges;
- [ ] drill API/worker down for one hour, DB/Redis disconnect, RPC 429/timeout/failover,
  restart mid-settlement, and known/unknown broadcast ambiguity;
- [ ] simulate the chosen reorg policy and verify confirmation/cursor behavior;
- [ ] restore managed backup/PITR into a clean environment and measure RPO/RTO;
- [ ] agree catch-up, latency, error, outbox-age, and recovery SLOs from measured data.

Exit evidence: no duplicate debit/credit, no skipped chain range, measured SLOs are
met, and recovery leaves zero unexplained drift.

### 2.6 Soak and Phase 2 exit

- [ ] run staging continuously for at least 72 hours with synthetic paid traffic,
  worker restarts, alerts enabled, and daily financial reconciliation;
- [ ] maintain zero unexplained drift, no stale terminally recoverable outbox row,
  no unresolved Critical/High finding, and no unowned alert;
- [ ] freeze a staging release candidate and attach configuration, dashboards, drill
  results, restore evidence, dependency disposition, and operator sign-off.

Phase 2 exit gate: alerts reach an operator, one-hour catch-up meets the agreed SLO,
real-wallet money/recovery loops pass, managed restore meets RPO/RTO, the 72-hour soak
is clean, and the evidence packet is approved. Phase 3 additionally requires the
independent Phase 1 review gate to be closed.

## Phase 3 - Controlled mainnet release (LATER)

1. deploy/verify the audited frozen contract and record parameters/block;
2. apply migrations and configure API/worker from the exact block;
3. require worker catch-up and zero drift before enabling writes;
4. low-value allowlisted canary;
5. verify balances, liabilities, calls, claims, revenue, cursor, alerts, and role
   ownership;
6. expand only after canary exit gate and incident owner approval.

## Phase 4 - Closed beta and builder platform (LATER)

- JavaScript/Python SDKs for HMAC and typed requests;
- agent edit/versioning, endpoint test, approval notifications/webhooks;
- builder analytics, user report creation, moderation workflow;
- API versioning, cursor pagination, idempotency keys, webhook retries/signatures;
- privacy retention/delete/export controls and product telemetry classification.

## Phase 5 - Scale and product expansion (LATER)

- distributed worker lease and isolated horizontally scalable signer service;
- multi-RPC failover, backpressure, autoscaling, cost controls;
- daily financial/marketplace rollups and reconciliation exports;
- multi-deployment migration/history tooling;
- frontend performance budgets/device tiers;
- evaluate multi-chain only after one deployment is operationally stable.

## Immediate ordered flow

1. preserve the verified implementation baseline in
   [PHASE_1_HANDOFF.md](./PHASE_1_HANDOFF.md);
2. engage external reviewers with [AUDIT_READINESS.md](./AUDIT_READINESS.md);
3. begin Phase 2.1 staging foundation without mainnet value;
4. complete Phase 2.2-2.5 operational, wallet, load, failure, and restore evidence;
5. close/re-review external findings while the 72-hour Phase 2.6 soak runs;
6. only after both gates close, freeze a Phase 3 controlled-mainnet candidate.
