# Velostra status

> Status truth refreshed 2026-07-22. Managed evidence and current CI references are
> indexed below; public testnet remains the proof surface while mainnet stays fail-closed.
> Repository decision: Phase 0-4 repository preparation is complete and internally
> verified. The public Robinhood Chain testnet checkpoint is **PASS**.
> No mainnet deployment or real-value authorization is recorded.
> Public deployment: `https://velostra.xyz/testnet` is connected to the US-only
> chain-46630 API, synthetic token, escrow, private signer, workers, and Scheduler.
> Deep readiness is 8/8 and bounded public synthetic paid writes are enabled.
> Managed evidence includes skipped-report repair, bounded real-MetaMask execution,
> exact reconciled claim verification, private Telegram alert lifecycle,
> provider-native PITR, one-hour catch-up, and read-only control readiness.
> Chronological handoff and ordered next work: [JOURNEY.md](./JOURNEY.md).

The user-facing testnet uses only test ETH and resettable synthetic USDG. Public mode
is bounded by per-call, per-wallet, daily-global, top-up, and sensitive-action caps.
Raw identifiers remain ignored; see [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md).

## 2026-07-22 brutal audit closeout candidate

The public repository head `1c22d08462f7c49f7380266b35e74da360706a73`
has one truthful remote discrepancy: Staging artifact verification passed, while
Product verification failed only because Chromium Event Timing emitted zero entries
for a homepage click that completed faster than the observer threshold. The dialog
opened and every product assertion around it passed. The local closeout candidate
now accepts that standards-compliant zero-entry case while continuing to enforce the
200 ms INP budget whenever Event Timing emits an interaction.

The same candidate passed the full 31-scenario Chromium matrix: 30 deterministic
checks passed and only the explicitly guarded real-MetaMask extension journey was
skipped. It also passed lint/build, documentation and hosting integrity, all ten
contract local-EVM groups, Phase 2 evidence tamper checks, Phase 3 release/mainnet
readiness tests, Phase 4 SDK/RBAC contracts, backend auth/HTTP/SSRF/secrets/signer/
KMS/resilience/observability policies, testnet Safe authority policy, and production
dependency audits. Server production dependencies report zero vulnerabilities; the
six Moderate web entries remain the documented unreachable MetaMask/UUID condition.

Live `https://velostra.xyz` was checked independently of the fixture: apex, `www`,
and Netlify-host redirects are canonical; production security headers are present;
all public routes render without broken images, horizontal overflow, clipped controls,
or visible text collisions at 1920, 1366, and 1024 desktop widths; managed health and
deep readiness pass 8/8 on chain 46630. One first cold-instance probe correctly
failed closed with `snapshot=false`; the next eight probes passed 8/8. The candidate
now awaits the bounded first observability snapshot before opening the HTTP listener,
removing that healthy cold-start false degradation after the backend is redeployed.
Repository homepage metadata now points to the canonical domain. GitHub secret
scanning, push protection, vulnerability alerts, and Dependabot security updates are
enabled.

A new non-shallow history gate scanned all 285 existing commits and found no private
identity, local user path, token, private key, credential URL, Indonesian identity
number, or non-public email domain. The gate reports only category, short commit, and
path, never a matched value. Product verification remains truthfully red on the
published head until this candidate is committed and pushed; no remote-green claim is
made in advance.

## Executive status

Velostra now includes the repository-side Phase 4 platform on top of the cleared
financial and release foundation: a backward-compatible /api/v1 surface, opaque
signed cursors, durable idempotency, JavaScript/Python SDKs, immutable agent
revisions, builder analytics/notifications, signed reliable webhooks, moderation,
privacy workflows, telemetry governance, and dedicated webhook operations.

The platform preserves every existing money invariant. Calls remain revision-linked;
externally retried mutations are actor/operation/fingerprint bound; expired
indeterminate idempotency records fail closed; webhook events/deliveries/attempts
are durable; and concurrent revision, delivery, moderation, privacy, canary, and
settlement transitions use database ownership/conditional updates.

Repository implementation and local verification for Phase 0-4 are **CLEAR / PASS**.
This is not activation or mainnet authorization. No mainnet deployment or real-value
authorization is recorded. Independent review, multi-operator custody mutations,
signed release approval, and accountable closed-beta approval remain external gates.
The 72-hour checkpoint disposition is `PASS_BY_OWNER_WAIVER`; execution is
`NOT_RUN`, and no 72-hour telemetry is claimed.

The canonical frontend is publicly deployed through the Velostra Netlify team and
Git-linked `velostralabs/velostra` `main` branch. The canonical TLS origin is
`https://velostra.xyz/`; `https://www.velostra.xyz/` redirects to it, and
`https://velostra.netlify.app/` remains the provider default. The tracked deployment
contract runs `npm run build` under Node.js 22 and publishes only `dist/`.

Its production testnet configuration binds the browser to the managed API, verified
escrow, and synthetic settlement token. `/testnet` provides wallet connection,
official faucet guidance, bounded synthetic minting, and the execution entry point.
Server-side auth, receipt, quota, pricing, and settlement checks remain authoritative.
The browser now refuses to reuse an authenticated session after the active wallet
changes, blocks protected surfaces on the wrong chain, synchronizes one successful
wallet verification across every gate on the page, and continuously refreshes
PROCESSING call history. An ambiguous paid-call response is never submitted again:
the UI retains the original `call_id`, polls the owner-scoped recovery endpoint,
surfaces settlement proof when available, and waits for the worker/live path to reach
one terminal state. The public status badge requires both shallow health and deep
readiness; a failed worker/dependency check is labeled degraded instead of live.
Top-up and claim forms mirror the bounded testnet limits before wallet submission and
link confirmed transactions to the explorer.

The low-cost US-only backend staging path is now deployed: Robinhood testnet chain
46630; GCP us-east4; Neon aws-us-east-1; Upstash GCP us-east4; bounded Cloud Run
services/jobs; immutable image digests; multi-tenant Cloud HSM signing; and a USD 35
monthly envelope. Nine database migrations/30 tables, TLS Redis, primary/fallback
RPC, twelve scoped secrets, and private Telegram delivery are active. Three disjoint
canonical Safe 1.4.1 2-of-3 authorities, a synthetic 6-decimal token, and
VelostraEscrow are deployed and live-verified. The private signer, public API,
isolated web, stateless synthetic-agent service, reconciliation/webhook/monitor jobs,
migrations, and Scheduler triggers are live. Origin binding, deep readiness, solvency,
worker heartbeats, and anonymous signer rejection pass; bounded public synthetic paid
writes are enabled. Operational-state reads are serialized against the small API
pool, eliminating a post-worker readiness flap caused by observability query fan-out.

## Audit decision

- **Internal engineering audit:** PASS for Phase 0-4 repository preparation.
- **Automated security, financial, release, canary, browser, contract, container,
  migration, and CI gates:** PASS locally.
- **Database:** nine reviewed migrations and 30 application tables.
- **Independent third-party audit:** not claimed or fabricated.
- **Deployment state:** the canonical public frontend is connected to the managed US
  testnet runtime with bounded synthetic paid writes enabled; no mainnet contract,
  mainnet transaction, or real-value activation.
- **Expansion state:** impossible from repository automation alone; a passing canary
  still returns `PASS_AWAITING_OPERATOR` and `expansionAuthorized: false`.

| Area | Repository state | External state |
|---|---|---|
| Product frontend | lint/build plus browser, visual, a11y, routing, wallet/session binding, deep-readiness status, no-resubmit call recovery, transaction proof, performance budgets, tracked Netlify config | public `/testnet` live with managed API/contract values, wallet onboarding, and bounded synthetic paid calls |
| Contract | role-separated, solvent, pausable, correlated `callId`, canonical Safe 2-of-3 authority policy, guarded build/deploy/verify tooling | three Safes plus synthetic token/escrow deployed and verified on testnet; independent audit/mainnet pending |
| Financial recovery | exactly-once reservation/outbox/reconciliation, ambiguity, race, reorg and drift controls | direct skipped-report and bounded wallet/claim reconciliation evidence passed; timed outage result is recorded in the managed evidence packet |
| Database | nine migrations, 30 tables, canary/platform constraints and indexes, exact restore inventory | provider-native Neon PITR matched every table, migration, aggregate, constraint, and index |
| Release integrity | immutable Phase 3 manifest plus a plan-only readiness packet binding commit, contract bytecode, lockfiles, audit, authority/custody, operations, deployment/rollback, and canary policy | readiness packet is structurally valid but deterministically `NO_GO`; audit, production custody/drills, and assigned two-person approval roles remain pending |
| Canary | disabled-by-default startup, allowlists, window and exposure caps, serialized DB admission, automatic summary and stop plan | low-value mainnet canary not executed |
| Staging topology | portable Compose plus plan-tested US-only GCP us-east4 Cloud Run services/jobs, scheduler, immutable images, bounded cost policy, and Safe authority wrappers | verified testnet authorities/escrow plus immutable signer/API/web/jobs/schedules live; readiness 8/8 and bounded public mode enabled |
| Signer/secrets | raw production key rejected; restricted remote signer plus HSM-backed secp256k1 implementation, scoped identities, and hidden-prompt Secret Manager helper tested | private signer runtime, all twelve scoped values, and the operational gas floor are healthy; mainnet custody drills remain pending |
| Observability | metrics, deep readiness, reconciliation/webhook heartbeats, durable alerts, delivery-age health, evidence collectors | readiness, heartbeats, and a real private backup-stale create/deliver/ack/heal/resolve lifecycle pass; remaining injected-alert coverage pending |
| Resilience | multi-RPC failover, bounded/adaptive catch-up, cursor checkpoint, reorg/restore tooling | primary-RPC fallback, timed reconciliation outage, and provider-native PITR pass; destructive API/DB/Redis/restart faults and formal SLO calibration pending |
| CI | dedicated current-tree and full-history privacy, immutable-release, runtime-canary, Postgres race, contract, browser, server, and money-loop gates; the closeout candidate runs 30 deterministic browser passes plus one guarded external-wallet skip | [Product baseline](https://github.com/velostralabs/velostra/actions/runs/29920252583) and [artifact baseline](https://github.com/velostralabs/velostra/actions/runs/29920252566) passed; the newer [artifact run](https://github.com/velostralabs/velostra/actions/runs/29923417382) passed while [Product run](https://github.com/velostralabs/velostra/actions/runs/29923417408) exposes the fast-click false-negative fixed and locally verified by this candidate |

## Managed skipped-report reconciliation evidence

The managed US staging repair proof passed on 2026-07-19 with paid writes disabled.
The guarded runner created an encrypted, test-only evidence wallet, minted synthetic
testnet USD, and sent a direct escrow `Deposit` without calling
`/api/dashboard/topup`. After the precondition confirmed that Postgres had no matching
transaction or balance row, the reconciliation job decoded the confirmed event,
backfilled the missing record, and advanced the confirmation-safe cursor. Unique
transaction constraints and the worker's conditional ownership make a repeat a
no-op. The wrapper always resumes the Scheduler trigger, including on failure.

Run the same evidence check only against the managed US testnet with:

    powershell -NoProfile -File deploy/gcp/run-reconciliation-evidence.ps1 -Apply

The run writes only ignored evidence under `artifacts/staging`; it does not enable
paid writes, touch the public Netlify preview, or publish wallet addresses, hashes,
provider identifiers, or credentials. The bounded wallet/claim, alert lifecycle,
RPC fallback, timed-outage, PITR, and control-readiness results are summarized in
[MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md); independent review and approved custody
mutations remain separate gates.

## Managed synthetic agent staging

The isolated US testnet now contains one approved phase2-synthetic-agent priced at
USDG 1.20. Its dedicated Cloud Run service uses the unprivileged web identity, scales
from zero to at most one instance, receives no managed secret, has no database/Redis
access, never echoes input, and hard-fails outside staging chain 46630. The
idempotent seed job is release/image/runtime-bound, health-checks the service before
database mutation, encrypts the agent HMAC secret, and exhausts only the dedicated
test wallet's monthly free-tier counter so the next test call cannot pass as free.

Provisioning and a second idempotence run both passed on 2026-07-19: the marketplace
returned exactly one approved synthetic agent at the expected price and omitted the
encrypted secret. API paid writes remained disabled; no paid call, claim, mainnet,
production, or real-value transaction was authorized by this step.

The guarded operator command is:

    powershell -NoProfile -File deploy/gcp/provision-synthetic-agent.ps1 -Release <deployed-release> -ServerImage <immutable-server-digest> -SyntheticAgentUrl https://<synthetic-service>/execute -BuilderWallet <dedicated-test-wallet> -Apply

### Managed-live public demo catalog

The 2026-07-22 managed release extends the same secretless service with four
deterministic public-testnet profiles: Flowbook Trader, Wallet Sentinel, TokenScope,
and Contract Lens. Each profile has an isolated route, fixed scenario, explicit
synthetic-data boundary, correlated call proof, and a matching marketplace playbook.
Selecting a playbook prefills its prompt but never executes or charges automatically.

Provisioning remains release/image/runtime-bound and idempotent. The seed preserves
the original phase2-synthetic-agent used by release evidence, then creates or strictly
verifies the four public profiles and their immutable revisions. A cross-layer gate
fails if slug, price, scenario ID, endpoint, non-retention declaration, or safety copy
drifts.

The micro-commits were published, remote product and staging-artifact workflows passed,
the digest-bound runtime deployed in US `us-east4`, and the catalog seed completed.
Live browser discovery exposed all five retained profiles and all four scenario URLs.
Direct HTTP privacy/receipt checks passed for every profile. A dedicated MetaMask
Wallet Sentinel paid call then passed with one exact user debit and one builder credit;
no top-up, claim, mode transition, mainnet action, or real value was part of that smoke.

## Public frontend deployment evidence

- Canonical origin: [https://velostra.xyz/](https://velostra.xyz/).
- Alias: `www.velostra.xyz` redirects to the canonical apex.
- Provider identity: Netlify site `velostra`, team `Velostra`, team slug
  `velostralabs`; provider default `velostra.netlify.app`.
- Source: GitHub `velostralabs/velostra`, production branch `main`.
- Build contract: tracked `netlify.toml`, Node.js 22, `npm run build`, publish
  directory `dist`.
- Runtime verification on 2026-07-18: HTTPS validation passed, apex returned 200,
  hashed JS/CSS assets returned 200 with correct MIME types, `www` resolved to the
  apex, and a browser DOM/screenshot smoke rendered the complete landing surface.
- Security boundary: no Netlify Function is used and no secret or managed backend
  credential is present in the client build. Netlify account metadata reports the
  US `us-east-2` functions region, while static CDN delivery is global.

This evidence proves only static frontend delivery. It is not managed-staging
readiness, wallet/contract evidence, closed-beta activation, or mainnet authority.

## Phase 2 implementation delivered

### Staging, secrets, and authority

- Executable US-only policy fixes GCP to us-east4, Neon to aws-us-east-1,
  Upstash to GCP us-east4, Robinhood testnet to chain 46630, and the total monthly
  envelope to USD 35.
- Plan-only bootstrap, KMS public-key/address derivation, immutable Cloud Build,
  bounded Cloud Run web/API/private-signer services, scheduled reconciliation/
  webhook/monitor jobs, and migration opt-in are committed and plan-tested.
- The private signer runs its dedicated entrypoint, permits only API/job invokers,
  uses managed secp256k1 Cloud KMS signing, and never receives a raw wallet key.
- Portable Compose topology with separate API, reconciliation worker, operational
  monitor, migration job, and web ingress; images run as non-root.
- Role-specific environment scopes, network boundaries, health checks, resource
  caps, immutable image inputs, and an isolated-staging deployment runbook.
- Production startup requires managed secret injection, TLS Postgres/Redis/RPC,
  a full 40-character frozen commit SHA, explicit approval for production or any
  mainnet-like environment, a restricted remote signer, and no raw private key.
- Signer calls use the correlated `bytes32 callId` as an idempotency key, preserve
  one logical nonce writer, verify signer identity, and reject responses above the
  configured 16 KiB boundary.
- Authority ownership/policy validation and secret/signer/role rotation runbooks are
  committed and tested.
- Three disjoint Safe 1.4.1 2-of-3 authority sets now have CSPRNG-generated,
  DPAPI-encrypted testnet-only custody. Tooling proves encryption round trips, owner
  separation, plan-only defaults, clean-tree broadcast, canonical factory readiness,
  and post-deployment owner/threshold verification. This synthetic single-operator
  custody is explicitly ineligible for production or mainnet governance.

### Observability and browser proof

- Structured request/worker logs; dependency latency/availability, DB/Redis/RPC,
  signer balance, cursor/safe-head lag, outbox state/age, pending events, drift,
  solvency, and backup/worker heartbeat metrics.
- Durable alert lifecycle with fingerprint dedupe, repeat window, acknowledgement,
  resolution, clean ownership reset on reopen, webhook metadata, severity, and
  runbook links.
- Chromium gates cover eight critical-route accessibility scans, keyboard-contained
  wallet focus, desktop collision/overflow assertions, approved visual baselines,
  canonical URL/history behavior, injected-wallet money/recovery flow, and three
  route performance budgets. Result: **17 passed, 1 intentionally skipped**; the skip
  is the guarded real-MetaMask staging harness.
- Build reference: initial entry 160,706 gzip bytes, largest async chunk 235,837,
  total JavaScript 682,985; all are within committed budgets.
- The six Moderate MetaMask-tree findings are one `uuid` advisory. Reviewed installed
  call sites use `uuid.v4()` without caller buffers; the time-bounded disposition and
  invalidation conditions are in `METAMASK_DEPENDENCY_DISPOSITION.md`.

### Load, failure, reorg, and restore proof

- Primary RPC 429 deterministically fails over to the configured secondary endpoint;
  unsafe fallback URLs fail production startup.
- Twelve concurrent paid calls produced ten unique successful settlements and two
  intentional Redis per-agent limits in 2,406 ms. Exact user debit, builder credit,
  call rows, and transaction hashes were verified.
- A simulated worker gap spanning 27 blocks plus twelve unreported deposits caught up
  in 2,451 ms using deterministic one-block local-EVM ranges; replay changed no money.
- The reorg drill excluded an unconfirmed fork event, reverted the fork, waited two
  confirmations, ingested only the canonical replacement, advanced the cursor, and
  ended at zero drift.
- The final local money loop had 16 successful paid calls, no PROCESSING residue,
  no reservation residue, 34 reconciled chain events, and 32 financial transactions.
- PostgreSQL custom dump/clean restore baseline plus the Phase 4 verifier covers all 30 tables, nine migrations, every
  row count, financial aggregate, outbox state, constraint, and index. The measured
  disposable restore path completed in 1,542 ms with zero synthetic RPO.
- Final second-pass review also bounded staging load requests, rebuilt both non-root
  release images, reran the browser suite (17 passed, one guarded real-MetaMask
  scenario skipped), and repeated the full money loop on fresh disposable databases
  without financial drift.

These local numbers are correctness references, not managed-staging SLO claims.
Candidate objectives live in `config/phase2-slos.json` and remain unfrozen until the
real one-hour outage and managed PITR drills pass.

## Phase 3 repository implementation delivered

- `release:prepare` creates a canonical preparation manifest and fails on dirty,
  cross-release, unreviewed, or malformed inputs.
- `release:plan` emits an ordered backup/migrate/deploy/verify/start/readiness/canary
  plan and never broadcasts by default.
- Contract deployment requires `--broadcast` plus an explicit mainnet sentinel,
  matching manifest hash, ticket, release, chain, token, deployer, roles, and artifact.
- `release:finalize` records the exact transaction/address/block; verification binds
  the approved deployer, chain, zero-value contract-creation transaction, exact init
  code, runtime bytecode, receipt, roles, token, fee, pause, solvency, and successor
  state.
- `phase3:snapshot` collects independent RPC, safe-head/cursor, contract, role,
  database, image, signer, worker, backup, outbox, drift, and alert evidence.
- `release:readiness` emits deterministic `GO` or `NO_GO` without enabling writes.
- `release_canary_admissions` binds each canary call to release/manifest/policy and
  records `ADMITTED`, `SETTLED`, or `FAILED`.
- Concurrent admission is serialized in the transaction that creates the call,
  reserves credit, and creates the outbox. Capacity is cumulative per release/policy,
  so reissuing a manifest cannot reset the cap; later failure rolls admission back.
- `phase3:canary-summary` derives evidence from Postgres, chain events, worker
  heartbeat, and final readiness.
- `release:canary` emits a non-destructive `STOP` plan or
  `PASS_AWAITING_OPERATOR` with public expansion still unauthorized.
- Public mode additionally requires hash-bound passing evidence and separate
  explicit operator approval.

## Phase 4 repository implementation delivered

- /api/v1 returns version headers and stable object/collection envelopes; compatible
  legacy routes advertise Deprecation, Sunset, and successor Link metadata.
- Opaque HMAC cursors bind resource/filter scope and stable created_at/id boundaries.
- Durable idempotency stores actor, operation, normalized fingerprint, status, and
  replay response. Conflicting reuse is rejected; uncertain expired processing state
  returns IDEMPOTENCY_INDETERMINATE instead of risking duplicate mutation.
- JavaScript and Python SDKs share exact gateway/webhook HMAC fixtures and expose
  pagination, errors, idempotent calls, reports, and signature verification.
- Published agent revisions are immutable. Publish/rollback atomically changes the
  active revision, resets approval to PENDING, and records the revision on each call.
- Builder operations include production-policy endpoint probes, cursor call history,
  exact analytics, notifications, and signed webhook subscription/rotation controls.
- Webhook delivery is separately supervised with durable attempts, claim locks,
  bounded backoff, dead-letter, audited replay, heartbeat/readiness, metrics, and alerts.
- User reports, conditional moderation transitions, privacy export/delete processing,
  retained financial evidence, anonymization, and classified telemetry are enforced
  with RBAC and audit history.
- Migration 0008 expands the schema to 30 application tables. Restore/migration checks
  and Phase 4 PostgreSQL E2E cover idempotency/revision/webhook/moderation/privacy
  races, cursor tamper, and zero aggregate/delivery drift.
- CI now defines seven jobs, including a dedicated Phase 4 API/SDK contract job and
  Phase 4 PostgreSQL E2E in the money-loop job. After publication on 2026-07-17,
  both Product verification and Staging artifact verification completed successfully
  on GitHub Actions. The remote audit exposed and closed two CI-only gaps: the staging
  topology now materializes `webhook.env`, and synthetic INP waits for network/font/
  paint settling while preserving the 200 ms product target.

## Pre-Phase 4 repository closeout

The final 2026-07-16 local re-audit found and fixed one rapid-interaction routing
race: marketplace search/category/sort changes could overwrite sibling URL params.
The query-state writer now serializes changes through one current parameter snapshot,
and a regression test proves fast consecutive changes retain all filters and reset
cleanly.

Closeout evidence:

- lint, TypeScript/Vite build, Phase 2 evidence, MetaMask reachability, Phase 3
  release/readiness/canary, server security/resilience, and all 10 contract groups pass;
- the browser matrix now runs 18 scenarios: 17 pass and only the explicitly guarded
  real-MetaMask staging journey is skipped;
- fresh/upgrade migrations, durable observability, concurrent canary admission, and
  the full local-EVM money loop pass on a disposable database;
- reconciliation again proves missed-event backfill, correlated paid-call repair,
  live/worker exact-once races, ambiguous/unknown broadcast recovery, dense catch-up,
  confirmation-window reorg handling, and zero final drift;
- production dependency audits have no High/Critical finding; the six Moderate web
  entries remain the reviewed, time-bounded MetaMask/UUID advisory;
- tracked Markdown links resolve, tracked paths have no case collisions, secret-pattern
  scanning finds no credential material, and the Git author/remote remain Velostra;
- the public-privacy CI gate rejects personal mailbox addresses, local user-profile
  paths, private-key blocks, and non-Velostra HEAD attribution without echoing matched
  values; public web metadata is explicitly US-locale;
- Three.js remains isolated in a lazy chunk. Vite's raw warning threshold now matches
  that intentional split, while the stricter committed gzip budgets still fail builds
  on meaningful entry, async, or total JavaScript regressions.

This closes the actionable repository cleanup before Phase 4. External audit,
managed-staging, operator, deployment, and canary evidence remain truthful release
prerequisites rather than unfinished local code.

## Mainnet release prerequisites

These items do not reopen the completed Phase 0-4 repository scope and do not block
continued non-mainnet development. They block only real-value/mainnet authorization.

1. Managed topology/configuration and provider-native PITR integrity evidence: PASS.
2. Execute managed secret, signer, settler, pause, and compromise-response drills.
3. Backup-stale delivery/ack/resolution: PASS; repeat coverage for remaining required alerts.
4. Bounded real-MetaMask synthetic path plus exact reconciled claim: PASS; freeze
   managed web vitals and sign the evidence packet.
5. Timed reconciliation-schedule outage and RPC fallback: PASS; destructive API/DB/
   Redis/restart-mid-settlement faults remain separate.
6. Provider-native PITR integrity: PASS; formal restore-SLO calibration remains.
7. Minimum 72-hour soak: `PASS_BY_OWNER_WAIVER`; execution `NOT_RUN`; no duration
   telemetry is claimed. Mainnet remains governed by its separate release gates.
8. Hash every artifact, obtain operator approval, and pass `npm run phase2:evidence`.
9. Complete independent contract and focused backend review before mainnet release.

The new `npm run mainnet:prepare` command generates an ignored, SHA-256-bound
preparation packet and `npm run mainnet:validate` verifies it. The tracked example
currently returns `NO_GO` with four explicit blockers: independent audit,
production authority/custody, production recovery/alert/runbook gates, and assigned
two-person approval roles. `npm run mainnet:gate` intentionally fails until those
inputs are complete. Even a passing gate is only `READY_FOR_SIGNING`; the packet
cannot authorize broadcast, canary execution, expansion, or real value. See
[MAINNET_READINESS.md](./MAINNET_READINESS.md).

The preparation packet also hash-binds an explicit `us-east4` environment-isolation
contract. Mainnet must use separate runtime, data, Redis, signer, scheduler, secrets,
service identities, and evidence storage; testnet remains public and only read-only
health checks are permitted against it during preparation.

## One-hour outage answer

The worker is designed to catch up safely from a long outage: it persists a cursor,
scans only through the confirmation-safe head, plans contiguous bounded ranges,
retries with exponential backoff, adaptively splits oversized/timeout ranges, and
now fails over across configured HTTPS RPC endpoints. A failed range never advances
the cursor, and event/outbox uniqueness makes replay idempotent.

If every RPC is throttled or unavailable, recovery pauses safely rather than skipping
blocks. Once an endpoint recovers, the worker resumes from the same cursor. The local
27-block drill proves dense local correctness. Managed staging now also proves a
3,610,626 ms reconciliation-schedule outage recovered to safe head in 7,225 ms with
zero duplicate money, pending events/outbox, skipped range, or drift; Scheduler is
ENABLED. A destructive API/Postgres/Redis outage remains a separate test.

## Next action

The public testnet checkpoint is complete and remains available to users at
`https://velostra.xyz/testnet`. The optional four-agent demo catalog is managed-live,
its immutable runtime and idempotent seed are release-bound, and browser, direct HTTP,
privacy, receipt, and real-wallet paid-call smoke passed. Ongoing health checks and
repeat paid-call-only smoke are operational maintenance, not unfinished scope.
Keep Phase 0-4 regression, privacy, financial, worker, and readiness gates green
while preserving bounded testnet limits.

The only release lane now is mainnet migration preparation. The deterministic
packet machinery is complete and its truthful current decision is `NO_GO`. Close
the four recorded external blockers, regenerate from a clean reviewed commit until
`mainnet:gate` yields `READY_FOR_SIGNING`, then create the separate two-person
`broadcast-approved` manifest. Deployment remains write-closed and any low-value
allowlisted canary requires its own approval. No mainnet value may be used before
those gates close.
