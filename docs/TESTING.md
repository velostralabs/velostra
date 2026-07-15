# Testing and release evidence

> Last verified against test files and scripts: 2026-07-16.
> Phase state: Phase 0-3 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.

## Automated matrix

| Suite | Command | Dependency | Proves |
|---|---|---|---|
| Web lint | `npm run lint` | none | source/static checks |
| Web build | `npm run build` | none | TypeScript + Vite production bundle |
| Browser gate | `npm run test:browser` | Playwright Chromium | wallet journey, axe, keyboard, layout, visual, URL, and performance budgets |
| Evidence validator | `npm run test:phase2-evidence` | none | complete packet passes; tampering fails closed |
| Phase 3 release | `npm run test:phase3-release` | contract dependencies | exact manifest sets, policy/authority binding, deployment provenance, checkpoint/canary tamper gates |
| Phase 3 aggregate | `npm run test:phase3` | root/server/contract installs | release gates, server compile/config, canary guard, migration consistency |
| API build | `npm --prefix server run build` | none | strict server compile |
| Migration check | `npm --prefix server run db:check` | none | Drizzle migration consistency |
| Production config | `npm --prefix server run test:config` | none | unsafe production settings fail closed |
| Resilience policy | `npm --prefix server run test:resilience` | local HTTP | RPC 429 failover and confirmation/range policy |
| Observability | `npm --prefix server run test:observability` | none | alert rules, metrics, readiness policy |
| Observability DB | `npm --prefix server run test:observability-db` | disposable Postgres | heartbeat and alert lifecycle persistence |
| Auth | `npm --prefix server run test:auth` | none | bound challenge, Redis-style atomic multi-instance replay defense |
| SSRF | `npm --prefix server run test:ssrf` | local sockets/DNS doubles | blocked ranges, redirect/DNS/size/timeout boundary |
| HTTP security | `npm --prefix server run test:http-security` | none | origin, headers, request IDs, body/JSON/404 codes |
| Secret envelope | `npm --prefix server run test:secrets` | none | encrypt/decrypt/tamper/rotation/revoke behavior |
| Restricted signer | `npm --prefix server run test:signer` | local HTTP double | allowlist, idempotency, auth, timeout, and response validation |
| Authority policy | `npm --prefix server run test:authority` | none | owned multisig roles and exact single-approval restricted settler policy |
| Admin policy | `npm --prefix server run test:admin-policy` | none | roles, permissions, final-admin guard policy |
| Money unit | `npm --prefix server run test:money-unit` | none | exact 6-decimal parsing, arithmetic, rounding |
| Contract E2E | `npm test --prefix contracts` | in-process Ganache | 10 Phase 1 authority/solvency/migration groups |
| Migration E2E | `npm --prefix server run test:migrations` | disposable Postgres | fresh + upgrade + invariants + indexes |
| Money-loop E2E | `npm --prefix server run test:money` | disposable Postgres | real API/EVM/worker recovery and races |
| Canary unit | `npm --prefix server run test:phase3-canary` | none | manifest/policy binding, disabled/public modes, allowlist/window/exposure caps |
| Canary DB race | `npm --prefix server run test:phase3-canary-db` | migrated Postgres | simultaneous requests and manifest reissue cannot exceed release/policy cap; rollback removes admission |
| Restore verify | `npm --prefix server run restore:verify` | source + restored DB | exact restore integrity |
| Legacy platform smoke | `npm --prefix server run test:platform` | running local stack | older marketplace happy path |

## CI

`.github/workflows/ci.yml` has six jobs:

- web: lockfile install, production audit, MetaMask reachability, evidence-validator, lint, build;
- phase3-release: immutable manifest, deployment plan, readiness, catch-up, and canary gates;
- browser: Chromium install, wallet/accessibility/visual/routing/performance suite, artifact upload;
- server: lockfile install, production audit, build, migration check, resilience and all isolated
  security/unit suites;
- contract: compile and local-EVM E2E;
- money-loop: Postgres 16 service, versioned migrate, fresh/upgrade migration test,
  money-loop test, then PostgreSQL 16 dump/clean restore/exact verification.

CI has read-only repository permission and cancels superseded runs. The canonical
Phase 1 handoff run is [Product verification run 9](https://github.com/velostralabs/velostra/actions/runs/29403445476):
all four jobs passed against implementation baseline
`ea1b61de20613edd3727f90efb86766918152b07`. CI uses Node.js 22 with
`actions/checkout@v6` and `actions/setup-node@v6`.

## Money-loop coverage

The suite starts Ganache, deploys MockUSD and the current escrow, starts the real
Express API and HMAC-validating builder, and invokes the real worker. It proves:

1. wallet login, builder registration/init, agent submission/approval;
2. normal deposit, paid call, 90/10 split, claim, and hash replay rejection;
3. deposit/claim/platform withdrawal with no reporting endpoint call;
4. chain success followed by forced DB rollback;
5. exact `callId` recovery of output, user debit, builder credit, stats, and ledger;
6. retroactive idempotency with persistent cursor preservation;
7. concurrent live request and worker on one PROCESSING row: one winner/no-op loser;
8. receipt timeout with durable hash: AMBIGUOUS to APPLIED;
9. lost broadcast response with no DB hash: correlated event supplies the
   authoritative hash and applies exactly once;
10. late callbacks cannot regress terminal outbox state;
11. an authorized fee update uses the exact confirmed event split rather than the
    anticipated 90/10 split;
12. a claim waits while earlier earnings remain unresolved instead of silently
    clamping available earnings;
13. zero drift after every normal recovery and one reservation release/application;
14. twelve concurrent calls enforce ten unique settlements plus two intentional Redis limits;
15. DB reservations, signer serialization, call/transaction uniqueness, and exact money under load;
16. twelve unique unreported deposits catch up from a 27-block worker gap and replay idempotently;
17. an unconfirmed fork event is excluded, reverted, and replaced by the canonical event after two confirmations;
18. final deep readiness, zero drift, solvency, no reservation residue, and deterministic process exit.

The local-EVM dense scan uses one-block ranges to avoid Ganache batch-query variance;
planBlockRanges separately proves larger bounded ranges are contiguous and gap-free.

## Migration and restore evidence

`test:migrations` creates isolated schemas and verifies:

- upgrade data preserved exactly;
- `reserved_usd` initialized safely;
- all settlement states installed in order;
- money constraints reject invalid reservation/splits, negative earnings, and
  non-positive claims;
- fresh install creates 20 tables and required indexes.

The completed Phase 1 restore drill used a disposable PostgreSQL 16 database,
custom-format dump, clean restore, and `restore:verify`. Exact tables, row counts,
migration history, financial aggregates, outbox states, constraints, and indexes
matched.

## Local full gate

```bash
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
npm run audit:metamask
npm run test:browser
npm run test:phase2-evidence

npm --prefix server run build
npm --prefix server run db:check
npm --prefix server run test:config
npm --prefix server run test:resilience
npm --prefix server run test:observability
npm --prefix server run test:auth
npm --prefix server run test:ssrf
npm --prefix server run test:http-security
npm --prefix server run test:secrets
npm --prefix server run test:admin-policy
npm --prefix server run test:money-unit
npm audit --prefix server --omit=dev --audit-level=high

npm test --prefix contracts
npm audit --prefix contracts --omit=dev --audit-level=high

# disposable migrated Postgres
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm --prefix server run test:money
```

## Browser, wallet, and performance evidence

`npm run test:browser` builds a deterministic production fixture and runs 17 Chromium
tests with one worker so performance observations are isolated. Sixteen pass locally;
the guarded real-MetaMask isolated-staging test is skipped unless its explicit approval,
extension path, dedicated profile, base URL, and low-value inputs are supplied. The
passing suite includes eight serious/critical axe scans, keyboard focus containment/
restoration, desktop overflow/collision assertions, home/marketplace baselines,
canonical route history, an injected-wallet money/recovery path, and three route
performance budgets.

Real MetaMask is therefore automated but not yet evidenced. Execute
`npm run test:wallet:metamask` only against isolated staging and attach its report to
the Phase 2 evidence manifest.

## Current dependency audit

`npm audit --omit=dev --audit-level=high` reports no High/Critical production finding.
The web tree reports six Moderate entries propagated from one transitive `uuid`
advisory in the MetaMask connector tree, with no supported upstream fix. The two
installed reviewed call sites use `uuid.v4()` without a caller-supplied buffer, so the
advisory's v3/v5/v6 buffer condition is not reachable through the current application
path. `npm run audit:metamask` fails if that assumption changes. The decision is
time-bounded in [METAMASK_DEPENDENCY_DISPOSITION.md](./METAMASK_DEPENDENCY_DISPOSITION.md).

## Phase 2 operational evidence still required

- real MetaMask journey and frozen managed-staging performance baseline;
- managed secret/signer/authority rotation and compromise drills;
- real operator delivery/acknowledgement for every required injected alert;
- one-hour API/worker outage plus managed DB, Redis, RPC, restart, and ambiguity faults;
- provider-native managed PITR with measured RPO/RTO;
- minimum 72-hour soak with restart, daily reconciliation, zero drift/stale rows/
  High-Critical findings/unowned alerts;
- signed SHA-256-bound release packet accepted by `npm run phase2:evidence`;
- independent contract and focused backend review before real-value/mainnet release.

The RPC failover, concurrent load, dense local catch-up, reorg, browser, disposable
restore, soak-runner, and evidence-validator implementations are complete and locally
verified. They do not substitute for the external items above.

Warnings from Ganache's optional native µWS fallback or listener count are test-runtime
fallback notices; receipt assertions, financial invariants, and process exit remain the
gate.
