# Velostra roadmap

> Updated after Phase 2 repository implementation: 2026-07-15.
> Baseline: Phase 1 handoff plus locally committed Phase 2 automation; Phase 2 exit evidence remains open.

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

## Phase 2 - Production-like staging and observability (IMPLEMENTED / EVIDENCE PENDING)

Status: **repository implementation complete; operational exit not yet approved**.
The code, topology, automation, test harnesses, SLO candidates, and fail-closed
release packet are ready. Velostra still has no recorded mainnet deployment or
mainnet-value authorization. The unchecked items below require external managed
infrastructure, elapsed wall-clock time, a real wallet profile, or a human operator;
they must never be inferred from local tests.

### 2.1 Staging foundation

- [x] Commit isolated API/web/worker/monitor/migration topology, non-root images,
  role-specific env scopes, health checks, resource limits, and network boundaries.
- [x] Make versioned migration, configured deployment block, synthetic-only data,
  deep readiness, and reproducible configuration part of the deployment contract.
- [x] Require a full 40-character frozen release SHA and block production or any
  mainnet-like startup unless the later release approval is explicit.
- [ ] Instantiate managed Postgres with PITR, managed Redis, dedicated primary and
  fallback RPCs, TLS ingress, registry, and secret store in an isolated account.
- [ ] Attach provider configuration, backup status, health output, and cost ownership
  to the hashed release packet.

### 2.2 Secrets, signer, and authority operations

- [x] Require managed secret injection and reject plaintext production signer keys.
- [x] Use a restricted remote signer with correlated idempotency keys, one logical
  nonce writer, signer-identity verification, and a bounded response payload;
  validate signer/role authority policy and rotation runbooks.
- [x] Cover remote signer authorization, timeout, malformed response, mismatch,
  idempotency, authority ownership, and unsafe configuration with automated tests.
- [ ] Execute managed JWT/HMAC/envelope/signer rotations, agent revoke, pause/unpause,
  settler replacement, and compromise response with named operators.
- [ ] Attach KMS/secret-manager audit logs and signed authority ownership evidence.

### 2.3 Observability and operator readiness

- [x] Emit structured logs, Prometheus metrics, request timing, deep readiness,
  worker/backup heartbeat, durable alerts, dedupe, acknowledgement, resolution,
  clean acknowledgement reset on reopen, and webhook delivery metadata.
- [x] Track dependency health/latency, DB pool, Redis, signer gas, RPC, cursor lag,
  pending events, outbox age/state, drift, solvency, and backup freshness.
- [x] Commit dashboard, alert rules, monitor worker, and alert lifecycle tests.
- [ ] Deliver stale-worker, drift, signer-low, RPC, database-pressure, and backup
  failures to a real operator and record acknowledgement/escalation evidence.
- [ ] Attach the production error-tracking destination and redaction verification.

### 2.4 Real wallet and product validation

- [x] Automate injected-wallet reject/reconnect/wrong-chain/auth/deposit/paid-call/
  ambiguous-recovery/earnings/claim/session-expiry behavior in a real Chromium page.
- [x] Provide a guarded real-MetaMask isolated-staging harness for the same journey.
- [x] Gate critical routes with keyboard/focus, serious/critical axe checks, desktop
  collision/overflow assertions, visual baselines, URL/history tests, and bundle/
  LCP/INP/CLS/WebGL budgets.
- [x] Record the time-bounded MetaMask `uuid` advisory reachability disposition and
  fail CI if the reviewed call pattern changes.
- [ ] Run the MetaMask harness with a dedicated extension profile and synthetic
  staging value, then hash its evidence.
- [ ] Capture performance baselines against the frozen managed-staging release.

### 2.5 Load, failure, and recovery drills

- [x] Exercise concurrent paid calls, DB reservation pressure, Redis per-agent quota,
  serialized signer submissions, unique call/hash correlation, and exactly-once money.
- [x] Exercise known/unknown broadcast ambiguity, live/worker race, post-chain DB
  rollback, dense missed events, idempotent replay, confirmation-window reorg, and
  canonical replacement on local Postgres/Redis/EVM.
- [x] Add deterministic primary-429 to secondary-RPC failover and gap-free range
  planning tests; production accepts multiple credential-free HTTPS RPC endpoints.
- [x] Add guarded staging load runner with bounded request deadlines, candidate SLOs,
  timed dump/restore evidence, and CI artifact upload. Local reference: 12 concurrent
  requests produced ten
  successful settlements plus two intentional limits; 27-block catch-up completed
  with zero drift.
- [ ] Hold API/worker down for a real hour in managed staging, inject DB/Redis/RPC
  failures and restart mid-settlement, then prove catch-up within the candidate SLO.
- [ ] Restore a provider-native managed PITR point into a clean environment and meet
  the recorded RPO/RTO objectives.
- [ ] Calibrate/freeze the candidate latency, error, catch-up, outbox-age, and restore
  SLOs from managed-staging measurements.

### 2.6 Soak and Phase 2 exit

- [x] Add a guarded minimum-72-hour soak runner with immutable release attestation,
  continuous readiness/metrics, synthetic paid calls, daily clean reconciliation,
  outbox/drift checks, interrupt-safe checkpoints, and external restart/findings input.
- [x] Add SHA-256-bound evidence manifest validation for soak, load, one-hour outage,
  managed PITR, real wallets, alert delivery, worker restarts, findings, configuration,
  dashboards, dependency disposition, and operator sign-off.
- [x] Prove the evidence validator accepts a complete packet and rejects tampering.
- [ ] Run the frozen candidate continuously for at least 72 hours with at least one
  verified worker restart and three daily reconciliation checkpoints.
- [ ] Maintain zero unexplained drift, zero stale recoverable outbox row, zero
  unresolved High/Critical finding, and zero unowned alert for the entire run.
- [ ] Sign and approve the final evidence manifest as the accountable operator.

Phase 2 exit remains **OPEN** until every unchecked external item above is evidenced
and `npm run phase2:evidence -- --manifest=...` passes on the signed packet. Phase 3
also requires the independent Phase 1 contract/backend review gate to close.


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
- adaptive provider scoring, backpressure, autoscaling, and cost controls;
- daily financial/marketplace rollups and reconciliation exports;
- multi-deployment migration/history tooling;
- frontend performance budgets/device tiers;
- evaluate multi-chain only after one deployment is operationally stable.

## Immediate ordered flow

1. provision the committed topology in an isolated managed-staging account;
2. execute signer/authority rotation and real-operator alert-delivery drills;
3. run real MetaMask, frozen staging performance, one-hour outage, and managed PITR evidence;
4. calibrate/freeze candidate SLOs, then run the minimum 72-hour soak;
5. hash every artifact, obtain operator sign-off, and pass phase2:evidence;
6. close the independent Phase 1 review gate; only then freeze a Phase 3 candidate.
