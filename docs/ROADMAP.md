# Velostra roadmap

> Updated after managed US staging verification: 2026-07-19.
> Baseline: Phase 0-4 repository preparation is complete and internally cleared;
> controlled mainnet execution has not started.
> Independent review and managed evidence are tracked as mainnet release prerequisites,
> not blockers for continued development.
> Chronological delivery record and current handoff: [JOURNEY.md](./JOURNEY.md).

## Status model

- **DONE**: repository implementation, tests, documentation, and internal audit pass.
- **MAINNET PREREQUISITE**: external evidence required before real-value deployment;
  it does not block continued non-mainnet development.
- **NEXT**: active preparation or product-development scope.
- **LATER**: intentionally sequenced after an operational release milestone.

Repository phase completion and mainnet release authorization are tracked separately.

## Deployment truth

The static protocol preview is live at `https://velostra.xyz/` through the Velostra
Netlify team. GitHub `main` builds with Node.js 22 using tracked `netlify.toml` and
publishes `dist/`; TLS, apex/www routing, hashed assets, and browser rendering were
verified on 2026-07-18.

A separate US-only Robinhood testnet stack is live: three verified Safe authorities,
a verified synthetic token and escrow, immutable private signer/public API/isolated
web services, migration, reconciliation/webhook/monitor jobs, and staggered Scheduler
triggers. Deep readiness passes, the web origin is bound, the signer is private, and
paid writes remain disabled. Managed staging has also passed a direct-deposit,
skipped-report reconciliation repair with the report endpoint intentionally omitted.
The public preview still has no staging API/escrow/token build values and closes no
Phase 2/3/4 activation or evidence gate. No closed beta,
mainnet contract, or real-value flow is live.

## Phase 0 - Recoverable product foundation (DONE)

Delivered:

- premium responsive frontend, semantic URLs/query state, Crystal V assets, and
  MetaMask + EIP-6963/injected provider picker;
- public Netlify protocol preview with canonical `velostra.xyz`, TLS, SPA fallback,
  reproducible Vite build/publish configuration, and privacy-safe Velostra identity;
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
- [x] Freeze the low-cost staging target to Robinhood testnet chain 46630, GCP
  us-east4, Neon aws-us-east-1, Upstash GCP us-east4, no paid RPC, and a USD 35
  monthly envelope.
- [x] Commit plan-only US bootstrap, bounded Cloud Run service/job deployment,
  immutable image build/deploy, safe Secret Manager input, KMS address derivation,
  explicit migration, and a fail-closed deployment-plan test.
- [x] Publish the separate static protocol preview on Netlify with a tracked `dist/`
  build contract; keep all managed API/contract values absent until staging exists.
- [x] Instantiate Neon Postgres, Upstash Redis, Alchemy primary plus Robinhood public
  fallback RPC, and the GCP registry/KMS/Secret Manager foundation in approved US
  regions; verify connectivity and chain identity without publishing credentials.
- [x] Select a private Telegram bot/channel transport with bounded, redacted payloads.
- [x] Load its bot-token/channel-ID secrets through a hidden prompt and prove direct
  delivery without exposing either value.
- [x] Prepare three disjoint canonical Safe 1.4.1 2-of-3 authority sets with
  CSPRNG/DPAPI testnet-only custody; verify unique predictions, canonical factory
  availability, isolated settler, and plan-only clean-tree broadcast tooling.
- [x] Fund the isolated deployer with valueless testnet ETH, deploy/verify the three
  Safes plus synthetic token and VelostraEscrow, deploy immutable Cloud Run
  signer/API/web workloads and scheduled jobs, bind the web origin, execute migration,
  and pass deep readiness while paid writes remain disabled.
- [ ] Prove the complete runtime alert acknowledgement/resolution lifecycle and attach
  provider-native backup/recovery evidence.
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
- [x] Provision one idempotent approved USDG 1.20 synthetic agent behind a bounded,
  stateless, secretless US-staging Cloud Run service; exhaust only its dedicated
  test-wallet free tier while keeping API paid writes disabled.
- [ ] Run the MetaMask harness with the dedicated extension profile and provisioned
  synthetic staging value, then hash its evidence.
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
- [x] Capture managed skipped-report recovery evidence with a direct synthetic-token
  escrow deposit, missing Postgres precondition, worker backfill, safe cursor advance,
  Scheduler cleanup, and paid writes disabled.
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

## Phase 4 - Closed beta and builder platform (REPOSITORY DONE; ACTIVATION GATED)

Status: **repository implementation complete**. The versioned platform, SDKs,
builder lifecycle, webhook delivery, trust/privacy controls, migrations, console
surfaces, operations roles, and repository tests are implemented. Closed-beta
activation, public traffic, and real-value use remain gated by the operational
Phase 3 exit and accountable approval.

### 4.1 Versioned platform interfaces (DONE)

- [x] Freeze a backward-compatible /api/v1 contract and deprecation policy.
- [x] Add tamper-evident cursor pagination and bounded query contracts.
- [x] Add durable actor/operation/fingerprint-bound idempotency records.
- [x] Fail closed on expired indeterminate mutations instead of risking blind replay.
- [x] Publish typed JavaScript and Python SDKs for auth, calls, errors, pagination,
  idempotent retries, HMAC, and webhook verification.
- [x] Prove byte-for-byte JavaScript/Python/server HMAC compatibility with shared fixtures.

### 4.2 Agent lifecycle and builder operations (DONE)

- [x] Add immutable published revisions, active-revision call correlation, publish,
  approval reset, and rollback.
- [x] Add guarded endpoint probes that reuse production SSRF/timeout/size policy.
- [x] Add approval-state notifications and builder-owned webhook subscriptions.
- [x] Add bounded call history and exact builder analytics for calls, success/errors,
  gross, earnings, claims, latency, agents, and revisions.
- [x] Preserve settlement/reservation/outbox invariants across every workflow.

### 4.3 Reliable integrations (DONE)

- [x] Sign exact webhook body bytes and persist events, deliveries, and every attempt.
- [x] Deliver at least once with stable event identity, claim locks, bounded exponential
  retry, pause/resume, secret rotation, and soft deletion.
- [x] Add RBAC/audited dead-letter inspection, attempt history, replay, and emergency pause.
- [x] Add a separately supervised webhook worker, heartbeat, readiness, metrics, and alerts.

### 4.4 Trust, moderation, privacy, and telemetry (DONE)

- [x] Add authenticated user reports with classified, size-bounded evidence.
- [x] Add assign/resolve transition history, conditional race safety, notifications,
  builder webhooks, RBAC, and audit logs.
- [x] Add export/delete requests with explicit retention of required financial,
  settlement, security, and audit evidence plus anonymization of personal fields.
- [x] Add allowlisted telemetry classification/ownership/retention controls and fail
  closed on prohibited or unclassified fields.

### 4.5 Phase 4 proof and exit (DONE LOCALLY)

- [x] Add migration 0008_phase4_platform.sql, fresh/upgrade/restore inventory checks,
  API/SDK contracts, race tests, and isolated PostgreSQL platform E2E.
- [x] Prove concurrent idempotency, immutable revision publish, webhook claiming,
  dead-letter replay, moderation, privacy, cursor tamper, and zero aggregate drift.
- [x] Keep the existing lint, build, browser, security, contract, financial recovery,
  Phase 2 evidence, and Phase 3 release/canary gates in the CI matrix.
- [x] Update architecture, API, schema, builder, operations, security, testing,
  status, roadmap, deployment, and audit documents.

Repository exit: **PASS locally and in remote CI after final audit**. Product
verification and staging artifact verification both completed successfully on
GitHub Actions after the Phase 4 publication and CI-hardening commits.
Activation gate: operational Phase 3 exit plus managed evidence and accountable
closed-beta approval. Repository completion cannot enable real users or value.

## Phase 5 - Scale and product expansion (NEXT REPOSITORY PLANNING)

- distributed worker lease and isolated horizontally scalable signer service;
- adaptive provider scoring, backpressure, autoscaling, and cost controls;
- daily financial/marketplace rollups and reconciliation exports;
- multi-deployment migration/history tooling;
- frontend performance budgets/device tiers;
- evaluate multi-chain only after one deployment is operationally stable.

## Immediate ordered flow

This ordered flow is mirrored with milestone context and checkpoint definitions in
[JOURNEY.md](./JOURNEY.md).

### Staging/evidence lane (active external next)

1. retain the verified public preview and the deployed write-disabled US testnet stack;
2. run the real MetaMask journey for auth, top-up, paid call, builder credit, and claim;
   retain its frozen staging performance evidence (the synthetic skipped-report repair
   is already complete);
3. exercise alert failure, acknowledgement, and resolution plus secret/authority,
   pause/unpause, signer-rotation, and compromise-response drills;
4. run one-hour outage/provider faults, provider-native PITR, and minimum 72-hour soak
   without claiming completion early;
5. calibrate SLOs, close independent review, and retain all outputs under ignored
   artifacts until the final signed evidence packet.

### Repository/product lane

1. keep Phase 0-4 regression, migration, browser, SDK, and financial gates green;
2. freeze Phase 5 scope before implementation;
3. prioritize distributed work ownership, rollups/exports, provider backpressure,
   and cost/performance observability;
4. retain backward-compatible /api/v1 and published revision/webhook contracts;
5. treat any contract or financial-boundary change as a new audit-scope change.

### Mainnet/activation lane (still gated)

1. close independent review and every managed Phase 2 release prerequisite;
2. freeze commit, image digests, policies, constructor, and approvals;
3. run plan/readiness with paid writes disabled;
4. broadcast only through the guarded command under the approved ticket;
5. run bounded canary and expand only after separate operator approval;
6. activate closed beta only after webhook/operator/retention controls are proven in
   the same managed environment.

No Phase 4 or Phase 5 feature may bypass deployment, canary, money, privacy, or
operator gates.
