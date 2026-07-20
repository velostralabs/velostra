import { ensureRedisConnected, failForRedisOutage, redisFailureMode } from '../redis.js'

function positiveLimit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

const RATE_LIMIT = positiveLimit('USER_RATE_LIMIT_PER_MINUTE', 100)
const WINDOW_SEC = 60
const AGENT_LIMIT = positiveLimit('AGENT_RATE_LIMIT_PER_MINUTE', 10)
const AGENT_WINDOW_SEC = 60
const GLOBAL_LIMIT = positiveLimit('GLOBAL_RATE_LIMIT_PER_MINUTE', 5000)
const GLOBAL_WINDOW_SEC = 60
const ACTION_LIMIT = positiveLimit('SENSITIVE_ACTION_RATE_LIMIT_PER_MINUTE', 10)
const PUBLIC_TESTNET_WALLET_DAILY_LIMIT = positiveLimit('PUBLIC_TESTNET_PAID_CALLS_PER_WALLET_DAY', 10)
const PUBLIC_TESTNET_GLOBAL_DAILY_LIMIT = positiveLimit('PUBLIC_TESTNET_PAID_CALLS_GLOBAL_DAY', 1000)

function onRedisFailure<T>(fallback: T, error: unknown): T {
  if (redisFailureMode() === 'closed') failForRedisOutage(error)
  console.warn('[ratelimit] Redis unavailable; development fail-open policy applied')
  return fallback
}

async function incrementWindow(key: string, ttlSeconds: number): Promise<number> {
  const redis = await ensureRedisConnected()
  const current = await redis.incr(key)
  if (current === 1) await redis.expire(key, ttlSeconds)
  return current
}

export async function checkRateLimit(userId: string): Promise<{
  allowed: boolean
  remaining: number
  resetIn: number
}> {
  const window = Math.floor(Date.now() / (WINDOW_SEC * 1000))
  const key = `ratelimit:user:${userId}:${window}`

  try {
    const current = await incrementWindow(key, WINDOW_SEC)
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
    const current = await incrementWindow(key, AGENT_WINDOW_SEC)
    return current <= AGENT_LIMIT
  } catch (error) {
    return onRedisFailure(true, error)
  }
}

export async function checkGlobalRateLimit(): Promise<boolean> {
  const window = Math.floor(Date.now() / (GLOBAL_WINDOW_SEC * 1000))
  const key = `ratelimit:global:${window}`
  try {
    const current = await incrementWindow(key, GLOBAL_WINDOW_SEC)
    return current <= GLOBAL_LIMIT
  } catch (error) {
    return onRedisFailure(true, error)
  }
}

export async function checkSensitiveActionRateLimit(
  userId: string,
  action: 'topup' | 'claim'
): Promise<boolean> {
  const window = Math.floor(Date.now() / (WINDOW_SEC * 1000))
  try {
    const current = await incrementWindow(`ratelimit:action:${action}:${userId}:${window}`, WINDOW_SEC)
    return current <= ACTION_LIMIT
  } catch (error) {
    return onRedisFailure(true, error)
  }
}

export async function checkPublicTestnetPaidCallLimit(userId: string): Promise<{
  allowed: boolean
  reason?: 'wallet' | 'global'
}> {
  if (
    process.env.VELOSTRA_ENVIRONMENT !== 'staging' ||
    process.env.PHASE3_PAID_WRITES_MODE !== 'public'
  ) return { allowed: true }

  const day = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(`${day}T00:00:00.000Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const ttlSeconds = Math.max(1, Math.ceil((tomorrow.getTime() - Date.now()) / 1000))

  try {
    const [walletCount, globalCount] = await Promise.all([
      incrementWindow(`ratelimit:testnet-paid:wallet:${userId}:${day}`, ttlSeconds),
      incrementWindow(`ratelimit:testnet-paid:global:${day}`, ttlSeconds),
    ])
    if (globalCount > PUBLIC_TESTNET_GLOBAL_DAILY_LIMIT) return { allowed: false, reason: 'global' }
    if (walletCount > PUBLIC_TESTNET_WALLET_DAILY_LIMIT) return { allowed: false, reason: 'wallet' }
    return { allowed: true }
  } catch (error) {
    return onRedisFailure({ allowed: true }, error)
  }
}
