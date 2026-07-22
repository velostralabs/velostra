import { collectOperationalSnapshot } from './operations.js'
import { recordHeartbeat } from './heartbeats.js'
import { setOperationalSnapshot } from './metrics.js'
import { logger } from './logger.js'

type ApiObservabilityRuntimeOptions = {
  collectSnapshot?: typeof collectOperationalSnapshot
  heartbeat?: typeof recordHeartbeat
  intervalMs?: number
}

export async function startApiObservability(
  options: ApiObservabilityRuntimeOptions = {}
): Promise<() => void> {
  const intervalMs = options.intervalMs ?? Number(process.env.OBSERVABILITY_INTERVAL_MS ?? 15_000)
  const collectSnapshot = options.collectSnapshot ?? collectOperationalSnapshot
  const heartbeat = options.heartbeat ?? recordHeartbeat
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error('OBSERVABILITY_INTERVAL_MS must be an integer of at least 1000')
  }
  let stopped = false
  let running = false

  const collect = async () => {
    if (stopped || running) return
    running = true
    try {
      const snapshot = await collectSnapshot()
      setOperationalSnapshot(snapshot)
      const degraded = Object.values(snapshot.dependencies).some((check) => !check.ok)
      await heartbeat('api', degraded ? 'degraded' : 'ok', {
        captured_at: snapshot.capturedAt,
      })
    } catch (error) {
      logger.error('observability_collection_failed', { error })
    } finally {
      running = false
    }
  }

  // Populate readiness before the HTTP server starts accepting traffic. Without
  // this await, a cold instance can briefly return snapshot=false even when every
  // managed dependency is healthy.
  await collect()
  const timer = setInterval(() => void collect(), intervalMs)
  timer.unref()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
