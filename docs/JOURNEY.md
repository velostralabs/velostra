# Velostra journey

> Reconstructed from Git history through `6e83a04` and verified deployment evidence:
> 2026-07-18.
> This is the chronological handoff. [STATUS.md](./STATUS.md) remains the authority
> for current truth; [ROADMAP.md](./ROADMAP.md) remains the authority for phase gates.

## Current checkpoint

| Surface | State now |
|---|---|
| Repository | Phase 0-4 implementation complete and internally cleared |
| Public frontend | Static protocol preview live at `https://velostra.xyz/` |
| Managed backend | Not provisioned |
| Escrow | Locally tested; not deployed to Robinhood testnet or mainnet |
| Financial activation | Disabled; no real-value authorization |
| Independent review | Not yet performed |
| Active external next | US-only managed staging and evidence |
| Active repository next | Freeze Phase 5 scope before implementation |

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

- public static protocol preview with reproducible Netlify build/publish contract;
- Phase 0-4 local and remote CI gates, including money-loop/reconciliation, browser,
  contract, platform, security, migration, restore, and staging-container checks;
- public privacy gate preventing personal paths, private identity, keys, secrets, and
  non-public attribution from entering tracked product files.

## What is not complete

These are real external/runtime gates, not hidden repository TODOs:

1. Cloud Run services/jobs and schedules are not provisioned; the managed Postgres,
   Redis, primary/fallback RPC, registry, HSM, identities, and all twelve secrets exist.
2. VelostraEscrow is not deployed or verified on Robinhood testnet or mainnet.
3. The public frontend has no production API, escrow, or settlement-token build values.
4. Managed secret/authority rotations, pause/unpause and compromise drills, KMS audit
   logs, and signed ownership evidence are pending.
5. Runtime alert failure/acknowledgement/resolution plus production error-tracking
   redaction evidence are pending; direct Telegram connection delivery is verified.
6. Real MetaMask staging, managed performance baselines, one-hour outage, provider
   fault injection, provider-native PITR, calibrated SLOs, and minimum 72-hour soak
   evidence are pending.
7. Independent smart-contract and focused backend security review are pending.
8. No broadcast-approved mainnet manifest, low-value canary, closed beta, public paid
   writes, or real-value authorization exists.
9. Phase 5 remains a planning lane; its scope is not frozen for implementation.

## Next ordered work

### Lane A - Managed US staging (active external next)

1. Define and fund an isolated Robinhood-testnet deployer plus four distinct contract
   role addresses. Use the retained HSM-derived public address exactly as the settler.
2. Deploy and verify VelostraEscrow on Robinhood testnet; record address, deployment
   block, roles, token, fee, and verification evidence under ignored artifacts.
3. Deploy immutable API, signer, reconciliation, webhook, monitor, migration, and
   staging-web workloads with paid writes disabled.
4. Bind the exact staging web/API/auth origins and prove readiness, wallet, and alert
   delivery/acknowledgement.
5. Execute managed secret/authority rotation, pause/unpause, compromise response,
   audit-log ownership, error-tracking, and redaction drills.
6. Run bounded load/fault tests, the real one-hour outage, provider-native PITR, and
   the minimum 72-hour soak; calibrate SLOs, then hash and sign the evidence packet.

### Lane B - Independent review and controlled release

1. Freeze the reviewed commit, contract build, deployment policy, and audit scope.
2. Complete independent contract and focused backend review; close every Critical/High
   and disposition every Medium with an accountable owner and expiry.
3. Re-run readiness with paid writes disabled and create the two-person
   `broadcast-approved` manifest only after every managed gate passes.
4. If mainnet is later authorized, execute the bounded low-value allowlisted canary,
   stop on any failed threshold, and require a separate operator decision to expand.
5. Activate closed beta only after the same managed environment proves webhook,
   privacy, retention, alert, and incident controls.

### Lane C - Repository/product planning

1. Keep every Phase 0-4 regression and compatibility gate green.
2. Freeze Phase 5 scope before implementation.
3. Prioritize distributed worker ownership, scalable signer isolation, provider
   backpressure/scoring, rollups/exports, and cost/performance observability.
4. Preserve backward-compatible `/api/v1`, revision, webhook, money, privacy, and
   canary contracts; any financial or contract-boundary change reopens audit scope.

## Next checkpoint definition

The next honest milestone is **managed US staging online with a verified Robinhood
testnet escrow while paid writes remain disabled**. It is complete only when:

- managed service identities and scoped secrets exist in the approved US regions;
- database, Redis, RPC, signer, API, and every worker pass deep readiness;
- the verified escrow address/deployment block match runtime configuration;
- the exact staging origin completes the real wallet and alert journey;
- generated evidence remains outside public Git and contains no personal data or raw
  credential.

That checkpoint does not authorize mainnet, public paid writes, or closed beta.

## Update discipline

Update this file whenever a milestone changes the chronological handoff, a deployment
becomes real, an external gate closes, or the ordered next action changes. Do not mark
provider evidence complete from a local plan, do not rewrite historical checkpoints,
and keep [STATUS.md](./STATUS.md) and [ROADMAP.md](./ROADMAP.md) synchronized.
