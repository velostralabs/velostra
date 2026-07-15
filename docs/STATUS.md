# Velostra status

> Last verified against the workspace: 2026-07-15.
> Phase 2 repository implementation is complete; managed-staging exit evidence is pending.

## Executive status

Velostra now has the complete repository-side Phase 2 foundation: isolated staging
topology, managed-secret/remote-signer guardrails, operational metrics and durable
alerts, browser/wallet/accessibility/performance gates, multi-RPC recovery, load and
reorg drills, timed restore evidence, a guarded 72-hour soak runner, and a hashed
release-evidence validator. The expanded local money loop ends with zero financial
drift and exact source/restore parity.

Velostra is still **not mainnet-ready**. No mainnet contract deployment is recorded.
Phase 2 operational exit remains open until the committed topology is instantiated
and the real-MetaMask, operator-alert, one-hour outage, managed-PITR, frozen-staging
performance, 72-hour soak, and operator-signoff artifacts pass the evidence validator.
Phase 3 also remains blocked on independent contract and backend review.

| Area | Repository state | External state |
|---|---|---|
| Product frontend | lint/build plus 16 browser checks pass; visual, a11y, routing, wallet, and performance budgets are gated | real MetaMask and managed-staging performance evidence pending |
| Contract | role-separated, solvent, pausable, correlated `callId`, local-EVM suite | independent audit and mainnet deployment pending |
| Financial recovery | exactly-once reservations/outbox/reconciliation, known/unknown ambiguity, live/worker race, reorg confirmation policy | one-hour managed outage evidence pending |
| Database | seven migrations, 19 tables, constraints/indexes, timed exact restore evidence | provider-native managed PITR/RPO/RTO evidence pending |
| Staging topology | reproducible non-root API/web/worker/monitor/migration topology and least-privilege env scopes | managed services have not been provisioned in this repository |
| Signer/secrets | production rejects raw signer keys; restricted remote signer and authority policy are tested | managed KMS/secret rotations and operator drills pending |
| Observability | structured logs, metrics, deep readiness, heartbeats, alerts, dashboard/rules, dedupe/ack/resolve | real delivery/acknowledgement and error-tracker destination pending |
| Resilience | RPC 429 failover, gap-free planner, concurrent settlement, dense catch-up, reorg replacement, restore tooling | managed DB/Redis/RPC fault injection pending |
| Soak/release | guarded 72-hour runner and SHA-256-bound fail-closed evidence packet | elapsed soak and accountable sign-off pending |
| CI | new gates are committed locally; YAML parses and every new local suite passes | post-push GitHub run not yet available |

## Phase 2 implementation delivered

### Staging, secrets, and authority

- Portable Compose topology with separate API, reconciliation worker, operational
  monitor, migration job, and web ingress; images run as non-root.
- Role-specific environment scopes, network boundaries, health checks, resource
  caps, immutable image inputs, and an isolated-staging deployment runbook.
- Production startup requires managed secret injection, TLS Postgres/Redis/RPC,
  non-mainnet Phase 2 environment, a restricted remote signer, and no raw private key.
- Signer calls use the correlated `bytes32 callId` as an idempotency key and preserve
  one logical nonce writer.
- Authority ownership/policy validation and secret/signer/role rotation runbooks are
  committed and tested.

### Observability and browser proof

- Structured request/worker logs; dependency latency/availability, DB/Redis/RPC,
  signer balance, cursor/safe-head lag, outbox state/age, pending events, drift,
  solvency, and backup/worker heartbeat metrics.
- Durable alert lifecycle with fingerprint dedupe, repeat window, acknowledgement,
  resolution, webhook metadata, severity, and runbook links.
- Chromium gates cover eight critical-route accessibility scans, keyboard-contained
  wallet focus, desktop collision/overflow assertions, approved visual baselines,
  canonical URL/history behavior, injected-wallet money/recovery flow, and three
  route performance budgets. Result: **16 passed, 1 intentionally skipped**; the skip
  is the guarded real-MetaMask staging harness.
- Build reference: initial entry 160,661 gzip bytes, largest async chunk 235,837,
  total JavaScript 677,510; all are within committed budgets.
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
- PostgreSQL custom dump/clean restore matched all 19 tables, seven migrations, every
  row count, financial aggregate, outbox state, constraint, and index. The measured
  disposable restore path completed in 1,542 ms with zero synthetic RPO.

These local numbers are correctness references, not managed-staging SLO claims.
Candidate objectives live in `config/phase2-slos.json` and remain unfrozen until the
real one-hour outage and managed PITR drills pass.

## Release gates still open

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
9. Complete independent contract and focused backend review before Phase 3.

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

Do not add mainnet value. Instantiate the committed staging topology, execute the
external Phase 2 evidence flow in [ROADMAP.md](./ROADMAP.md), and engage independent
reviewers in parallel using [AUDIT_READINESS.md](./AUDIT_READINESS.md).
