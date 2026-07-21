# Testing and release evidence

> Workspace verification refreshed 2026-07-21; latest managed public-testnet evidence
> remains the 2026-07-20 checkpoint until this local commit set is published.
> Phase state: Phase 0-4 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.

## Automated matrix

| Suite | Command | Dependency | Proves |
|---|---|---|---|
| Web lint | `npm run lint` | none | source/static checks |
| Web build | `npm run build` | none | TypeScript + Vite production bundle |
| Netlify production build | `netlify build --context production` | linked Netlify project | tracked Node 22 build command and `dist/` publish contract |
| Public privacy | `npm run test:privacy` | Git | tracked content excludes private paths/keys/non-public email domains; HEAD uses Velostra public attribution |
| Social assets | `npm run test:social-assets` | none | X/OG dimensions, metadata hygiene, and link-preview tags |
| Browser gate | `npm run test:browser` | Playwright Chromium | wallet/account/chain binding, synchronized auth gates, no-resubmit paid-call recovery, deep-runtime truth, bounded deposit/claim proof, axe, keyboard, layout, visual, URL, and performance budgets |
| Evidence validator | `npm run test:phase2-evidence` | none | complete packet passes; tampering fails closed |
| Phase 3 release | npm run test:phase3-release | contract dependencies | exact manifest sets, policy/authority binding, deployment provenance, checkpoint/canary tamper gates |
| Phase 3 aggregate | `npm run test:phase3` | root/server/contract installs | release gates, server compile/config, canary guard, migration consistency |
| Phase 4 SDK | npm run test:phase4-sdk | Node + Python 3 | JS/Python client behavior and exact shared HMAC fixtures |
| Phase 4 unit | npm run test:phase4-unit | root/server/Python installs | SDKs, cursors, idempotency policy, permissions, privacy/telemetry policy |
| Phase 4 DB E2E | npm run test:phase4-db | migrated disposable Postgres | v1/idempotency/revision/webhook/moderation/privacy races, owner-scoped call recovery isolation, and zero drift |
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
| Managed KMS signer | `npm --prefix server run test:kms-signer` | none | DER/PEM handling, low-S signature, sender recovery, durable concurrent idempotency, and conflicting-payload rejection |
| US staging policy | `powershell -NoProfile -File deploy/gcp/test-staging-policy.ps1` | PowerShell | chain 46630, Virginia-only residency, provider caps, schedules, and USD 35 envelope |
| US deployment plan | `powershell -NoProfile -File deploy/gcp/test-deployment-plan.ps1` | PowerShell + gcloud CLI | plan-only bootstrap/runtime/web commands, immutable digests, checked native-command failures, private signer entrypoint, bounded services, valid worker intervals, staggered jobs, and no migration without opt-in |
| Testnet Safe authority | `npm run test:testnet-authorities` | Windows PowerShell + Node.js 22 | CSPRNG/DPAPI custody round trip, three disjoint 2-of-3 plans, plan-only clean-tree broadcast, private-key cleanup, and live policy validation |
| Managed staging live probe | guarded runbook steps with ignored artifacts | Robinhood testnet + US providers | contract checks, migration, API deep readiness 8/8, worker heartbeats, public web response, private signer boundary, and bounded-write policy |
| Managed skipped-report reconciliation | `powershell -NoProfile -File deploy/gcp/run-reconciliation-evidence.ps1 -Apply` | managed US testnet staging | direct synthetic escrow deposit with no report endpoint, missing-DB precondition, event backfill, safe cursor advancement, and Scheduler cleanup |
| Authority policy | `npm --prefix server run test:authority` | none | owned multisig roles and exact single-approval restricted settler policy |
| Admin policy | `npm --prefix server run test:admin-policy` | none | roles, permissions, final-admin guard policy |
| Money unit | `npm --prefix server run test:money-unit` | none | exact 6-decimal parsing, arithmetic, rounding |
| Contract E2E | `npm test --prefix contracts` | in-process Ganache | 10 Phase 1 authority/solvency/migration groups |
| Migration E2E | `npm --prefix server run test:migrations` | disposable Postgres | fresh + upgrade + invariants + indexes |
| Money-loop E2E | `npm --prefix server run test:money` | disposable Postgres | real API/EVM/worker recovery and races |
| Canary unit | `npm --prefix server run test:phase3-canary` | none | manifest/policy binding, disabled/public modes, allowlist/window/exposure caps |
| Canary DB race | npm --prefix server run test:phase3-canary-db | migrated Postgres | simultaneous requests and manifest reissue cannot exceed release/policy cap; rollback removes admission |
| Restore verify | `npm --prefix server run restore:verify` | source + restored DB | exact restore integrity |
| Legacy platform smoke | `npm --prefix server run test:platform` | running local stack | older marketplace happy path |

## CI

.github/workflows/ci.yml has seven jobs:

- web: lockfile install, production audit, MetaMask reachability, evidence-validator, lint, build;
- phase4-contracts: JavaScript/Python SDK fixtures plus platform/admin policy contracts;
- phase3-release: immutable manifest, deployment plan, readiness, catch-up, and canary gates;
- browser: Chromium install, wallet/accessibility/visual/routing/performance suite, artifact upload;
- server: lockfile install, production audit, build, migration check, resilience and all isolated
  security/unit suites;
- contract: compile and local-EVM E2E;
- money-loop: Postgres 16 service, versioned migrate, fresh/upgrade migration test,
  Phase 4 PostgreSQL E2E, money-loop test, then PostgreSQL 16 dump/clean restore/exact verification.

CI has read-only repository permission and cancels superseded runs. The canonical
Phase 1 handoff run is [Product verification run 9](https://github.com/velostralabs/velostra/actions/runs/29403445476):
all four jobs passed against implementation baseline
`ea1b61de20613edd3727f90efb86766918152b07`. The complete Phase 3 handoff and pre-Phase 4 closeout are
verified by [Product verification run 29455761339](https://github.com/velostralabs/velostra/actions/runs/29455761339)
and [staging artifact run 29455761330](https://github.com/velostralabs/velostra/actions/runs/29455761330);
both passed on `47747e4a1c85825975361e903f6ab0b2069b6cb2`. CI uses Node.js 22 with
`actions/checkout@v6` and `actions/setup-node@v6`.

The latest public-deployment truth checkpoint `6e83a04fca4c2eca7c82f59fe770955186366dfc`
passed [Product verification run 29612763222](https://github.com/velostralabs/velostra/actions/runs/29612763222)
and [staging artifact run 29612763312](https://github.com/velostralabs/velostra/actions/runs/29612763312).

## Public frontend deployment smoke

The canonical testnet at `https://velostra.xyz/testnet` was verified on 2026-07-20:

1. Netlify served the Git-linked `main` build with hashed JavaScript/CSS assets.
2. Apex TLS and the `www` redirect reached the canonical site.
3. A clean browser rendered `TESTNET LIVE`, the wallet entry point, official faucet
   guidance, synthetic mint path, and execution onboarding without layout overflow.
4. The browser console had no errors and the route title identified the public testnet.
5. Managed health and deep readiness passed; public mode reported bounded synthetic
   paid writes and chain 46630.
6. Post-open reconciliation, webhook, and monitor runs completed successfully with
   zero unexplained onchain/Postgres drift.

The smoke uses only public identifiers. It does not expose credentials, signer
identity, wallet addresses, provider IDs, or real value.

## Final testnet product-completion regression

The 2026-07-21 local release candidate adds and verifies the final browser/API safety
contract before publication:

1. one ambiguous paid request yields one POST, one idempotency key, one correlated
   call, automatic owner-scoped polling, and one final debit/builder credit;
2. a wallet account change immediately removes the prior wallet's protected values,
   and a wrong chain cannot verify or invoke protected actions;
3. one successful verification refreshes every protected gate on the same page;
4. `TESTNET LIVE` requires both matching staging health and deep readiness; readiness
   failure renders `RUNTIME DEGRADED` and never claims recovery availability;
5. public top-up and claim bounds fail before wallet submission, while successful
   deposit, claim, and settlement states retain explorer proof;
6. the call-status endpoint passes owner/foreign-wallet/invalid-ID cases against a
   freshly migrated disposable PostgreSQL 16 database.

The complete local release gate then passed: 22 deterministic Chromium checks plus
one intentionally guarded real-extension skip, all Phase 3/4 unit and database suites,
contract E2E, migration/observability/canary races, the Redis-backed full money loop,
privacy/social checks, US staging policy, Netlify production build, and server/web
production dependency audits. The contract production dependency tree is empty;
Ganache remains an isolated dev-only toolchain with its documented advisories.

This is workspace evidence for the unpushed commit set, not a claim that the public
CDN already serves that revision. Publication and post-deploy smoke remain the
handoff after owner approval.

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
- fresh install creates 30 tables, 28 critical constraints, and 27 critical indexes.

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
npm run test:phase3-release
npm run test:phase4-unit

npm --prefix server run build
npm --prefix server run db:check
npm --prefix server run test:config
npm --prefix server run test:resilience
npm --prefix server run test:observability
npm --prefix server run test:auth
npm --prefix server run test:ssrf
npm --prefix server run test:http-security
npm --prefix server run test:secrets
npm --prefix server run test:signer
npm --prefix server run test:authority
npm --prefix server run test:phase3-canary
npm --prefix server run test:admin-policy
npm --prefix server run test:money-unit
npm audit --prefix server --omit=dev --audit-level=high

npm test --prefix contracts
npm ls --prefix contracts --omit=dev --depth=0

# disposable migrated Postgres
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm --prefix server run test:observability-db
npm --prefix server run test:phase3-canary-db
npm run test:phase4-db
npm --prefix server run test:money
```

## Phase 4 platform E2E coverage

The isolated PostgreSQL suite proves:

1. v1 submit/approve and stable response/version contract;
2. concurrent identical idempotency has one mutation and exact replay;
3. conflicting and expired-indeterminate keys fail closed;
4. concurrent revision publish has one winner and published history is immutable;
5. concurrent webhook workers claim once, sign exact bytes, and record one attempt;
6. call recovery returns terminal output only to the owning wallet and makes foreign
   and missing calls indistinguishable;
7. builder analytics match exact persisted calls/earnings/claims;
8. invalid report evidence is rejected and valid evidence enters the queue;
9. bounded retries dead-letter, audited replay preserves history, and replay races once;
10. moderation races permit one valid transition;
11. cursor pagination is stable and tampering/filter reuse fails;
12. export/delete workflows anonymize personal data while retaining financial evidence;
13. prohibited telemetry fails closed;
14. final financial aggregate, webhook delivery, and duplicate counts have zero drift.

## Browser, wallet, and performance evidence

`npm run test:browser` builds a deterministic production fixture and runs 23 Chromium
tests with one worker so performance observations are isolated. Twenty-two pass locally;
the guarded real-MetaMask isolated-staging test is skipped unless its explicit approval,
extension path, dedicated profile, base URL, and low-value inputs are supplied. The
passing suite includes eight serious/critical axe scans, keyboard focus containment/
restoration, desktop overflow/collision assertions, home/marketplace baselines,
canonical route history, rapid multi-filter URL-state preservation, an injected-wallet
money/recovery path, and three route performance budgets.

Synthetic INP is sampled only after network idle, font readiness, and two paint frames.
The committed product target remains 200 ms. Shared CI runners receive a separately
declared 50 ms scheduler-jitter allowance, and every run logs the raw route vitals plus
the effective assertion limit so the allowance cannot hide silently.

The bounded real-MetaMask staging path has now executed with synthetic value. Its
browser wrapper did not observe the expected terminal UI state, so the original
wrapper artifacts remain failed rather than being rewritten. Managed reconciliation
completed the chain-confirmed state and the retained read-only verifier proves one
matching claim receipt/event, exact database/chain totals, and disabled paid writes.
This reconciled proof is the current money-path authority.

The managed skipped-report repair is separately evidenced and passed on 2026-07-19.
The guarded runner deliberately sends a direct synthetic-token escrow deposit without
calling `/api/dashboard/topup`, verifies the missing Postgres row, runs one
reconciliation pass, and checks the repaired record/cursor before resuming Scheduler.
It is an independent skipped-report recovery proof; the bounded wallet/claim
evidence is retained separately in [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md).

## Current dependency audit

`npm audit --omit=dev --audit-level=high` reports no High/Critical web production
finding, and the server production audit reports zero vulnerabilities. The web tree
reports six Moderate entries propagated from one transitive `uuid` advisory in the
MetaMask connector tree, with no supported upstream fix. The two installed reviewed
call sites use `uuid.v4()` without a caller-supplied buffer, so the advisory's
v3/v5/v6 buffer condition is not reachable through the current application path.
`npm run audit:metamask` fails if that assumption changes. The decision is time-bound
in [METAMASK_DEPENDENCY_DISPOSITION.md](./METAMASK_DEPENDENCY_DISPOSITION.md).

The contract package has no production dependency tree (`npm ls --prefix contracts
--omit=dev --depth=0` is empty). A full dev audit still reports advisories inside
Ganache's bundled local-EVM toolchain; those packages are neither installed nor
shipped in a production-only contract artifact. They remain an explicit mainnet
review/tooling-replacement item rather than a hidden passing audit.

## Mainnet operational evidence still required

- independent contract and focused backend review;
- a signed SHA-256-bound mainnet release packet accepted by `npm run phase2:evidence`;
- accountable production authority, signer/secret rotation, backup/restore, alert,
  incident, and SLO ownership;
- deterministic mainnet readiness with paid writes disabled;
- a separately approved low-value allowlisted mainnet canary and expansion decision.

The testnet duration checkpoint is `PASS_BY_OWNER_WAIVER`, execution `NOT_RUN`; no
72-hour telemetry is claimed. The public testnet checkpoint itself is PASS.

The RPC failover, concurrent load, dense local catch-up, reorg, browser, disposable
restore, soak-runner, evidence-validator, managed KMS signer, and US-only deployment
policy/plan implementations are complete and locally verified. The deployment-plan
test performs no external mutation. These checks do not substitute for the external
items above.

Warnings from Ganache's optional native µWS fallback or listener count are test-runtime
fallback notices; receipt assertions, financial invariants, and process exit remain the
gate.
