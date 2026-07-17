# Velostra status

> Last verified against the workspace and public frontend: 2026-07-18.
> Repository decision: Phase 0-4 repository preparation is complete and internally
> verified. Controlled mainnet execution remains explicitly gated.
> No mainnet deployment or real-value authorization is recorded.
> Public deployment: the static protocol preview is live at https://velostra.xyz/;
> no managed API, database, Redis, signer, worker, or escrow deployment is claimed.

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
authorization is recorded. Independent review, managed-staging evidence, a real
one-hour outage/PITR/72-hour soak, real operator alert delivery, deployment
verification, low-value canary, and accountable closed-beta approval remain external
gates.

The static protocol preview is publicly deployed through the Velostra Netlify team
and Git-linked `velostralabs/velostra` `main` branch. The canonical TLS origin is
`https://velostra.xyz/`; `https://www.velostra.xyz/` redirects to it, and
`https://velostra.netlify.app/` remains the provider default. The tracked deployment
contract runs `npm run build` under Node.js 22 and publishes only `dist/`.

This frontend is deliberately a protocol preview. Its production environment has no
`VITE_API_URL`, `VITE_ESCROW_ADDRESS`, or `VITE_SETTLEMENT_TOKEN`, so API-backed
and financial flows are not activated and must not be represented as operational.

A low-cost US-only backend staging deployment path is committed and locally validated:
Robinhood testnet chain 46630; GCP us-east4; Neon aws-us-east-1; Upstash GCP
us-east4; bounded Cloud Run services/jobs; immutable image digests; managed software
KMS signing; and a USD 35 monthly envelope. No managed backend/staging provider
resource has been created yet. Google Cloud Billing and the user-owned Neon, Upstash,
Alchemy, and alert receiver accounts remain the current external provisioning gate.

## Audit decision

- **Internal engineering audit:** PASS for Phase 0-4 repository preparation.
- **Automated security, financial, release, canary, browser, contract, container,
  migration, and CI gates:** PASS locally.
- **Database:** nine reviewed migrations and 30 application tables.
- **Independent third-party audit:** not claimed or fabricated.
- **Deployment state:** public static frontend live; no managed backend, testnet
  contract, mainnet contract, mainnet transaction, or real-value activation.
- **Expansion state:** impossible from repository automation alone; a passing canary
  still returns `PASS_AWAITING_OPERATOR` and `expansionAuthorized: false`.

| Area | Repository state | External state |
|---|---|---|
| Product frontend | lint/build plus browser, visual, a11y, routing, wallet, performance budgets, tracked Netlify config | static preview live at `velostra.xyz`; API/contract build values, real MetaMask, and managed-staging performance evidence pending |
| Contract | role-separated, solvent, pausable, correlated `callId`, guarded build/deploy/verify tooling | independent audit and mainnet deployment pending |
| Financial recovery | exactly-once reservation/outbox/reconciliation, ambiguity, race, reorg and drift controls | timed managed one-hour outage evidence pending |
| Database | nine migrations, 30 tables, canary/platform constraints and indexes, exact restore inventory | provider-native managed PITR/RPO/RTO evidence pending |
| Release integrity | immutable manifest, clean-tree and commit binding, policy/evidence/image hashes, two-person authorization | real signed evidence and operator approvals pending |
| Canary | disabled-by-default startup, allowlists, window and exposure caps, serialized DB admission, automatic summary and stop plan | low-value mainnet canary not executed |
| Staging topology | portable Compose plus plan-tested US-only GCP us-east4 Cloud Run services/jobs, scheduler, immutable images, and bounded cost policy | Google billing/provider accounts and managed resources not provisioned yet |
| Signer/secrets | raw production key rejected; restricted remote signer plus managed secp256k1 KMS implementation, scoped identities, and hidden-prompt Secret Manager helper tested | KMS resource, secret versions, audit logs, rotations, and drills pending |
| Observability | metrics, deep readiness, reconciliation/webhook heartbeats, durable alerts, delivery-age health, evidence collectors | real delivery/acknowledgement pending |
| Resilience | multi-RPC failover, bounded/adaptive catch-up, cursor checkpoint, reorg/restore tooling | managed fault injection pending |
| CI | dedicated immutable-release, runtime-canary, Postgres race, contract, browser, server, and money-loop gates | [Product verification run 29455761339](https://github.com/velostralabs/velostra/actions/runs/29455761339) and [staging artifact run 29455761330](https://github.com/velostralabs/velostra/actions/runs/29455761330) passed on `47747e4` |

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

1. Provision the isolated managed topology and attach configuration/backup evidence.
2. Execute managed secret, signer, settler, pause, and compromise-response drills.
3. Deliver every required injected alert to a real operator and record acknowledgement.
4. Run the guarded real-MetaMask journey and capture frozen-staging web vitals.
5. Hold API/worker down for one real hour; inject DB, Redis, RPC, restart, and broadcast
   failures; meet the candidate catch-up/error/outbox SLOs with zero drift.
6. Restore provider-native managed PITR and meet RPO/RTO.
7. Run the frozen candidate for at least 72 hours with synthetic traffic, one verified
   worker restart, three daily reconciliations, zero unexplained drift, zero stale
   recoverable row, zero unresolved High/Critical finding, and zero unowned alert.
8. Hash every artifact, obtain operator approval, and pass `npm run phase2:evidence`.
9. Complete independent contract and focused backend review before mainnet release.

## One-hour outage answer

The worker is designed to catch up safely from a long outage: it persists a cursor,
scans only through the confirmation-safe head, plans contiguous bounded ranges,
retries with exponential backoff, adaptively splits oversized/timeout ranges, and
now fails over across configured HTTPS RPC endpoints. A failed range never advances
the cursor, and event/outbox uniqueness makes replay idempotent.

If every RPC is throttled or unavailable, recovery pauses safely rather than skipping
blocks. Once an endpoint recovers, the worker resumes from the same cursor. The local
27-block drill proves the invariant, but it does **not** prove the real one-hour SLO;
provider limits, block density, and managed DB throughput must be measured by the
pending staging outage artifact.

## Next action

Keep the public preview stable, then activate only the user-owned US backend provider
accounts, beginning with Google Cloud Billing. Apply the plan-tested bootstrap and
load secrets through the hidden prompt helper. Deploy and verify the Robinhood
testnet contract, API, workers, signer, and canonical API/auth origin before running
wallet, alert, one-hour outage, PITR, and 72-hour evidence.
No external gate may be marked complete from the local plan. Keep paid writes
disabled and do not use mainnet value.
