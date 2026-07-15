import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL must point to a disposable Postgres database')

const migrations = [
  'drizzle/0000_phase0_baseline.sql',
  'drizzle/0001_security_rbac.sql',
  'drizzle/0002_settlement_outbox.sql',
  'drizzle/0003_query_indexes.sql',
  'drizzle/0004_transaction_indexes.sql',
  'drizzle/0005_earnings_invariants.sql',
  'drizzle/0006_dark_darkstar.sql',
  'drizzle/0007_phase3_canary_admissions.sql',
  'drizzle/0008_phase4_platform.sql',
]

async function loadMigration(path: string, schema: string): Promise<string[]> {
  const sql = await readFile(new URL('../' + path, import.meta.url), 'utf8')
  return sql
    .replaceAll('"public"', '"' + schema + '"')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

async function apply(client: pg.Client, schema: string, paths: string[]) {
  await client.query('set search_path to "' + schema + '"')
  for (const path of paths) {
    for (const statement of await loadMigration(path, schema)) {
      await client.query(statement)
    }
  }
}

const suffix = Date.now().toString(36)
const upgradeSchema = 'phase1_upgrade_' + suffix
const freshSchema = 'phase1_fresh_' + suffix
const client = new Client({ connectionString: databaseUrl })
await client.connect()

try {
  await client.query('create schema "' + upgradeSchema + '"')
  await apply(client, upgradeSchema, migrations.slice(0, 2))
  await client.query(
    'insert into users (id, wallet_address) values ($1, $2)',
    ['upgrade-user', '0x0000000000000000000000000000000000000001']
  )
  await client.query(
    'insert into credit_balances (id, user_id, balance_usd) values ($1, $2, $3)',
    ['upgrade-balance', 'upgrade-user', '7.123456']
  )

  await client.query(
    'insert into builders (id, user_id, wallet_address, display_name) values ($1, $2, $3, $4)',
    ['upgrade-builder', 'upgrade-user', '0x0000000000000000000000000000000000000001', 'Upgrade Builder']
  )
  await client.query(
    `insert into agents
       (id, builder_id, name, slug, description, category, endpoint_url, secret_key,
        price_per_call, price_tier)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      'upgrade-agent',
      'upgrade-builder',
      'Upgrade Agent',
      'upgrade-agent',
      'Agent preserved across the Phase 4 upgrade.',
      'OTHER',
      'https://agent.example.test/run',
      'legacy-encrypted-secret',
      '0.200000',
      'BASIC',
    ]
  )
  await apply(client, upgradeSchema, migrations.slice(2))
  const upgraded = await client.query(
    'select balance_usd, reserved_usd from credit_balances where id = $1',
    ['upgrade-balance']
  )
  assert.equal(upgraded.rows[0].balance_usd, '7.123456')
  assert.equal(upgraded.rows[0].reserved_usd, '0.000000')
  console.log('✅ upgrade migration preserves exact balances and initializes reservations')

  const upgradedRevision = await client.query(
    `select a.active_revision_id, r.revision_number, r.status, r.name
       from agents a
       join agent_revisions r on r.id = a.active_revision_id
      where a.id = $1`,
    ['upgrade-agent']
  )
  assert.equal(upgradedRevision.rows[0].revision_number, 1)
  assert.equal(upgradedRevision.rows[0].status, 'PUBLISHED')
  assert.equal(upgradedRevision.rows[0].name, 'Upgrade Agent')
  await assert.rejects(
    client.query(
      `update agent_revisions set name = 'Mutated' where id = $1`,
      [upgradedRevision.rows[0].active_revision_id]
    ),
    /published agent revisions are immutable/
  )
  console.log('✅ Phase 4 upgrade backfills and protects the immutable active revision')
  const enumValues = await client.query(
    `select enumlabel
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = $1 and t.typname = 'settlement_status'
      order by e.enumsortorder`,
    [upgradeSchema]
  )
  assert.deepEqual(
    enumValues.rows.map((row) => row.enumlabel),
    ['PREPARED', 'READY', 'SUBMITTED', 'AMBIGUOUS', 'CONFIRMED', 'APPLIED', 'FAILED']
  )
  console.log('✅ settlement state machine is installed in deterministic order')

  await assert.rejects(
    client.query(
      'update credit_balances set reserved_usd = balance_usd + 0.000001 where id = $1',
      ['upgrade-balance']
    ),
    /credit_reservation_within_balance/
  )
  console.log('✅ database rejects reservations larger than the user balance')

  await client.query('create schema "' + freshSchema + '"')
  await apply(client, freshSchema, migrations)
  const tableCount = await client.query(
    `select count(*)::int as count
       from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE'`,
    [freshSchema]
  )
  assert.equal(tableCount.rows[0].count, 30)
  console.log('✅ fresh install creates the complete Phase 4 platform schema')

  const constraints = await client.query(
    `select conname
       from pg_constraint c
       join pg_namespace n on n.oid = c.connamespace
      where n.nspname = $1
        and conname in (
          'credit_balance_nonnegative',
          'credit_reservation_nonnegative',
          'credit_reservation_within_balance',
          'settlement_amounts_balance',
          'builder_earnings_total_nonnegative',
          'builder_earnings_available_nonnegative',
          'builder_earnings_claimed_nonnegative',
          'earnings_claim_amount_positive',
          'operational_heartbeat_status_check',
          'operational_alert_severity_check',
          'operational_alert_occurrences_positive',
          'release_canary_release_check',
          'release_canary_manifest_hash_check',
          'release_canary_policy_hash_check',
          'release_canary_gross_positive',
          'release_canary_status_check',
          'api_idempotency_key_length_check',
          'api_idempotency_request_hash_check',
          'agent_revision_number_positive',
          'agent_revision_price_positive',
          'webhook_subscription_event_types_check',
          'webhook_delivery_attempt_count_check',
          'webhook_attempt_number_positive',
          'webhook_attempt_duration_nonnegative',
          'telemetry_retention_nonnegative',
          'telemetry_prohibited_disabled',
          'report_description_length_check',
          'report_evidence_object_check'
        )`,
    [freshSchema]
  )
  assert.equal(constraints.rowCount, 28)
  console.log('✅ fresh install includes financial and Phase 4 platform invariants')

  await client.query(
    'insert into users (id, wallet_address) values ($1, $2)',
    ['constraint-user', '0x0000000000000000000000000000000000000002']
  )
  await client.query(
    'insert into builders (id, user_id, wallet_address, display_name) values ($1, $2, $3, $4)',
    [
      'constraint-builder',
      'constraint-user',
      '0x0000000000000000000000000000000000000002',
      'Constraint Builder',
    ]
  )
  await assert.rejects(
    client.query(
      'insert into builder_earnings (id, builder_id, available) values ($1, $2, $3)',
      ['negative-earnings', 'constraint-builder', '-0.000001']
    ),
    /builder_earnings_available_nonnegative/
  )
  await assert.rejects(
    client.query(
      'insert into earnings_claims (id, builder_id, amount, wallet_address) values ($1, $2, $3, $4)',
      [
        'zero-claim',
        'constraint-builder',
        '0.000000',
        '0x0000000000000000000000000000000000000002',
      ]
    ),
    /earnings_claim_amount_positive/
  )
  console.log('✅ database rejects negative earnings and non-positive claims')
  const operationalIndexes = await client.query(
    `select indexname
       from pg_indexes
      where schemaname = $1
        and indexname in (
          'agent_call_user_created_idx',
          'agent_call_status_created_idx',
          'agent_marketplace_idx',
          'earnings_claim_status_created_idx',
          'report_status_created_idx',
          'settlement_attempt_status_updated_idx',
          'transaction_chain_ledger_idx',
          'operational_heartbeat_seen_idx',
          'operational_alert_status_seen_idx',
          'operational_alert_rule_seen_idx',
          'release_canary_release_policy_idx',
          'release_canary_wallet_idx',
          'release_canary_status_updated_idx',
          'agent_revision_number_unique',
          'agent_revision_status_created_idx',
          'api_idempotency_actor_operation_key_unique',
          'api_idempotency_expiry_idx',
          'moderation_action_report_created_idx',
          'privacy_request_user_created_idx',
          'privacy_request_status_created_idx',
          'notification_user_created_idx',
          'webhook_delivery_event_subscription_unique',
          'webhook_delivery_ready_idx',
          'webhook_attempt_delivery_number_unique',
          'webhook_attempt_created_idx',
          'webhook_event_created_idx',
          'webhook_subscription_builder_status_idx'
        )`,
    [freshSchema]
  )
  assert.equal(operationalIndexes.rowCount, 27)
  console.log('PASS: operational and Phase 4 platform indexes are installed')

  const operationalTimestamps = await client.query(
    `select data_type
       from information_schema.columns
      where table_schema = $1
        and table_name in ('operational_alerts', 'operational_heartbeats')
        and column_name in ('first_seen_at', 'last_seen_at', 'last_notified_at',
                            'acknowledged_at', 'resolved_at', 'created_at', 'updated_at')`,
    [freshSchema]
  )
  assert(
    operationalTimestamps.rows.length > 0 &&
      operationalTimestamps.rows.every((row) => row.data_type === 'timestamp with time zone')
  )
  console.log('PASS: operational alert and heartbeat clocks are timezone-safe')

} finally {
  await client.query('set search_path to public')
  await client.query('drop schema if exists "' + upgradeSchema + '" cascade')
  await client.query('drop schema if exists "' + freshSchema + '" cascade')
  await client.end()
}

console.log('\n🎉 FRESH AND UPGRADE MIGRATION PATHS VERIFIED')
