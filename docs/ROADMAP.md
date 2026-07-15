# Velostra roadmap

> Updated after final internal audit clearance: 2026-07-16.
> Baseline: Phase 0-3 repository preparation is complete and internally cleared;
> controlled mainnet execution has not started.
> Independent review and managed evidence are tracked as mainnet release prerequisites,
> not blockers for continued development.

## Status model

- **DONE**: repository implementation, tests, documentation, and internal audit pass.
- **MAINNET PREREQUISITE**: external evidence required before real-value deployment;
  it does not block continued non-mainnet development.
- **NEXT**: active preparation or product-development scope.
- **LATER**: intentionally sequenced after an operational release milestone.

Repository phase completion and mainnet release authorization are tracked separately.

## Phase 0 - Recoverable product foundation (DONE)

Delivered:

- premium responsive frontend, semantic URLs/query state, Crystal V assets, and
  MetaMask + EIP-6963/injected provider picker;
- wallet auth, marketplace, builder/admin/dashboard product surfaces;
- escrow top-up, paid 90/10 call, claim, platform withdrawal;
- `bytes32 callId` correlation, four-event indexer, missed-report backfill, drift,
  retroactive scan, and conditional race safety.

Exit gate: one local recoverable end-to-end product loop. Passed.

## Phase 1 - Mainnet design freeze and security hardening (DONE)

Status: **DONE; internal engineering/CI audit PASS**.

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

### 1.4 Independent review (MAINNET PREREQUISITE)

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

Phase 1 repository work is complete and internally cleared. These independent-review
boxes remain mandatory before mainnet authorization, but they do not block continued
non-mainnet development.

## Phase 2 - Production-like staging and observability (DONE)

Status: **DONE; internal engineering/CI audit PASS; continued development CLEAR**.
The code, topology, automation, test harnesses, SLO candidates, and fail-closed
release packet are complete. Velostra still has no recorded mainnet deployment or
mainnet-value authorization. Unchecked items below require managed infrastructure,
elapsed wall-clock time, a real wallet, an independent reviewer, or a human operator.
They are mainnet release prerequisites, not incomplete repository implementation,
and must never be inferred from local tests.

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

Phase 2 repository exit is **CLOSED / PASS**. Continued non-mainnet development is
approved. Every unchecked external item remains a mainnet release prerequisite and
must be satisfied before real value is authorized.


## Phase 3 - Controlled mainnet release preparation (REPOSITORY DONE; EXECUTION GATED)

Status: **repository implementation and local gates DONE**. No mainnet broadcast,
deployment, canary, or expansion is claimed. The unchecked execution items require
external evidence and accountable operator authorization.

### 3.1 Immutable release identity (DONE)

- [x] Canonical SHA-256 manifest binds full commit, clean tree, contract/artifact,
  ABI/bytecode, migration journal and migrations, lockfiles, policies, image digests,
  chain/roles, reconciliation limits, evidence, ticket, and distinct approvals.
- [x] Preparation, broadcast-approved, and deployed stages validate separately.
- [x] Tamper, dirty-tree, path escape, cross-release evidence, missing digest,
  duplicate approver, and malformed authorization tests fail closed.

### 3.2 Guarded deployment and readiness (DONE)

- [x] Offline plan reports `broadcastPerformed: false` by default.
- [x] Broadcast requires `--broadcast`, explicit sentinel, and exact manifest hash,
  release, ticket, deployer, constructor, chain, and artifact match.
- [x] Finalize exact transaction/address/block into a deployed manifest.
- [x] Verify receipt, runtime bytecode/immutables, token, fee, pause, solvency,
  successor, and all authorities.
- [x] Collect live database/RPC/contract/signer/worker/backup/outbox/drift/alert
  readiness evidence.
- [x] Emit deterministic GO/NO-GO and one-hour catch-up PASS/FAIL artifacts without
  mutating traffic state.

### 3.3 Bounded canary and safe stop (DONE)

- [x] Mainnet-like startup requires explicit Phase 3 approval and exact deployed
  manifest; the legacy Phase 2 bypass is removed.
- [x] Paid writes default disabled and canary policy is hash/release bound.
- [x] Enforce subject allowlists, duration, per-call, call-count, per-wallet, and
  total-gross limits.
- [x] Serialize concurrent admission with a transaction-scoped Postgres lock and
  persist it with reservation/outbox creation.
- [x] Mark admission through the conditional exactly-once settlement state machine;
  claims and reconciliation remain available during stop.
- [x] Build automatic summary, deterministic stop plan, and
  `PASS_AWAITING_OPERATOR` with `expansionAuthorized: false`.
- [x] Require hash-bound passing exit evidence plus explicit operator approval before
  public paid-write mode.
- [x] Gate release tooling, config, Postgres cap races, migrations, and container
  assets in CI.

### 3.4 Controlled execution (MAINNET PREREQUISITE)

- [ ] Close independent contract/backend review and every managed Phase 2 evidence gate.
- [ ] Freeze image digests and create the two-person `broadcast-approved` manifest.
- [ ] Execute backup/migration, deploy once, verify, and store deployed evidence.
- [ ] Capture readiness `GO` while paid writes remain disabled.
- [ ] Execute only the low-value allowlisted canary; stop on any failed threshold.
- [ ] Obtain incident-owner approval, then enable public paid writes.
- [ ] Observe stable operation before declaring the operational Phase 3 exit.

Repository exit: **PASS**. Operational/mainnet exit: **NOT RUN / GATED**.

## Phase 4 - Closed beta and builder platform (NEXT; REPOSITORY WORK CLEAR)

Status: **next repository focus**. Local and isolated non-mainnet implementation may
begin from the cleared Phase 0-3 baseline. Closed-beta activation, public traffic,
and real-value use remain gated by the operational Phase 3 exit.

### 4.1 Versioned platform interfaces

- [ ] Freeze a backward-compatible `/api/v1` contract and deprecation policy.
- [ ] Add cursor pagination and bounded query contracts to list/history surfaces.
- [ ] Add durable idempotency keys to externally retried mutation endpoints.
- [ ] Publish typed JavaScript and Python SDKs for wallet/HMAC auth, agent calls,
  errors, pagination, and idempotent retries.
- [ ] Add contract/SDK fixtures that prove byte-for-byte HMAC compatibility.

### 4.2 Agent lifecycle and builder operations

- [ ] Add agent edit/version history with immutable published revisions and rollback.
- [ ] Add guarded endpoint tests that reuse the production SSRF/timeout/size policy.
- [ ] Add approval-state notifications and builder-owned webhook subscriptions.
- [ ] Add builder analytics for calls, success/error rates, gross volume, earnings,
  claims, latency, and version performance.
- [ ] Preserve the current settlement/outbox invariants across every new workflow.

### 4.3 Reliable integrations

- [ ] Sign webhooks, store delivery attempts, and implement bounded exponential retry.
- [ ] Prevent duplicate delivery effects with stable event and idempotency identities.
- [ ] Add pause/replay/dead-letter operator controls with RBAC and audit logs.
- [ ] Document event schemas, rotation, verification, retry, and recovery behavior.

### 4.4 Trust, moderation, privacy, and telemetry

- [ ] Add user report creation, evidence-safe moderation queues, and resolution history.
- [ ] Add builder/user export, deletion, and retention controls with financial/audit
  records retained only where policy requires them.
- [ ] Classify every telemetry field, prohibit secrets/private prompts, and define
  retention/ownership before enabling collection.
- [ ] Extend admin permissions, audit logging, and adversarial tests for the new scope.

### 4.5 Phase 4 proof and exit

- [ ] Add migrations, upgrade/rollback fixtures, API/SDK contract tests, webhook race
  tests, and end-to-end builder/report/moderation journeys.
- [ ] Keep accessibility, collision, routing-state, performance, security, dependency,
  and financial recovery gates green.
- [ ] Update every affected architecture, API, schema, builder, operations, security,
  testing, status, and roadmap document.
- [ ] Complete one isolated closed-beta product loop with synthetic value and no
  unexplained financial or delivery drift.

Repository exit gate: Phase 4 implementation, tests, migrations, and documentation
pass locally and in CI. Activation gate: operational Phase 3 exit plus accountable
closed-beta approval; repository completion alone cannot enable real users or value.

## Phase 5 - Scale and product expansion (LATER)

- distributed worker lease and isolated horizontally scalable signer service;
- adaptive provider scoring, backpressure, autoscaling, and cost controls;
- daily financial/marketplace rollups and reconciliation exports;
- multi-deployment migration/history tooling;
- frontend performance budgets/device tiers;
- evaluate multi-chain only after one deployment is operationally stable.

## Immediate ordered flow

### Repository/product lane (next)

1. freeze Phase 4 API, identity, pagination, idempotency, and migration contracts;
2. implement versioned interfaces plus JavaScript/Python SDK compatibility fixtures;
3. build agent versioning, endpoint tests, builder analytics, and notifications;
4. build signed/retried webhooks, reports, moderation, privacy, and telemetry controls;
5. close the isolated Phase 4 E2E, security, migration, browser, and documentation gates.

### Mainnet/activation lane (still gated)

1. close independent review and every managed Phase 2 release prerequisite;
2. freeze commit, image digests, policies, constructor, and approvals;
3. run plan/readiness with paid writes disabled;
4. broadcast only through the guarded command under the approved ticket;
5. run bounded canary and expand only after separate operator approval.

Phase 4 code may be developed and tested locally while the activation lane is open.
No Phase 4 feature may bypass the existing deployment, canary, money, or operator gates.
