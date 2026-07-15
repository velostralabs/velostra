# Testing and release evidence

> Last verified against test files and scripts: 2026-07-15.

## Automated matrix

| Suite | Command | Dependency | Proves |
|---|---|---|---|
| Web lint | `npm run lint` | none | source/static checks |
| Web build | `npm run build` | none | TypeScript + Vite production bundle |
| API build | `npm --prefix server run build` | none | strict server compile |
| Migration check | `npm --prefix server run db:check` | none | Drizzle migration consistency |
| Production config | `npm --prefix server run test:config` | none | unsafe production settings fail closed |
| Auth | `npm --prefix server run test:auth` | none | bound challenge, Redis-style atomic multi-instance replay defense |
| SSRF | `npm --prefix server run test:ssrf` | local sockets/DNS doubles | blocked ranges, redirect/DNS/size/timeout boundary |
| HTTP security | `npm --prefix server run test:http-security` | none | origin, headers, request IDs, body/JSON/404 codes |
| Secret envelope | `npm --prefix server run test:secrets` | none | encrypt/decrypt/tamper/rotation/revoke behavior |
| Admin policy | `npm --prefix server run test:admin-policy` | none | roles, permissions, final-admin guard policy |
| Money unit | `npm --prefix server run test:money-unit` | none | exact 6-decimal parsing, arithmetic, rounding |
| Contract E2E | `npm test --prefix contracts` | in-process Ganache | 10 Phase 1 authority/solvency/migration groups |
| Migration E2E | `npm --prefix server run test:migrations` | disposable Postgres | fresh + upgrade + invariants + indexes |
| Money-loop E2E | `npm --prefix server run test:money` | disposable Postgres | real API/EVM/worker recovery and races |
| Restore verify | `npm --prefix server run restore:verify` | source + restored DB | exact restore integrity |
| Legacy platform smoke | `npm --prefix server run test:platform` | running local stack | older marketplace happy path |

## CI

`.github/workflows/ci.yml` has four jobs:

- web: lockfile install, production audit at high threshold, lint, build;
- server: lockfile install, production audit, build, migration check, all isolated
  security/unit suites;
- contract: compile and local-EVM E2E;
- money-loop: Postgres 16 service, versioned migrate, fresh/upgrade migration test,
  money-loop test, then PostgreSQL 16 dump/clean restore/exact verification.

CI has read-only repository permission and cancels superseded runs.

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
10. zero drift after every recovery and one reservation release/application.

The suite intentionally uses tiny block ranges so multi-chunk behavior executes.

## Migration and restore evidence

`test:migrations` creates isolated schemas and verifies:

- upgrade data preserved exactly;
- `reserved_usd` initialized safely;
- all settlement states installed in order;
- money constraints reject invalid reservation/splits, negative earnings, and
  non-positive claims;
- fresh install creates 17 tables and required indexes.

The completed Phase 1 restore drill used a disposable PostgreSQL 16 database,
custom-format dump, clean restore, and `restore:verify`. Exact tables, row counts,
migration history, financial aggregates, outbox states, constraints, and indexes
matched.

## Local full gate

```bash
npm run lint
npm run build
npm audit --omit=dev --audit-level=high

npm --prefix server run build
npm --prefix server run db:check
npm --prefix server run test:config
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

## Manual browser evidence

Desktop product QA has covered canonical routes, no horizontal overflow, lazy
surfaces, offline marketplace state, execution/settlement controls, and provider
picker layout/deduplication. It did not grant a real extension permission or submit
real target-chain value.

## Current dependency audit

Final `npm audit --omit=dev --audit-level=high` results on 2026-07-15:

- backend: 0 vulnerabilities;
- contract package: 0 vulnerabilities;
- web: 6 moderate vulnerabilities from transitive `uuid <11.1.1` inside the
  MetaMask connector dependency tree; npm reports no fix available.

The web command exits successfully at the CI High threshold, but the moderate
finding remains an explicit pre-production reachability/upstream/accepted-risk
review item. It is not silently treated as fixed.

The final local regression also ran `npm --prefix server run test:platform`
against the local API and mock builder. The complete legacy marketplace path
passed: builder signup, registration, submission, admin approval, public
marketplace, real free call, review, admin stats, and user dashboard.

## Remaining Phase 2 evidence

- external audit and focused review are the final Phase 1 sign-off;
- real MetaMask + one injected provider automation;
- visual regression and accessibility automation;
- one-hour API/worker/RPC outage timing;
- RPC 429/failover and dense-event scan;
- reorg rollback decision/drill;
- concurrent signer/load/DB pool pressure;
- managed PITR and timed restore;
- alert delivery to an operator and 72-hour staging soak.

Warnings from Ganache's optional native µWS fallback or Node test listener count do
not represent a product test failure; assertions and process exit remain the gate.