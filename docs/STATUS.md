# Velostra status

> Last verified against the workspace: 2026-07-16.
> Repository decision: Phase 0-3 repository preparation is complete and internally
> verified. Controlled mainnet execution remains explicitly gated.
> No mainnet deployment or real-value authorization is recorded.

## Executive status

Velostra now includes the complete repository-side Phase 3 release control plane on
top of the cleared Phase 1-2 product and resilience foundation. A canonical
SHA-256 release manifest binds the full commit, contract artifact/ABI/bytecode,
migration journal, every migration, the exact required lockfile/release-tool sets,
validated authority/canary policy, image digests, evidence, approvals, chain 4663,
constructor roles, reconciliation limits, and deployment record.

The deployment path is inert by default, requires two distinct approvals plus an
accountable change ticket, and produces independently verifiable deployment
evidence. Mainnet-like processes refuse startup without the exact deployed manifest.
Paid writes start disabled; canary mode permits only manifest-bound wallet/agent/
builder subjects and uses a transaction-scoped Postgres advisory lock plus a durable
admission ledger to enforce duration, call, per-call, per-wallet, and total exposure
caps under concurrency. Claims and reconciliation stay available during a stop.

Repository implementation and local verification are **CLEAR / PASS**. Phase 4 is
the next non-mainnet repository focus. This is not mainnet authorization. Independent
review, managed-staging evidence, an actual
one-hour outage/PITR/72-hour soak, real operator alert delivery, mainnet deployment
verification, and a low-value canary still require external infrastructure and human
approval.

## Audit decision

- **Internal engineering audit:** PASS for Phase 0-3 repository preparation.
- **Automated security, financial, release, canary, browser, contract, container,
  migration, and CI gates:** PASS locally.
- **Database:** eight reviewed migrations and 20 application tables.
- **Independent third-party audit:** not claimed or fabricated.
- **Deployment state:** no mainnet contract, transaction, or mainnet value.
- **Expansion state:** impossible from repository automation alone; a passing canary
  still returns `PASS_AWAITING_OPERATOR` and `expansionAuthorized: false`.

| Area | Repository state | External state |
|---|---|---|
| Product frontend | lint/build plus browser, visual, a11y, routing, wallet, and performance budgets | real MetaMask and managed-staging performance evidence pending |
| Contract | role-separated, solvent, pausable, correlated `callId`, guarded build/deploy/verify tooling | independent audit and mainnet deployment pending |
| Financial recovery | exactly-once reservation/outbox/reconciliation, ambiguity, race, reorg and drift controls | timed managed one-hour outage evidence pending |
| Database | eight migrations, 20 tables, canary admission constraints/indexes, exact restore checks | provider-native managed PITR/RPO/RTO evidence pending |
| Release integrity | immutable manifest, clean-tree and commit binding, policy/evidence/image hashes, two-person authorization | real signed evidence and operator approvals pending |
| Canary | disabled-by-default startup, allowlists, window and exposure caps, serialized DB admission, automatic summary and stop plan | low-value mainnet canary not executed |
| Staging topology | non-root API/web/worker/monitor/migration topology with separate immutable-input and evidence mounts | managed services not provisioned here |
| Signer/secrets | raw production key rejected; remote signer/authority policy tested | managed KMS/secret rotations and drills pending |
| Observability | metrics, deep readiness, heartbeats, durable alerts, evidence collectors | real delivery/acknowledgement pending |
| Resilience | multi-RPC failover, bounded/adaptive catch-up, cursor checkpoint, reorg/restore tooling | managed fault injection pending |
| CI | dedicated immutable-release, runtime-canary, Postgres race, contract, browser, server, and money-loop gates | [Product verification run 29453341985](https://github.com/velostralabs/velostra/actions/runs/29453341985) and [staging artifact run 29453341987](https://github.com/velostralabs/velostra/actions/runs/29453341987) passed on `da63b45` |

## Phase 2 implementation delivered

### Staging, secrets, and authority

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
- Build reference: initial entry 160,671 gzip bytes, largest async chunk 235,837,
  total JavaScript 677,588; all are within committed budgets.
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
- PostgreSQL custom dump/clean restore matched all 20 tables, eight migrations, every
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
- Three.js remains isolated in a lazy chunk. Vite's raw warning threshold now matches
  that intentional split, while the stricter committed gzip budgets still fail builds
  on meaningful entry, async, or total JavaScript regressions.

This closes the actionable repository cleanup before Phase 4. External audit,
managed-staging, operator, deployment, and canary evidence remain truthful release
prerequisites rather than unfinished local code.

## Mainnet release prerequisites

These items do not reopen the completed Phase 0-3 repository scope and do not block
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

Begin Phase 4 repository work in the ordered roadmap, starting with versioned API,
identity, pagination, idempotency, migration, and SDK contracts. In parallel, close
the independent-review and managed evidence prerequisites before any mainnet or
closed-beta activation. Do not put real value or public users at risk until the Phase 3
canary is operationally stable and explicit exit approval is recorded.
