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

  await apply(client, upgradeSchema, migrations.slice(2))
  const upgraded = await client.query(
    'select balance_usd, reserved_usd from credit_balances where id = $1',
    ['upgrade-balance']
  )
  assert.equal(upgraded.rows[0].balance_usd, '7.123456')
  assert.equal(upgraded.rows[0].reserved_usd, '0.000000')
  console.log('✅ upgrade migration preserves exact balances and initializes reservations')

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
  assert.equal(tableCount.rows[0].count, 17)
  console.log('✅ fresh install creates the complete Phase 1 schema')

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
          'earnings_claim_amount_positive'
        )`,
    [freshSchema]
  )
  assert.equal(constraints.rowCount, 8)
  console.log('✅ fresh install includes all critical money invariants')

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
          'transaction_chain_ledger_idx'
        )`,
    [freshSchema]
  )
  assert.equal(operationalIndexes.rowCount, 7)
  console.log('✅ operational history, pending-work, and ledger indexes are installed')

} finally {
  await client.query('set search_path to public')
  await client.query('drop schema if exists "' + upgradeSchema + '" cascade')
  await client.query('drop schema if exists "' + freshSchema + '" cascade')
  await client.end()
}

console.log('\n🎉 FRESH AND UPGRADE MIGRATION PATHS VERIFIED')
