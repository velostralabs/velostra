import assert from 'node:assert/strict'
import pg from 'pg'

const { Client } = pg
const sourceUrl = process.env.SOURCE_DATABASE_URL
const restoredUrl = process.env.RESTORED_DATABASE_URL
if (!sourceUrl || !restoredUrl) {
  throw new Error('SOURCE_DATABASE_URL and RESTORED_DATABASE_URL are required')
}
if (sourceUrl === restoredUrl) throw new Error('Restore verification requires two different databases')

const source = new Client({ connectionString: sourceUrl })
const restored = new Client({ connectionString: restoredUrl })
await Promise.all([source.connect(), restored.connect()])

async function rows(client: pg.Client, query: string, params: unknown[] = []) {
  return (await client.query(query, params)).rows
}

async function snapshot(client: pg.Client) {
  const tables = await rows(
    client,
    `select table_name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`
  )

  const rowCounts: Record<string, number> = {}
  for (const { table_name: table } of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected table name in restore drill')
    rowCounts[table] = Number((await rows(client, `select count(*)::int as count from "${table}"`))[0].count)
  }

  return {
    tables: tables.map((row) => row.table_name),
    rowCounts,
    migrations: await rows(
      client,
      'select hash, created_at from drizzle.__drizzle_migrations order by id'
    ),
    transactions: await rows(
      client,
      `select type, status, count(*)::int as count, coalesce(sum(amount), 0)::text as amount
         from transactions group by type, status order by type, status`
    ),
    claims: await rows(
      client,
      `select status, count(*)::int as count, coalesce(sum(amount), 0)::text as amount
         from earnings_claims group by status order by status`
    ),
    credits: await rows(
      client,
      `select count(*)::int as count,
              coalesce(sum(balance_usd), 0)::text as balance,
              coalesce(sum(reserved_usd), 0)::text as reserved
         from credit_balances`
    ),
    earnings: await rows(
      client,
      `select coalesce(sum(total_earned), 0)::text as earned,
              coalesce(sum(available), 0)::text as available,
              coalesce(sum(total_claimed), 0)::text as claimed
         from builder_earnings`
    ),
    calls: await rows(
      client,
      `select status, count(*)::int as count,
              coalesce(sum(price_charged), 0)::text as charged,
              coalesce(sum(builder_earned), 0)::text as builder,
              coalesce(sum(platform_earned), 0)::text as platform
         from agent_calls group by status order by status`
    ),
    attempts: await rows(
      client,
      `select status, count(*)::int as count,
              coalesce(sum(gross_amount), 0)::text as gross
         from settlement_attempts group by status order by status`
    ),
    constraints: await rows(
      client,
      `select conname, contype
         from pg_constraint c
         join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'public'
        order by conname`
    ),
    indexes: await rows(
      client,
      `select indexname, indexdef
         from pg_indexes
        where schemaname = 'public'
        order by indexname`
    ),
  }
}

try {
  const [before, after] = await Promise.all([snapshot(source), snapshot(restored)])
  assert.deepEqual(after, before)
  assert.equal(after.tables.length, 17)
  assert(after.migrations.length >= 5)
  assert(
    after.constraints.some((row) => row.conname === 'credit_reservation_within_balance')
  )
  assert(
    after.indexes.some((row) => row.indexname === 'settlement_attempt_status_updated_idx')
  )
  console.log('✅ table inventory and every row count match')
  console.log('✅ exact financial aggregates and settlement states match')
  console.log('✅ migration history, constraints, and operational indexes match')
  console.log('\n🎉 POSTGRES BACKUP RESTORE VERIFIED')
} finally {
  await Promise.all([source.end(), restored.end()])
}
