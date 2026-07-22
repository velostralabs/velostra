# Operations and incident runbook

> Operations contract refreshed 2026-07-22 against the live public testnet, managed
> workers/Scheduler, private alerts, recovery evidence, and mainnet isolation rules.
> Phase 0-4 repository preparation and the public testnet checkpoint are complete.
> The canonical `https://velostra.xyz/testnet` frontend is connected to the US-only
> chain-46630 managed runtime. Deep readiness is 8/8 and bounded public synthetic paid
> writes are enabled. No mainnet or real-value deployment is recorded.

## Current public frontend operations

Netlify owns the public browser-delivery path; the browser itself owns no financial
authority. The production project
is site `velostra` under the Velostra/`velostralabs` team, linked to GitHub
`velostralabs/velostra` branch `main`. The tracked deployment contract is:

    [build]
      command = "npm run build"
      publish = "dist"

Node.js 22 is pinned in `netlify.toml`; `public/_redirects` provides SPA fallback.
Never change the publish directory to the repository root: doing so serves source
`index.html` with `/src/main.tsx` and produces a blank browser surface.

After every frontend deployment, verify:

    curl -I https://velostra.xyz/
    curl -I -L https://www.velostra.xyz/
    curl -I https://velostra.xyz/testnet

Then confirm production HTML references hashed `/assets/*.js` and `/assets/*.css`,
those assets return 200 with JavaScript/CSS MIME types, and a real browser renders
navigation plus the landing heading. On `/testnet`, verify shallow health and deep
readiness agree before the live badge appears; verify account/chain switching hides
protected state and an ambiguous paid call resumes by its original `call_id` without
a second POST. Roll back with Netlify deploy history only to a known Git-linked build;
do not rewrite Git history.

The Netlify environment contains only public testnet API/escrow/token build values.
A healthy browser smoke is still not sufficient: require managed `/health`, deep
`/ready`, worker heartbeats, signer funding, and zero-drift evidence.

## Production process model

Run the API, reconciliation worker, webhook worker, and operational monitor as
separate supervised processes from the same immutable backend build. Use managed
PostgreSQL with PITR, managed Redis,
dedicated primary/fallback HTTPS RPCs, TLS at the edge, and a secret manager.

```bash
# release schema first
npm --prefix server run db:migrate

# HTTP process
node server/dist/index.js

# continuous recovery process
node server/dist/jobs/reconcile.js --watch

# durable webhook delivery
node server/dist/jobs/webhooks.js --watch

# readiness/alert evaluation
node server/dist/jobs/monitor.js --watch
```

Production should keep continuous supervised workers unless its measured operating
model chooses an equivalent scheduler. The low-cost US staging target intentionally
uses one-shot Cloud Run Jobs every 15 minutes, staggered at minute 0, 2, and 5.
Each job has one task, a bounded timeout, at most one retry, and a 20-minute
heartbeat/readiness age. Unique constraints make overlap idempotent; the private
signer remains a single bounded nonce writer. Deep operational-state sampling is
serialized so the API cannot fan out nine readiness reads across its five-connection
pool while scheduled jobs are completing.

## US-only staging operations

The executable runbook is [deploy/gcp/README.md](../deploy/gcp/README.md). Before
any Apply action:

1. run both staging policy and deployment-plan tests;
2. confirm the project and every provider region is the selected US Virginia region;
3. confirm the release equals the clean current full commit;
4. use immutable server/web image digests;
5. confirm paid-write mode matches the intended state; opening public mode requires
   its guarded control command;
6. use the hidden-prompt helper for Secret Manager values;
7. retain generated records only under ignored artifacts/staging.

The US foundation, managed data plane, twelve scoped secrets, HSM settler, and direct
private-Telegram connection are active. Three disjoint canonical Safe 1.4.1 2-of-3
authorities plus the synthetic token and escrow are deployed and verified. Immutable
Cloud Run signer/API/web services, migrations, reconciliation/webhook/monitor jobs,
and Scheduler triggers are live. The public origin is bound, all eight deep-readiness
checks pass, signer gas is healthy, and bounded public synthetic paid writes are
enabled. Post-open manual worker runs passed with zero unexplained drift. The retained
wallet/reconciliation, alert lifecycle, timed outage, PITR, RPC fallback, and read-only
control evidence is summarized in [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md).

## Public testnet control

Inspect or change the bounded public-testnet state only through the guarded wrapper:

```powershell
npm run staging:public -- --Action Status
npm run staging:public -- --Action Open --Apply
npm run staging:public -- --Action Close --Apply
```

`Open` requires the exact immutable backend release, clean tree, fresh signer-funding
evidence, health, and deep readiness. Its fixed limits are 5 synthetic USDG per paid
call, 10 paid calls per wallet per day, 1,000 global paid calls per day, and a 100
synthetic-USDG top-up cap. `Close` disables new paid calls but preserves claims,
indexing, reconciliation, and operator recovery. Use `Close` first for drift, stale
critical outbox work, signer depletion, or readiness loss.

## Reconciliation commands

```bash
# one normal catch-up to safe head
npm --prefix server run reconcile

# exact incident range; persistent normal cursor is preserved for retroactive scans
npm --prefix server run reconcile -- --from-block=123456 --to-block=125000

# development watch process
npm --prefix server run reconcile:worker
```

Never edit `chain_sync_state` by hand during an incident. Record the contract,
chain, current cursor, safe head, command, and output in the incident timeline.

## What the worker heals

- deposits confirmed without a `/dashboard/topup` report;
- claims confirmed without a `/builder/claim` report;
- platform withdrawals missing from Postgres;
- paid calls confirmed after API/DB failure;
- receipt timeouts with a durable transaction hash;
- a lost broadcast response where no hash reached Postgres, using the correlated
  `EarningsCredited.callId` event;
- a race between live finalization and reconciliation, with one financial winner.

Outbox states are `PREPARED`, `READY`, `SUBMITTED`, `AMBIGUOUS`, `CONFIRMED`,
`APPLIED`, and `FAILED`. `AMBIGUOUS` is not a failure: its reservation remains until
chain evidence proves success or a definitive safe failure path releases it.

## One-hour outage catch-up

A one-hour API/worker outage does not lose confirmed events. On restart:

1. read `last_processed_block`;
2. compute `safeHead = latest - confirmations`;
3. scan sequential chunks, default 2,000 blocks;
4. split a chunk on range/size/timeout errors;
5. retry RPC with exponential backoff;
6. commit the cursor only after each contiguous range is durably ingested;
7. retry pending raw events and outbox attempts;
8. emit a drift report.

At an illustrative 100 ms block interval, one hour is about 36,000 blocks or 18
default chunks. A 429 is not recursively split; viem first fails over through the
configured `ROBINHOOD_RPC_FALLBACK_URLS`, then iteration-level retry/backoff applies. If every
endpoint remains unavailable, the watch loop resumes from the unchanged cursor. The
managed Scheduler was paused for 3,610,626 ms, then caught up to the recorded safe
head in 7,225 ms with zero skipped ranges, duplicates, pending events/outbox, or drift;
Scheduler was independently confirmed ENABLED. This is a reconciliation-schedule
outage proof, not a destructive API/Postgres/Redis outage.

## Webhook delivery and recovery

The webhook worker is a separate supervised role:

~~~bash
npm --prefix server run webhooks
npm --prefix server run webhooks:worker
~~~

It claims due deliveries conditionally, records an attempt, signs exact body bytes,
and then marks DELIVERED, reschedules with bounded exponential backoff, or moves an
exhausted row to DEAD_LETTER. Multiple workers may overlap safely because only one
conditional claim owns an active lock; an expired lock is recoverable.

Alert on stale webhook heartbeat, oldest pending delivery above the agreed threshold,
dead-letter growth, repeated 429/5xx/timeouts, and signature rejection. /ready can
require both reconciliation and webhook heartbeats.

Incident procedure:

1. verify subscription status, URL policy, event type, and secret version;
2. inspect delivery plus ordered attempt history; never edit attempt rows;
3. pause a compromised/noisy subscription and rotate its secret when appropriate;
4. fix endpoint/network policy and verify exact-body signature independently;
5. replay only DEAD_LETTER through the RBAC-protected audited endpoint;
6. confirm one consumer business effect by stable event ID and a DELIVERED row;
7. record operator, delivery/event IDs, timestamps, and cause in the incident log.

At-least-once delivery means a timeout can occur after the receiver applied the
event. Receivers must deduplicate by event ID; operator replay is never proof that
the previous HTTP effect did not happen.

## Phase 3 readiness, canary, and stop procedure

1. Mount immutable manifest/policy inputs read-only and evidence output separately.
2. Start migration/API/reconciliation/webhook/monitor roles with the exact deployed manifest. Leave
   `PHASE3_PAID_WRITES_MODE=disabled`.
3. Capture `phase3:snapshot` and require `release:readiness` = `GO`.
4. Set the reviewed canary policy hash, RFC3339 start, and mode `canary`.
5. Run only allowlisted low-value deposit, paid-call, reconciliation, claim, and
   platform-revenue flows. The API rejects unlisted or over-cap calls before builder
   execution and serializes global capacity in Postgres.
6. Capture the final readiness snapshot and `phase3:canary-summary`, then run
   `release:canary`.
7. On `STOP`, immediately set paid mode `disabled`, preserve claims, keep the worker
   and monitor live, capture evidence, and forward-repair. Never roll back financial
   migrations or delete admission/event/outbox rows.
8. On `PASS_AWAITING_OPERATOR`, keep canary/disabled mode until the incident owner
   approves the hash-bound decision. The evaluator never expands traffic itself.

A process restart after the canary duration fails closed. Failed calls still consume
the bounded canary budget conservatively. An admission rolls back if reservation or
outbox creation fails; confirmed ambiguous calls remain admitted until reconciliation
settles them.

## Required alerts

Alert on:

- `DRIFT WARNING` above `RECONCILE_DRIFT_THRESHOLD`;
- reconciliation or webhook worker heartbeat missing for two intervals;
- oldest pending webhook delivery or dead-letter count above policy;
- cursor-to-safe-head lag above the agreed block/time SLO;
- oldest unreconciled event or nonterminal settlement attempt age;
- repeated RPC 429/timeout/range split;
- API `SETTLEMENT_AMBIGUOUS` or `RECONCILIATION_PENDING` rate;
- Redis/DB connection failures;
- escrow `isSolvent() == false`;
- signer gas below minimum or abnormal signer nonce/volume;
- unexpected role grant/revoke, pause, fee update, successor declaration, or
  liquidity migration.

Metrics, durable alert state, webhook transport, dedupe, acknowledgement, resolution,
severity, and runbook links are implemented. Delivery of every injected scenario to a
real operator remains an external mainnet release artifact.

## Incident: drift warning

1. stop new paid-call writes if drift is growing; do not stop claims;
2. capture deployment address, cursor, safe head, drift components, and pending rows;
3. verify RPC chain ID and contract address;
4. run a normal one-shot catch-up;
5. run a bounded retroactive scan over the suspected range;
6. compare `chain_events`, `transactions`, `earnings_claims`, and
   `settlement_attempts` by tx/call ID;
7. if chain evidence is confirmed and exact, allow worker repair;
8. if unexplained drift remains, pause new deposits/settlement and escalate to
   contract + database incident response.

Never create a manual financial row without an incident record and independent
review of the exact chain event.

## Incident: ambiguous settlement

- Keep the user reservation intact.
- Search for `EarningsCredited` by `onchain_call_id` and builder.
- If a stored tx hash exists, inspect its receipt on at least two RPC providers.
- Run reconciliation through the confirmed event block.
- Confirm call `SUCCESS`, attempt `APPLIED`, one ledger row, zero reservation, and
  exact builder/platform split.
- If a recovery rebroadcast reverted, wait for the correlated original event; do
  not mark the call failed merely because the candidate hash reverted.

## Incident: signer compromise

1. pause new settlement with `PAUSER_ROLE`;
2. governance grants `SETTLER_ROLE` to the replacement signer;
3. governance revokes the compromised signer;
4. rotate runtime secret and restart the logical signer writer;
5. scan all `EarningsCredited` events and role events since the exposure window;
6. reconcile exact call IDs and investigate unknown IDs/amounts;
7. unpause only after drift is zero and the replacement path passes a canary.

The pause guardian cannot unpause, withdraw, settle, or change fees.

## Contract successor procedure

1. deploy and independently verify the audited successor;
2. pause the predecessor;
3. governance calls `declareSuccessorEscrow(successor)` once;
4. predecessor becomes permanently closed to deposits and new settlements;
5. treasury calls `migrateAvailableLiquidity()`; only liquidity above all old
   builder/platform liabilities moves;
6. keep the predecessor worker and claims live until liabilities reach zero;
7. verify both escrow balances and all ledger/drift totals before frontend cutover.

## Database backup, PITR, and restore

Minimum policy before staging:

- encrypted daily logical backup plus provider-native continuous WAL/PITR;
- retention: 35 daily, 12 monthly, and incident/legal holds as required;
- backup credentials separate from runtime credentials;
- restore into an isolated database at least monthly and before a mainnet release;
- record RPO/RTO, restore duration, backup ID, migration head, row counts, exact
  financial aggregates, constraints, and indexes.

Local restore verification:

```bash
pg_dump --format=custom --file=velostra.dump "$SOURCE_DATABASE_URL"
createdb velostra_restore
pg_restore --no-owner --no-privileges --dbname="$RESTORED_DATABASE_URL" velostra.dump
SOURCE_DATABASE_URL=... RESTORED_DATABASE_URL=... npm --prefix server run restore:verify
```

`restore:verify` compares all 30 public tables, at least nine migrations, exact transaction/
claim/credit/earnings/call/outbox aggregates, critical constraints, and indexes. When
`RESTORE_DRILL_STARTED_AT`, `BACKUP_CAPTURED_AT`, and `RESTORE_EVIDENCE_PATH` are set,
it writes a redacted RPO/RTO evidence artifact. Provider-native Neon PITR now also
passes for 30 tables, nine migrations, exact row counts/financial aggregates,
constraints, and indexes. The disposable provider branch was deleted after the
redacted evidence was retained.

## Secret rotation

- JWT/HMAC/webhook/database/Redis/RPC/signer secrets are injected by the deployment secret
  manager, never committed. For the US GCP target, use
  deploy/gcp/set-secret-version.ps1 so the value is hidden, streamed over stdin, and
  never placed in command history or a local file.
- Agent envelope rotation: add the old key to
  `AGENT_SECRET_DECRYPTION_KEYS`, set the new current key/id, run
  `npm --prefix server run secrets:reencrypt`, verify, then remove the old key after
  the rollback window. Envelope re-encryption preserves the logical HMAC secret,
  its secret version, and its builder-rotation timestamp.
- Admin bootstrap wallets are only a bootstrap mechanism; production authorization
  lives in `admin_role_assignments`.

## Phase 2 staging evidence commands

All commands below fail closed unless the explicit isolated-staging approval and
attestation variables are present. Never point them at production/mainnet value.

Before the wallet evidence run, provision the release agent and public demo catalog from the
deployed immutable runtime. Use only a dedicated encrypted testnet wallet. The
script requires a clean worktree, binds to the ignored runtime artifact, validates
US chain 46630 and an explicit staging write mode (`disabled`, `canary`, or
`public`), health-checks the secretless service, then runs an idempotent Cloud Run
seed job. It derives isolated routes for all four demo profiles and aborts if an
existing agent or immutable revision differs:

    powershell -NoProfile -File deploy/gcp/provision-synthetic-agent.ps1 -Release <deployed-release> -ServerImage <immutable-server-digest> -SyntheticAgentUrl https://<synthetic-service>/execute -BuilderWallet <dedicated-test-wallet> -Apply

This step does not enable the API paid path. After public mode is opened through
`set-public-testnet.ps1`, repeat the catalog smoke with the dedicated wallet:

    powershell -NoProfile -File deploy/gcp/run-paid-canary.ps1 -PublicPaidCallOnly -Apply

The public mode requires the ignored runtime artifact to report US chain 46630 and
`paidWritesMode=public`. It performs a preflight and exactly one Wallet Sentinel paid
call. It sends no top-up or claim and never opens/closes paid writes. Its redacted
ignored evidence is `artifacts/staging/evidence/public-demo-paid-call.json`.

The earlier bounded MetaMask path also remains retained; use the exact read-only claim
verifier as its recovery authority and keep the original browser timeout artifacts unchanged.

    powershell -NoProfile -File deploy/gcp/check-staging-claim.ps1
    powershell -NoProfile -File deploy/gcp/capture-alert-lifecycle.ps1
    powershell -NoProfile -File deploy/gcp/run-one-hour-outage.ps1 -Apply
    npm run staging:control-readiness

Each command writes only redacted ignored evidence. The one-hour runner always resumes
Scheduler in `finally`; still verify provider state is `ENABLED` before handoff.

```bash
# measured paid-call load; writes artifacts/phase2/load-*.json
PHASE2_DRILL_APPROVED=isolated-staging-only \
PHASE2_BASE_URL=https://... PHASE2_EXPECTED_ENVIRONMENT=staging \
PHASE2_SESSION_COOKIE=... PHASE2_AGENT_SLUG=... npm run phase2:load

# minimum 72 hours; writes interrupt-safe JSONL checkpoints and summary
PHASE2_SOAK_APPROVED=isolated-staging-72h \
PHASE2_BASE_URL=https://... PHASE2_EXPECTED_ENVIRONMENT=staging \
PHASE2_METRICS_TOKEN=... PHASE2_SESSION_COOKIE=... PHASE2_AGENT_SLUG=... \
PHASE2_WORKER_RESTART_EVIDENCE_PATH=... PHASE2_FINDINGS_EVIDENCE_PATH=... \
npm run phase2:soak

# validate signed, SHA-256-bound release packet
PHASE2_EVIDENCE_MANIFEST=artifacts/phase2/evidence-manifest.json \
npm run phase2:evidence
```

The load/soak logs must not include cookies, metrics tokens, database URLs, RPC
credentials, or signer authorization. Use
[`config/phase2-evidence-manifest.example.json`](../config/phase2-evidence-manifest.example.json)
as the packet contract. Hash artifacts only after the frozen run completes; any later
change intentionally invalidates the manifest.

## Release evidence

Every release record must include commit SHA, migration head, contract address and
deployment block, constructor roles, CI run, dependency audit, contract test,
money-loop test, restore verification, drift result, canary tx hashes, and rollback
owner. See [AUDIT_READINESS.md](./AUDIT_READINESS.md).
