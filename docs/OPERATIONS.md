# Operations and incident runbook

> Last verified against the workspace: 2026-07-16.
> Phase state: Phase 2 repository scope is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> No mainnet deployment is recorded in this repository.

## Production process model

Run the API and reconciliation worker as separate supervised processes from the
same immutable backend build. Use managed PostgreSQL with PITR, managed Redis,
dedicated primary/fallback HTTPS RPCs, TLS at the edge, and a secret manager.

```bash
# release schema first
npm --prefix server run db:migrate

# HTTP process
node server/dist/index.js

# continuous recovery process
node server/dist/jobs/reconcile.js --watch
```

A scheduler may run `--once` every 30 seconds instead, but overlapping schedules
must have a runtime limit and alert on repeated failure. Unique constraints make
overlap idempotent; initial production still uses one supervised worker.

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

## Required alerts

Alert on:

- `DRIFT WARNING` above `RECONCILE_DRIFT_THRESHOLD`;
- worker heartbeat missing for two intervals;
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

`restore:verify` compares all 19 public tables, seven migrations, exact transaction/
claim/credit/earnings/call/outbox aggregates, critical constraints, and indexes. When
`RESTORE_DRILL_STARTED_AT`, `BACKUP_CAPTURED_AT`, and `RESTORE_EVIDENCE_PATH` are set,
it writes a redacted RPO/RTO evidence artifact. The disposable timed drill passed; the
provider-native managed PITR drill remains an external mainnet release prerequisite.

## Secret rotation

- JWT/HMAC/database/Redis/RPC/signer secrets are injected by the deployment secret
  manager, never committed.
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
PHASE2_BASE_URL=https://... PHASE2_EXPECTED_ENVIRONMENT=staging-isolated \
PHASE2_SESSION_COOKIE=... PHASE2_AGENT_SLUG=... npm run phase2:load

# minimum 72 hours; writes interrupt-safe JSONL checkpoints and summary
PHASE2_SOAK_APPROVED=isolated-staging-72h \
PHASE2_BASE_URL=https://... PHASE2_EXPECTED_ENVIRONMENT=staging-isolated \
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
