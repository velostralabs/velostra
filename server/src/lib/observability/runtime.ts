import { collectOperationalSnapshot } from './operations.js'
import { recordHeartbeat } from './heartbeats.js'
import { setOperationalSnapshot } from './metrics.js'
import { logger } from './logger.js'

export function startApiObservability(): () => void {
  const intervalMs = Number(process.env.OBSERVABILITY_INTERVAL_MS ?? 15_000)
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error('OBSERVABILITY_INTERVAL_MS must be an integer of at least 1000')
  }
  let stopped = false
  let running = false

  const collect = async () => {
    if (stopped || running) return
    running = true
    try {
      const snapshot = await collectOperationalSnapshot()
      setOperationalSnapshot(snapshot)
      const degraded = Object.values(snapshot.dependencies).some((check) => !check.ok)
      await recordHeartbeat('api', degraded ? 'degraded' : 'ok', {
        captured_at: snapshot.capturedAt,
      })
    } catch (error) {
      logger.error('observability_collection_failed', { error })
    } finally {
      running = false
    }
  }

  void collect()
  const timer = setInterval(() => void collect(), intervalMs)
  timer.unref()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
