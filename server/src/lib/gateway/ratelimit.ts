import { ensureRedisConnected, failForRedisOutage, redisFailureMode } from '../redis.js'

const RATE_LIMIT = 100
const WINDOW_SEC = 60
const AGENT_LIMIT = 10
const AGENT_WINDOW_SEC = 60
const GLOBAL_LIMIT = 5000
const GLOBAL_WINDOW_SEC = 60

function onRedisFailure<T>(fallback: T, error: unknown): T {
  if (redisFailureMode() === 'closed') failForRedisOutage(error)
  console.warn('[ratelimit] Redis unavailable; development fail-open policy applied')
  return fallback
}

export async function checkRateLimit(userId: string): Promise<{
  allowed: boolean
  remaining: number
  resetIn: number
}> {
  const window = Math.floor(Date.now() / (WINDOW_SEC * 1000))
  const key = `ratelimit:user:${userId}:${window}`

  try {
    const redis = await ensureRedisConnected()
    const current = await redis.incr(key)
    if (current === 1) await redis.expire(key, WINDOW_SEC)
    return {
      allowed: current <= RATE_LIMIT,
      remaining: Math.max(0, RATE_LIMIT - current),
      resetIn: WINDOW_SEC - (Math.floor(Date.now() / 1000) % WINDOW_SEC),
    }
  } catch (error) {
    return onRedisFailure(
      { allowed: true, remaining: RATE_LIMIT, resetIn: WINDOW_SEC },
      error
    )
  }
}

export async function checkAgentRateLimit(userId: string, agentId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / (AGENT_WINDOW_SEC * 1000))
  const key = `ratelimit:agent:${userId}:${agentId}:${window}`
  try {
    const redis = await ensureRedisConnected()
    const current = await redis.incr(key)
    if (current === 1) await redis.expire(key, AGENT_WINDOW_SEC)
    return current <= AGENT_LIMIT
  } catch (error) {
    return onRedisFailure(true, error)
  }
}

export async function checkGlobalRateLimit(): Promise<boolean> {
  const window = Math.floor(Date.now() / (GLOBAL_WINDOW_SEC * 1000))
  const key = `ratelimit:global:${window}`
  try {
    const redis = await ensureRedisConnected()
    const current = await redis.incr(key)
    if (current === 1) await redis.expire(key, GLOBAL_WINDOW_SEC)
    return current <= GLOBAL_LIMIT
  } catch (error) {
    return onRedisFailure(true, error)
  }
}