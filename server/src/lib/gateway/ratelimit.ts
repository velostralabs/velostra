import Redis from 'ioredis'

let redis: Redis | null = null
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
      retryStrategy: () => null, // don't keep retrying forever if Redis is down
    })
    redis.on('error', (err) => console.error('[redis] connection error:', err.message))
  }
  return redis
}

const RATE_LIMIT = 100 // requests per window, per user
const WINDOW_SEC = 60

/**
 * Rate limits fail OPEN, not closed: if Redis is unreachable, we allow the
 * request rather than blocking all platform traffic on a Redis outage. The
 * tradeoff (briefly unmetered traffic during an outage) is much safer than
 * the alternative (the whole marketplace going down whenever Redis hiccups).
 */
export async function checkRateLimit(userId: string): Promise<{
  allowed: boolean
  remaining: number
  resetIn: number
}> {
  const window = Math.floor(Date.now() / (WINDOW_SEC * 1000))
  const key = `ratelimit:user:${userId}:${window}`

  try {
    const current = await getRedis().incr(key)
    if (current === 1) await getRedis().expire(key, WINDOW_SEC)

    const remaining = Math.max(0, RATE_LIMIT - current)
    const resetIn = WINDOW_SEC - (Math.floor(Date.now() / 1000) % WINDOW_SEC)

    return { allowed: current <= RATE_LIMIT, remaining, resetIn }
  } catch {
    return { allowed: true, remaining: RATE_LIMIT, resetIn: WINDOW_SEC }
  }
}

const AGENT_LIMIT = 10 // per minute per agent
const AGENT_WINDOW_SEC = 60

export async function checkAgentRateLimit(userId: string, agentId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / (AGENT_WINDOW_SEC * 1000))
  const key = `ratelimit:agent:${userId}:${agentId}:${window}`

  try {
    const current = await getRedis().incr(key)
    if (current === 1) await getRedis().expire(key, AGENT_WINDOW_SEC)
    return current <= AGENT_LIMIT
  } catch {
    return true
  }
}

const GLOBAL_LIMIT = 5000 // requests per minute, platform-wide
const GLOBAL_WINDOW_SEC = 60

export async function checkGlobalRateLimit(): Promise<boolean> {
  const window = Math.floor(Date.now() / (GLOBAL_WINDOW_SEC * 1000))
  const key = `ratelimit:global:${window}`

  try {
    const current = await getRedis().incr(key)
    if (current === 1) await getRedis().expire(key, GLOBAL_WINDOW_SEC)
    return current <= GLOBAL_LIMIT
  } catch {
    return true
  }
}
