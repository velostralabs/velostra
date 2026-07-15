# Velostra roadmap

> Updated from the Phase 1 implementation audit: 2026-07-15.

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

## Phase 1 - Mainnet design freeze and security hardening

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

Phase 1 release exit gate is not claimable until these external boxes close.

## Phase 2 - Production-like staging and observability (NEXT)

Goal: prove operational behavior, not only local correctness.

1. managed Postgres with PITR, Redis, dedicated RPC, API, worker, and TLS frontend;
2. secret manager/KMS or restricted signer, gas/nonce/balance monitoring, and
   rotation drill;
3. structured logs, metrics, error tracking, deep readiness, dashboards, and alert
   delivery to an operator;
4. minimum metrics: API/upstream latency/error, DB pool, Redis failure, signer
   nonce/gas, outbox state/age, worker heartbeat/cursor/safe-head lag, RPC 429/
   timeout, pending events, drift, solvency;
5. real MetaMask and at least one injected-wallet E2E: connect/reject/wrong-chain,
   auth, deposit, paid call, ambiguous recovery, earnings, claim;
6. load test concurrent paid calls and signer pressure;
7. chaos drills: API/worker down one hour, DB/Redis disconnect, RPC throttle/failover,
   restart mid-settlement, known/unknown broadcast ambiguity, and reorg simulation;
8. managed backup/PITR restore and RPO/RTO measurement;
9. triage the transitive web moderate advisory;
10. 72-hour soak with no unexplained drift.

Exit gate: alerts reach an operator, one-hour catch-up meets an agreed SLO, money
loop and recovery work on staging, restore works, and soak is clean.

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

1. finish local full regression and owner review of the unpushed micro-commits;
2. freeze the approved commit and engage reviewers with
   [AUDIT_READINESS.md](./AUDIT_READINESS.md);
3. while review runs, build Phase 2 staging/observability without mainnet value;
4. close/re-review findings;
5. run staging chaos/load/wallet/restore/soak gates;
6. only then authorize controlled mainnet deployment.