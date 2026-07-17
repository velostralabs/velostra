# Database schema and recovery

> Last verified against server/src/db/schema.ts, server/drizzle, and deployment status: 2026-07-18.
> Phase state: Phase 0-4 repository implementation is complete; activation remains gated.
> Managed database status: not provisioned; the public Netlify preview has no database connection.

Velostra uses PostgreSQL, Drizzle ORM, CUID2 application IDs, and nine reviewed SQL
migrations. Financial columns are numeric(20,6). Server decisions convert canonical
decimal strings to integer minor units; JavaScript numbers are presentation-only.

## Authority and relationships

Postgres owns spendable/reserved user credit and all product/control-plane state.
The escrow owns token custody and onchain liabilities. Confirmed chain logs are
authoritative recovery evidence, not a substitute for the product ledger.

~~~mermaid
erDiagram
    USERS ||--|| CREDIT_BALANCES : owns
    USERS ||--o| BUILDERS : becomes
    BUILDERS ||--|| BUILDER_EARNINGS : has
    BUILDERS ||--o{ AGENTS : owns
    AGENTS ||--o{ AGENT_REVISIONS : versions
    AGENT_REVISIONS ||--o{ AGENT_CALLS : executes
    AGENT_CALLS ||--|| SETTLEMENT_ATTEMPTS : recovers
    BUILDERS ||--o{ WEBHOOK_SUBSCRIPTIONS : configures
    WEBHOOK_EVENTS ||--o{ WEBHOOK_DELIVERIES : fans_out
    WEBHOOK_DELIVERIES ||--o{ WEBHOOK_DELIVERY_ATTEMPTS : records
    REPORTS ||--o{ MODERATION_ACTIONS : transitions
    USERS ||--o{ PRIVACY_REQUESTS : requests
~~~

## Table inventory

| Domain | Tables |
|---|---|
| Identity/admin | users, admin_role_assignments, admin_audit_logs |
| Durable API | api_idempotency_records |
| Financial | credit_balances, builder_earnings, earnings_claims, transactions |
| Marketplace | builders, agents, agent_tags, reviews, reports, platform_stats |
| Agent execution | agent_revisions, agent_calls, settlement_attempts, release_canary_admissions |
| Builder communication | user_notifications |
| Webhooks | webhook_subscriptions, webhook_events, webhook_deliveries, webhook_delivery_attempts |
| Trust/privacy | moderation_actions, privacy_requests, telemetry_field_registry |
| Chain recovery | chain_sync_state, chain_events |
| Operations | operational_heartbeats, operational_alerts |

There are 30 public application tables.

## Phase 4 state

- api_idempotency_records binds key, authenticated actor, operation, request
  fingerprint, PROCESSING/COMPLETED state, response, timestamps, and expiry.
- agent_revisions stores immutable snapshots with per-agent revision_number and
  DRAFT/PUBLISHED/SUPERSEDED state. agents.active_revision_id selects current state.
- agent_calls.agent_revision_id attributes every execution to its revision.
- user_notifications stores bounded builder/user operational messages.
- webhook_subscriptions stores encrypted/one-time-secret lifecycle metadata and event
  selection; webhook_events has stable dedupe identity; deliveries and attempts keep
  scheduling, claim, result, error, and dead-letter history.
- moderation_actions is append-only transition history for reports.
- privacy_requests owns EXPORT/DELETE workflow and result/rejection evidence.
- telemetry_field_registry records classification, purpose, owner, retention, and
  whether collection is enabled.

## Money and settlement invariants

Database checks enforce:

~~~text
balance_usd >= 0
reserved_usd >= 0
reserved_usd <= balance_usd
gross_amount > 0
builder_amount >= 0
platform_amount >= 0
gross_amount = builder_amount + platform_amount
~~~

Paid-call reservation conditionally checks balance - reserved. Finalization requires
both balance and reservation to cover gross. Only the conditional
PROCESSING -> SUCCESS winner may debit the user, credit builder earnings, increment
agent totals, link the transaction, and mark the outbox APPLIED.

Settlement attempt states are PREPARED, READY, SUBMITTED, AMBIGUOUS, CONFIRMED,
APPLIED, and FAILED. AMBIGUOUS retains its reservation until authoritative evidence
or a definitive failure.

## Uniqueness and concurrency

Critical database ownership rules include:

- unique transactions.tx_hash and optional one transaction per agent_call_id;
- unique earnings_claims.tx_hash;
- unique (chain_events.tx_hash, log_index);
- unique agent_calls.onchain_call_id;
- one settlement attempt and at most one canary admission per call;
- unique (agent_id, revision_number);
- unique webhook event dedupe identity and one delivery per event/subscription;
- unique delivery attempt number per delivery;
- conditional revision publish, delivery claim, moderation resolution, privacy
  processing, and financial finalization;
- transaction-scoped advisory locks for revision numbering/publish, final-admin
  safety, and canary admission.

Idempotency does not reclaim expired PROCESSING rows. Because a crash can happen
after the business transaction commits but before the response record completes,
the safe result is IDEMPOTENCY_INDETERMINATE rather than a duplicate mutation.

## Reconciliation cursor

chain_sync_state.id is escrow:<chainId>:<address>. Normal scans advance only when
starting at last_processed_block + 1. Retroactive/overlapping scans preserve the
normal cursor. Raw events persist before application and remain retryable when their
user, builder, or call is not yet available.

## Migrations

~~~text
0000_phase0_baseline.sql
0001_security_rbac.sql
0002_settlement_outbox.sql
0003_query_indexes.sql
0004_transaction_indexes.sql
0005_earnings_invariants.sql
0006_dark_darkstar.sql
0007_phase3_canary_admissions.sql
0008_phase4_platform.sql
~~~

Use:

~~~bash
npm --prefix server run db:check
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm run test:phase4-db
~~~

Fresh and upgrade tests verify 30 tables, 28 critical constraints, 27 critical
indexes, enum/order compatibility, balance preservation, new references, and
Phase 4 invariants. db:push is local prototyping only and must never replace
migrations on persistent data.

## Backup and restore

Use a custom-format pg_dump, restore into a clean database, then run:

~~~bash
SOURCE_DATABASE_URL=... RESTORED_DATABASE_URL=... npm --prefix server run restore:verify
~~~

The verifier compares all 30 tables, at least nine migrations, every row count,
financial/outbox/webhook aggregates, and critical constraints/indexes. Evidence
output is redacted and may include measured RPO/RTO when the timing variables are
provided.

Repository verification does not prove provider-native PITR. Managed encrypted
WAL/PITR, separation of duties, retention, and an actual RPO/RTO drill remain
activation prerequisites. See OPERATIONS.md.
