import { and, eq, gte, count } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { agentCalls, creditBalances } from '../../db/schema.js'
import { ensureRedisConnected } from '../redis.js'

const FREE_TIER_LIMIT = Number(process.env.FREE_TIER_CALLS_PER_MONTH ?? 10)
if (!Number.isInteger(FREE_TIER_LIMIT) || FREE_TIER_LIMIT < 0) {
  throw new Error('FREE_TIER_CALLS_PER_MONTH must be a non-negative integer')
}

function getCurrentMonthKey(userId: string): string {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return `freetier:${userId}:${month}`
}

function getSecondsUntilMonthEnd(): number {
  const now = new Date()
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return Math.max(1, Math.floor((endOfMonth.getTime() - now.getTime()) / 1000))
}

export async function getFreeTierUsed(userId: string): Promise<number> {
  const key = getCurrentMonthKey(userId)
  try {
    const redis = await ensureRedisConnected()
    const val = await redis.get(key)
    return val ? parseInt(val, 10) : 0
  } catch {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const [row] = await db
      .select({ value: count() })
      .from(agentCalls)
      .where(
        and(
          eq(agentCalls.user_id, userId),
          eq(agentCalls.is_free_tier, true),
          gte(agentCalls.created_at, startOfMonth)
        )
      )
    return row?.value ?? 0
  }
}

export async function hasFreeTierRemaining(userId: string): Promise<boolean> {
  const used = await getFreeTierUsed(userId)
  return used < FREE_TIER_LIMIT
}

export async function incrementFreeTier(userId: string): Promise<number> {
  const key = getCurrentMonthKey(userId)
  const redis = await ensureRedisConnected()
  const newVal = await redis.incr(key)
  if (newVal === 1) await redis.expire(key, getSecondsUntilMonthEnd())
  return newVal
}

export async function getFreeTierStatus(userId: string): Promise<{
  used: number
  remaining: number
  limit: number
  hasRemaining: boolean
}> {
  const used = await getFreeTierUsed(userId)
  return {
    used,
    remaining: Math.max(0, FREE_TIER_LIMIT - used),
    limit: FREE_TIER_LIMIT,
    hasRemaining: used < FREE_TIER_LIMIT,
  }
}

export async function hasSufficientCredits(userId: string, pricePerCall: number): Promise<boolean> {
  const [row] = await db
    .select({ balance_usd: creditBalances.balance_usd })
    .from(creditBalances)
    .where(eq(creditBalances.user_id, userId))
    .limit(1)
  return (row?.balance_usd ?? 0) >= pricePerCall
}

export async function getCreditBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance_usd: creditBalances.balance_usd })
    .from(creditBalances)
    .where(eq(creditBalances.user_id, userId))
    .limit(1)
  return row?.balance_usd ?? 0
}
