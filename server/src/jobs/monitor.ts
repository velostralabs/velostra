import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { pool } from '../db/client.js'
import { assertProductionConfiguration } from '../lib/config.js'
import { persistAndDispatchAlerts } from '../lib/observability/alerts.js'
import { recordHeartbeat } from '../lib/observability/heartbeats.js'
import { logger } from '../lib/observability/logger.js'
import { collectOperationalSnapshot } from '../lib/observability/operations.js'
import { closeRedis } from '../lib/redis.js'

const intervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? 30_000)
if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
  throw new Error('MONITOR_INTERVAL_MS must be an integer of at least 1000')
}

export async function runOperationalMonitor(): Promise<void> {
  const snapshot = await collectOperationalSnapshot()
  const alerts = await persistAndDispatchAlerts(snapshot)
  await recordHeartbeat('monitor', alerts.length > 0 ? 'degraded' : 'ok', {
    captured_at: snapshot.capturedAt,
    active_alerts: alerts.length,
  })
  logger.info('operational_monitor_complete', {
    capturedAt: snapshot.capturedAt,
    alertRules: alerts.map((alert) => alert.rule),
  })
}

async function main(): Promise<void> {
  assertProductionConfiguration()
  const watch = process.argv.includes('--watch')
  if (!watch) {
    await runOperationalMonitor()
    return
  }
  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  while (!stopping) {
    try {
      await runOperationalMonitor()
    } catch (error) {
      logger.error('operational_monitor_failed', { error })
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      logger.error('operational_monitor_fatal', { error })
      process.exitCode = 1
    })
    .finally(async () => {
      await closeRedis().catch(() => undefined)
      await pool.end().catch(() => undefined)
    })
}
