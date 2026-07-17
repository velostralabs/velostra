# Operations and incident runbook

> Last verified against the workspace: 2026-07-17.
> Phase state: Phase 0-4 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> No mainnet deployment is recorded in this repository.

## Production process model

Run the API, reconciliation worker, webhook worker, and operational monitor as
separate supervised processes from the same immutable backend build. Use managed PostgreSQL with PITR, managed Redis,
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
signer remains a single bounded nonce writer.

## US-only staging operations

The executable runbook is [deploy/gcp/README.md](../deploy/gcp/README.md). Before
any Apply action:

1. run both staging policy and deployment-plan tests;
2. confirm the project and every provider region is the selected US Virginia region;
3. confirm the release equals the clean current full commit;
4. use immutable server/web image digests;
5. keep paid writes disabled;
6. use the hidden-prompt helper for Secret Manager values;
7. retain generated records only under ignored artifacts/staging.

Google Cloud Billing is not active for the authenticated account, so no GCP staging
resource exists yet. Do not record readiness, rotation, alert, outage, PITR, or soak
evidence until the actual managed service produced it.

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
endpoint remains unavailable, the watch loop resumes from the unchanged cursor. Local
load/reorg evidence proves correctness, but only the pending managed-staging one-hour
drill may freeze the catch-up SLO.

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
it writes a redacted RPO/RTO evidence artifact. The disposable timed drill passed; the
provider-native managed PITR drill remains an external mainnet release prerequisite.

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
