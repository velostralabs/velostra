import assert from 'node:assert/strict'
import http from 'node:http'
import { pool } from '../src/db/client.js'
import {
  acknowledgeAlert,
  persistAndDispatchAlerts,
} from '../src/lib/observability/alerts.js'
import {
  heartbeatAgeSeconds,
  recordHeartbeat,
} from '../src/lib/observability/heartbeats.js'
import type { OperationalSnapshot } from '../src/lib/observability/operations.js'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

let deliveries = 0
const webhook = http.createServer((request, response) => {
  request.resume()
  request.on('end', () => {
    deliveries += 1
    response.writeHead(204).end()
  })
})
await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', resolve))
const webhookAddress = webhook.address()
if (!webhookAddress || typeof webhookAddress === 'string') {
  throw new Error('Alert webhook failed to bind')
}

const healthy: OperationalSnapshot = {
  capturedAt: new Date().toISOString(),
  dependencies: {
    postgres: { ok: true, latencyMs: 1 },
    redis: { ok: true, latencyMs: 1 },
    rpc: { ok: true, latencyMs: 1 },
    contract: { ok: true, latencyMs: 1 },
    operational_state: { ok: true, latencyMs: 1 },
  },
  chain: { lagBlocks: 0n, pendingEvents: 0, solvent: true },
  outbox: { byStatus: {}, oldestRecoverableAgeSeconds: 0 },
  webhooks: { byStatus: {}, oldestPendingAgeSeconds: 0 },
  drift: { available: true, exceedsThreshold: false, values: {} },
  signer: { balanceWei: 20_000_000_000_000_000n },
  worker: { ageSeconds: 1 },
  webhookWorker: { ageSeconds: 1 },
  backup: { ageSeconds: 1 },
}
const drifted: OperationalSnapshot = {
  ...healthy,
  drift: {
    available: true,
    exceedsThreshold: true,
    values: { earnings: '1.000000' },
  },
}

const original = {
  NODE_ENV: process.env.NODE_ENV,
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
  ALERT_WEBHOOK_TOKEN: process.env.ALERT_WEBHOOK_TOKEN,
  ALERT_REQUIRE_BACKUP_HEARTBEAT: process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT,
  ALERT_REPEAT_SECONDS: process.env.ALERT_REPEAT_SECONDS,
}

try {
  process.env.NODE_ENV = 'test'
  process.env.ALERT_WEBHOOK_URL =
    'http://127.0.0.1:' + webhookAddress.port + '/alerts'
  process.env.ALERT_WEBHOOK_TOKEN = 'test-alert-token-that-is-long-enough'
  process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT = 'false'
  process.env.ALERT_REPEAT_SECONDS = '1800'
  await pool.query('delete from operational_alerts')
  await pool.query("delete from operational_heartbeats where service_name = 'backup-test'")

  await persistAndDispatchAlerts(drifted)
  await persistAndDispatchAlerts(drifted)
  const open = await pool.query<{
    id: string
    fingerprint: string
    status: string
    occurrences: number
  }>(
    `select id, fingerprint, status, occurrences
     from operational_alerts where rule = 'financial_drift'`
  )
  assert.equal(open.rowCount, 1)
  assert.equal(open.rows[0]?.status, 'OPEN')
  assert.equal(Number(open.rows[0]?.occurrences), 2)
  assert.equal(deliveries, 1, 'repeat delivery is deduplicated')

  assert.equal(
    await acknowledgeAlert(open.rows[0]!.fingerprint, 'phase2-test-operator'),
    true
  )
  await persistAndDispatchAlerts(drifted)
  assert.equal(deliveries, 1, 'acknowledged alert is not redelivered')

  await persistAndDispatchAlerts(healthy)
  const resolved = await pool.query<{ status: string; acknowledged_by: string }>(
    'select status, acknowledged_by from operational_alerts where id = $1',
    [open.rows[0]!.id]
  )
  assert.equal(resolved.rows[0]?.status, 'RESOLVED')
  assert.equal(resolved.rows[0]?.acknowledged_by, 'phase2-test-operator')

  await persistAndDispatchAlerts(drifted)
  const reopened = await pool.query<{
    status: string
    acknowledged_at: Date | null
    acknowledged_by: string | null
  }>(
    'select status, acknowledged_at, acknowledged_by from operational_alerts where id = $1',
    [open.rows[0]!.id]
  )
  assert.equal(reopened.rows[0]?.status, 'OPEN')
  assert.equal(reopened.rows[0]?.acknowledged_at, null)
  assert.equal(reopened.rows[0]?.acknowledged_by, null)
  assert.equal(deliveries, 2, 'resolved alert reopens with a fresh notification lifecycle')

  await recordHeartbeat('backup-test', 'ok', { source: 'test' })
  const heartbeatAge = await heartbeatAgeSeconds('backup-test')
  assert(heartbeatAge !== undefined && heartbeatAge < 5)

  console.log('DURABLE ALERT DEDUPE, ACKNOWLEDGEMENT, RESOLUTION, AND HEARTBEAT VERIFIED')
} finally {
  await pool.query('delete from operational_alerts').catch(() => undefined)
  await pool
    .query("delete from operational_heartbeats where service_name = 'backup-test'")
    .catch(() => undefined)
  await new Promise<void>((resolve, reject) =>
    webhook.close((error) => (error ? reject(error) : resolve()))
  )
  await pool.end()
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
