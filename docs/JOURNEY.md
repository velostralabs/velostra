# Velostra journey

> Reconstructed from Git history and verified deployment evidence through 2026-07-20.
> This is the chronological handoff. [STATUS.md](./STATUS.md) remains the authority
> for current truth; [ROADMAP.md](./ROADMAP.md) remains the authority for phase gates.

## Current checkpoint

| Surface | State now |
|---|---|
| Repository | Phase 0-4 implementation complete and internally cleared |
| Public frontend | Canonical testnet live at `https://velostra.xyz/testnet` and connected to managed staging |
| Managed backend | Signer/API/web/jobs/schedules live in US-only Robinhood Chain testnet staging |
| Escrow | Safe authorities, synthetic token, and escrow verified on chain 46630; no mainnet deployment |
| Financial activation | Bounded synthetic paid writes enabled; no real-value authorization |
| Operational health | Deep readiness 8/8; signer gas healthy; post-open worker sweep passed with zero drift |
| 72-hour disposition | `PASS_BY_OWNER_WAIVER`; execution `NOT_RUN`; no duration telemetry claimed |
| Independent review | Not yet performed; required before mainnet |
| Active next | Mainnet migration preparation only |

## Journey timeline

### 2026-07-14 - Recoverable product foundation

- established public-release and privacy guardrails;
- added correlated escrow settlement and the gateway ledger/reconciliation foundation;
- published the first premium React product surface and public narrative.

Outcome: Velostra became an end-to-end product repository rather than a visual-only
prototype. The contract, backend accounting model, repair worker, and frontend shared
one execution story.

### 2026-07-15 - Product identity and Phase 1 hardening

- stabilized semantic routing, interactive states, marketplace/economics layouts,
  adaptive WebGL loading, and browser performance;
- introduced the editable Crystal V identity and MetaMask/EIP-6963 wallet picker;
- separated settlement, governance, treasury, pause, and fee authority;
- hardened SSRF, wallet nonce consumption, secrets, RBAC, production configuration,
  database migrations, exact decimal arithmetic, and restore integrity;
- completed durable outbox/reconciliation recovery for known and unknown transaction
  outcomes, conditional live/worker races, event correlation, drift, and replay;
- froze Phase 1 invariants and recorded the verified implementation baseline.

Checkpoint: implementation baseline `ea1b61d`; historical handoff `515ada9`.

### 2026-07-15 to 2026-07-16 - Phase 2 staging and evidence machinery

- added a reproducible isolated API/web/worker/monitor/migration topology;
- isolated remote signer authority and added durable metrics, readiness, alerts, and
  operator lifecycle;
- added RPC failover/finality policy, bounded catch-up, reorg drills, load evidence,
  restore evidence, and a guarded minimum 72-hour soak runner;
- gated accessibility, layout collision, routing state, wallet behavior, visual
  baselines, and browser performance in CI;
- hardened immutable evidence manifests and closed the repository-side Phase 2 lane.

Checkpoint: internal Phase 2 close `5372cba`. Managed provider evidence remains
external and is not implied by the repository pass.

### 2026-07-16 - Phase 3 controlled-release safety

- added immutable release manifests and exact build/deployment identity;
- made deployment inert by default and guarded broadcast/finalization;
- added deep readiness, deterministic GO/NO-GO, bounded paid-call canary admission,
  serialized caps, safe-stop plans, and separate expansion approval;
- strengthened restore inventory, marketplace URL races, wallet performance, and CI.

Checkpoint: pre-Phase-4 repository close `47747e4`. Controlled execution remains
gated; no mainnet broadcast or value was authorized.

### 2026-07-16 to 2026-07-17 - Phase 4 platform completion

- froze `/api/v1`, opaque signed cursors, durable mutation idempotency, and stable
  error contracts;
- published typed JavaScript and Python SDK source;
- added immutable agent revisions, builder analytics, notifications, endpoint probes,
  signed durable webhooks, retries, dead-letter operations, and worker health;
- added moderation, privacy/export/delete workflows, telemetry governance, and
  console controls;
- proved concurrency, migration, restore, webhook, platform, browser, and financial
  regression behavior locally and in GitHub Actions.

Checkpoint: verified remote Phase 4 exit `2b1f8ab`. Closed-beta activation remains
dependent on the operational Phase 3 exit and managed evidence.

### 2026-07-17 - US-only staging execution plan

- selected Robinhood testnet chain 46630;
- codified GCP `us-east4`, Neon `aws-us-east-1`, and Upstash GCP `us-east4` policy;
- added a managed KMS settlement signer, guarded testnet contract deployment,
  immutable image builds, bounded Cloud Run services/jobs, and cost controls;
- kept every Apply action guarded and paid writes disabled.

Checkpoint: staging execution plan `1216c8e`. Google Cloud Billing and the required
provider activation and provisioning evidence remain the external blocker.

### 2026-07-18 - Public identity and static protocol preview

- added X/social launch assets while keeping private motion-production files local;
- canonicalized public Velostra identity and kept local Netlify linkage private;
- fixed Netlify to build with Node.js 22 and publish Vite `dist/` rather than source
  `index.html`;
- connected `velostra.xyz`, TLS, apex/www routing, and Git-linked `main` deployment;
- synchronized deployment truth across the documentation.

Checkpoint: `6e83a04`.
[Product verification run 29612763222](https://github.com/velostralabs/velostra/actions/runs/29612763222)
and [staging artifact run 29612763312](https://github.com/velostralabs/velostra/actions/runs/29612763312)
passed; the matching Netlify production deploy reached `ready`.

### 2026-07-18 - US GCP bootstrap applied

- activated the brand-only `velostra-production` project and billing guardrails;
- provisioned an empty us-east4 Artifact Registry, six namespaced least-privilege
  identities, and twelve empty regional Secret Manager containers;
- created one us-east4 multi-tenant HSM secp256k1 signer key;
- derived and retained the public signer evidence only under ignored artifacts.

Checkpoint: GCP bootstrap and its account-native budget alert are active. All twelve
secret containers still have zero versions. No Cloud Run service/job, Scheduler job,
provider data service, testnet contract, mainnet resource, or real-value flow exists.

### 2026-07-18 - Managed US data plane and scoped secrets

- provisioned Neon Postgres on AWS us-east-1, applied all nine migrations, verified
  30 public tables, and confirmed encrypted client connectivity;
- provisioned Upstash Redis on GCP us-east4 Free Tier with TLS, no paid read region,
  eviction disabled, and a successful authenticated health check;
- provisioned a Robinhood-testnet-only Alchemy primary RPC and verified both primary
  and public fallback endpoints report chain 46630;
- enabled ten scoped Secret Manager values: database, Redis, primary/fallback RPC,
  authentication, signing, encryption, and internal service-token material;
- caught an incompatible first internal-secret generation before any runtime use,
  destroyed those invalid versions, and retained only CSPRNG-generated versions;
- kept credentials, private endpoints, account identifiers, and evidence artifacts
  outside tracked product files.
- selected a private Telegram bot/channel for operator alerts and implemented direct
  delivery with strict credential validation, bounded messages, sensitive-field
  redaction, and credential-safe network errors.

Checkpoint: the managed US data plane is active and ten of twelve scoped secrets are
enabled. The private bot/channel exists, but its bot token/channel ID have not been
loaded or delivery-tested. The testnet contract and every Cloud Run application
workload remain pending; paid writes remain disabled.

### 2026-07-18 - Private Telegram alert transport activated

- created the two us-east4 Telegram Secret Manager containers with access limited to
  the jobs identity;
- accepted both values only through a hidden local prompt and retained neither value
  in terminal output, tracked files, or evidence;
- required a private channel with no public username and verified a direct connection
  message before storing the credentials;
- removed the two superseded empty generic-webhook containers after confirming they
  had no versions and no runtime references.

Checkpoint: all twelve scoped secret containers now have one enabled value and direct
private-Telegram delivery is verified. Runtime alert failure, acknowledgement, and
resolution evidence remains pending until the monitor workload is deployed.

### 2026-07-18 - Safe testnet authority preflight

- replaced arbitrary testnet role wallets with three canonical Safe 1.4.1 accounts:
  governance, treasury, and pause guardian, each 2-of-3;
- generated nine disjoint owner keys plus one isolated deployer using a CSPRNG and
  encrypted every key with Windows DPAPI CurrentUser below ignored artifacts;
- made both authority and escrow broadcasts plan-only, clean-tree guarded, chain-46630
  only, and dependent on live Safe owner/threshold/version verification;
- verified the canonical Safe factory, three unique predicted addresses, isolated HSM
  settler, and empty deployer balance through a read-only managed-RPC preflight.

Checkpoint: encrypted testnet-only custody and broadcast tooling are ready. Zero of
three Safes is deployed and the isolated deployer is intentionally unfunded, so no
authority, escrow, or token transaction has been sent. This synthetic custody is not
eligible for mainnet governance.

### 2026-07-19 - US testnet contract and managed runtime online

- funded only the isolated deployer with valueless testnet ETH, then deployed and
  live-verified the three canonical Safe 1.4.1 2-of-3 authorities;
- deployed a synthetic 6-decimal token and VelostraEscrow on chain 46630 and passed
  23 bytecode, receipt, role, token, solvency, event, and authority checks;
- built immutable server and web images, deployed the private signer, public API,
  isolated staging web, migration, reconciliation/webhook/monitor jobs, and staggered
  Scheduler triggers in us-east4;
- bound the generated web origin to the API, reran the idempotent migration, and
  verified Postgres, Redis, RPC, contract, solvency, and both worker heartbeats;
- proved the signer rejects anonymous access, every scheduled entrypoint completes,
  the isolated web is live, and paid writes remain disabled;
- caught and fixed a webhook interval validation mismatch plus stale health-chain
  metadata before the final immutable rebuild.

Checkpoint: the managed US testnet stack is online and deep-readiness green. The
public Netlify preview remains separate. Mainnet, real value, closed beta, public paid
writes, independent review, and the remaining managed evidence are not authorized.

### 2026-07-19 - Managed skipped-report reconciliation proof

- created a dedicated encrypted test-only wallet without exposing its address or key;
- minted synthetic testnet USD and sent a direct escrow deposit while deliberately
  skipping `/api/dashboard/topup`;
- confirmed the database had no matching transaction or balance before repair;
- paused the Scheduler only for the fault-injection window, ran reconciliation, and
  verified event-driven backfill, safe cursor advancement, and idempotent ownership;
- resumed the Scheduler in the cleanup path and kept paid writes disabled throughout.

Checkpoint: managed synthetic skipped-report repair is **PASS**. This proves the
confirmed-chain/failed-report safety net on the live US testnet stack, without claiming
the real MetaMask paid-call or claim journey. The reproducible command is
`powershell -NoProfile -File deploy/gcp/run-reconciliation-evidence.ps1 -Apply`;
outputs stay below ignored artifacts/staging.

### 2026-07-19 - Synthetic agent staging provisioned

- built and deployed an immutable, stateless velostra-synthetic-agent service in
  us-east4 with min zero/max one instance and the unprivileged web identity;
- verified the service has no secret injection, database, or Redis access, accepts
  only bounded staging traffic, never echoes input, and rejects non-46630 startup;
- ran a release/image/runtime-bound seed job that created one approved
  phase2-synthetic-agent at USDG 1.20 with an encrypted HMAC secret;
- exhausted only the dedicated test wallet's free-tier counter, then reran the seed
  idempotently and verified the marketplace still exposes exactly one agent without
  secret material;
- kept API paid writes disabled, so this checkpoint sent no paid-call or claim
  transaction and authorized no public/mainnet value.

Checkpoint: the synthetic target needed by the real MetaMask evidence lane is ready.
The next distinct operation is a bounded paid-canary window plus the real extension
profile; provisioning alone is not wallet money-loop evidence.

### 2026-07-19 - Staging web binding and wallet gate checkpoint

- rebuilt the managed web image with an explicit 46630 testnet chain contract;
- verified the served bundle contains the testnet chain, RPC, and explorer bindings;
- retained the public Netlify preview as a separate, chain-neutral product surface;
- ran a disposable MetaMask popup probe without importing a key, connecting a wallet,
  signing, or sending a transaction;
- kept the managed paid-write mode disabled and the canary binding absent after the
  popup probe did not yield a deterministic wallet UI.

Checkpoint: staging web binding is **PASS**; real MetaMask money-loop evidence is
still **PENDING**. The next execution must use a deterministic dedicated extension
popup/profile before any separately approved paid-canary window is considered.

### 2026-07-20 - Managed operational evidence closed

- retained the real private-Telegram backup-stale create/deliver/acknowledge/heal/
  resolve lifecycle without tracking the channel or operator identity;
- executed a bounded synthetic MetaMask money path; preserved the browser terminal
  timeout as failure evidence and retained a separate exact chain/database claim
  reconciliation PASS with paid writes disabled afterward;
- forced primary RPC failure, observed fallback, and restored normal reconciliation;
- paused reconciliation scheduling beyond one hour, caught up to the recorded safe
  head in 7,225 ms with zero duplicates, pending events/outbox, skipped ranges, or
  unexplained drift, and independently confirmed Scheduler returned ENABLED;
- created a provider-native Neon past-point branch, verified 30 tables, nine
  migrations, row counts, financial aggregates, constraints, and indexes, then
  deleted the disposable branch;
- refreshed read-only Safe/escrow/operator-control readiness with every check green;
  custody rotation, pause/unpause, and compromise mutations remain unexecuted and
  require separate multi-operator approval;
- recorded the duration execution as `NOT_RUN`; the final owner disposition later became `PASS_BY_OWNER_WAIVER` without duration telemetry.

Checkpoint: managed wallet/recovery, alert, RPC fallback, timed reconciliation outage,
PITR, and control-readiness evidence are retained. Mainnet, real value, public paid
writes, closed beta, independent audit, and custody mutation remain gated.

### 2026-07-20 - Public testnet checkpoint completed

- funded the restricted testnet signer to its bounded operational gas target;
- opened public synthetic paid writes only after immutable release, clean-tree,
  readiness, origin, and signer gates passed;
- verified the canonical `/testnet` onboarding surface, wallet entry point, official
  faucet guidance, synthetic mint path, route layout, and browser console;
- fixed and regression-tested the route title so `/testnet` identifies itself as the
  public Velostra testnet rather than a not-found page;
- ran reconciliation, webhook, and monitor jobs after opening; all completed, the
  confirmation-safe cursor stayed healthy, and onchain/database drift was zero;
- confirmed deep readiness returned 8/8 after the normal heartbeat refresh window;
- recorded the duration gate as `PASS_BY_OWNER_WAIVER`, execution `NOT_RUN`, without
  claiming 72-hour telemetry.

Checkpoint: public testnet **PASS** and available to users. Remaining release work is
mainnet migration only; no mainnet or real-value authority is implied.

## What is complete

### Product and identity

- premium desktop-first execution experience, clean semantic routes, query-state
  synchronization, accessible navigation, responsive fallback, and motion budgets;
- Crystal V logo system, favicons, public social assets, README presentation, and
  privacy-safe Velostra attribution;
- MetaMask, EIP-6963, and injected-provider selection/error/recovery states.

### Financial and recovery foundation

- correlated `bytes32 callId` settlement contract and event model;
- exact 6-decimal reservation, debit, builder split, claim, and platform accounting;
- durable outbox, ambiguous-broadcast recovery, four-event reconciliation, retroactive
  scanning, cursor safety, reorg policy, drift detection, and conditional exact-once
  live/worker completion;
- migration and PostgreSQL dump/restore coverage.

### Platform and integration layer

- versioned API, typed SDKs, immutable agent lifecycle, builder operations, reliable
  signed webhooks, moderation, privacy, and telemetry governance;
- deep readiness, metrics, alerts, worker supervision, release identity, deployment
  planning, canary caps, and safe-stop automation.

### Public and repository evidence

- public user-usable testnet with reproducible Netlify build/publish contract and bounded synthetic execution;
- Phase 0-4 local and remote CI gates, including money-loop/reconciliation, browser,
  contract, platform, security, migration, restore, and staging-container checks;
- public privacy gate preventing personal paths, private identity, keys, secrets, and
  non-public attribution from entering tracked product files.

## What is not complete

These are mainnet migration prerequisites, not unfinished public-testnet work:

1. Independent smart-contract and focused backend security review.
2. Frozen reviewed commit, image digests, deployment policy, constructor, and signed
   two-person release manifest.
3. Production-grade authority/custody ownership, secret rotation/compromise drills,
   backup/restore capacity, alert ownership, and operational SLO acceptance.
4. Mainnet deployment with paid writes disabled and deterministic readiness evidence.
5. A separately authorized low-value allowlisted mainnet canary and a distinct
   expansion decision.
6. Phase 5 remains deferred until mainnet scope and risk are frozen.

The 72-hour checkpoint was accepted as `PASS_BY_OWNER_WAIVER` with execution
`NOT_RUN`; this records the owner's decision and does not claim duration telemetry.

## Next ordered work

### Lane A - Keep the public testnet healthy

1. Retain bounded synthetic limits and chain-46630-only enforcement.
2. Keep reconciliation, webhook, monitor, readiness, privacy, wallet, browser, and
   financial regression gates green.
3. Close public mode fail-safe on unexplained drift, stale critical work, signer
   depletion, or readiness failure; claims and repair remain available during stop.
4. Keep all retained evidence redacted.

### Lane B - Mainnet migration

1. Freeze the reviewed commit, contract build, deployment policy, and audit scope.
2. Complete independent contract and focused backend review; close every
   Critical/High finding and explicitly disposition every Medium.
3. Establish accountable production authorities, signer custody, backup/restore,
   monitoring, incident ownership, and signed approvals.
4. Create the two-person `broadcast-approved` manifest and deploy once with paid
   writes disabled.
5. Execute only the separately approved low-value allowlisted canary, stop on any
   failed threshold, and require a distinct operator decision to expand.

## Next checkpoint definition

The public-testnet-complete checkpoint is **PASS**: the canonical user surface,
verified chain authorities and escrow, managed API and signer, bounded synthetic paid
writes, scheduled repair/delivery/monitoring, private alerting, and deep readiness are
live. The next checkpoint is mainnet migration readiness after independent review and
a signed production release packet.

That checkpoint does not authorize mainnet or real value.

## Update discipline

Update this file whenever a milestone changes the chronological handoff, a deployment
becomes real, an external gate closes, or the ordered next action changes. Do not mark
provider evidence complete from a local plan, do not rewrite historical checkpoints,
and keep [STATUS.md](./STATUS.md) and [ROADMAP.md](./ROADMAP.md) synchronized.
