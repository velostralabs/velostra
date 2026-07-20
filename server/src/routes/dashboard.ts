import { Router } from 'express'
import { z } from 'zod'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { creditBalances, agentCalls, agents, transactions } from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'
import { getFreeTierStatus } from '../lib/gateway/quota.js'
import { MIN_TOPUP_USD } from '../lib/constants.js'
import {
  getVelostraEscrowAddress,
  OnchainVerificationError,
  velostraChainId,
  verifyDepositTransaction,
} from '../lib/gateway/onchain.js'
import { compareMoney, money, moneyToNumber } from '../lib/money.js'
import { phase3PaidWriteMode } from '../lib/phase3-canary.js'
import { checkSensitiveActionRateLimit } from '../lib/gateway/ratelimit.js'

export const dashboardRouter = Router()

dashboardRouter.use(requireAuth)

// GET /api/dashboard - summary


dashboardRouter.get('/', async (req, res) => {
  const userId = req.auth!.id

  const [[balance], freeTier, recentCalls] = await Promise.all([
    db.select().from(creditBalances).where(eq(creditBalances.user_id, userId)).limit(1),
    getFreeTierStatus(userId),
    db
      .select({
        id: agentCalls.id,
        status: agentCalls.status,
        price_charged: agentCalls.price_charged,
        is_free_tier: agentCalls.is_free_tier,
        created_at: agentCalls.created_at,
        agent_name: agents.name,
        agent_slug: agents.slug,
        agent_logo_url: agents.logo_url,
      })
      .from(agentCalls)
      .innerJoin(agents, eq(agentCalls.agent_id, agents.id))
      .where(eq(agentCalls.user_id, userId))
      .orderBy(desc(agentCalls.created_at))
      .limit(20),
  ])

  res.json({
    balance_usd: moneyToNumber(balance?.balance_usd ?? '0'),
    free_tier: freeTier,
    recent_calls: recentCalls.map((c) => ({
      ...c,
      price_charged: moneyToNumber(c.price_charged),
      agent: { name: c.agent_name, slug: c.agent_slug, logo_url: c.agent_logo_url },
    })),
  })
})

// POST /api/dashboard/topup - record a confirmed onchain deposit


// The user calls `depositCredits(amount)` on VelostraEscrow.sol directly
// from their wallet. Once that transaction confirms on Robinhood Chain,
// the client reports the tx_hash + amount here to keep the off-chain
// credit ledger in sync.

const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const topupSchema = z.object({
  amount_usd: z.number().min(MIN_TOPUP_USD),
  tx_hash: txHashSchema,
})

dashboardRouter.post('/topup', async (req, res) => {
  const parsed = topupSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: `Minimum top-up is $${MIN_TOPUP_USD}`, code: 'INVALID_TOPUP_AMOUNT' })

  const userId = req.auth!.id
  if (!(await checkSensitiveActionRateLimit(userId, 'topup'))) {
    return res.status(429).json({ error: 'Too many top-up checks; try again shortly', code: 'TOPUP_RATE_LIMITED' })
  }

  const amount = money(parsed.data.amount_usd)
  const publicTestnetTopupCap = money(process.env.PUBLIC_TESTNET_MAX_TOPUP_USD ?? '100')
  if (
    process.env.VELOSTRA_ENVIRONMENT === 'staging' &&
    phase3PaidWriteMode('staging') === 'public' &&
    compareMoney(amount, publicTestnetTopupCap) > 0
  ) {
    return res.status(400).json({
      error: `Public testnet top-ups are capped at ${moneyToNumber(publicTestnetTopupCap)} synthetic USDG per transaction`,
      code: 'PUBLIC_TESTNET_TOPUP_CAP',
    })
  }
  if (compareMoney(amount, MIN_TOPUP_USD) < 0) {
    return res.status(400).json({ error: `Minimum top-up is $${MIN_TOPUP_USD}`, code: 'INVALID_TOPUP_AMOUNT' })
  }
  const hash = parsed.data.tx_hash as `0x${string}`

  const [replayed] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.tx_hash, hash))
    .limit(1)
  if (replayed) return res.status(409).json({ error: 'Transaction hash has already been credited', code: 'TOPUP_REPLAYED' })

  let depositBlockNumber: bigint | undefined
  try {
    const receipt = await verifyDepositTransaction(
      hash,
      req.auth!.wallet_address as `0x${string}`,
      amount
    )
    depositBlockNumber = receipt.blockNumber
  } catch (error) {
    const message =
      error instanceof OnchainVerificationError ? error.message : 'Unable to verify deposit onchain'
    return res.status(400).json({ error: message, code: 'TOPUP_VERIFICATION_FAILED' })
  }

  try {
    const balance = await db.transaction(async (tx) => {
      const [alreadyUsed] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.tx_hash, hash))
        .limit(1)
      if (alreadyUsed) {
        const error = new Error('Transaction hash has already been credited')
        error.name = 'ReplayError'
        throw error
      }

      const [updatedBalance] = await tx
        .insert(creditBalances)
        .values({ user_id: userId, balance_usd: amount })
        .onConflictDoUpdate({
          target: creditBalances.user_id,
          set: {
            balance_usd: sql`${creditBalances.balance_usd} + ${amount}`,
            updated_at: new Date(),
          },
        })
        .returning()

      await tx.insert(transactions).values({
        credit_balance_id: updatedBalance.id,
        type: 'TOPUP',
        amount,
        currency: 'USDG',
        tx_hash: hash,
        wallet_address: req.auth!.wallet_address,
        chain_id: velostraChainId,
        contract_address: getVelostraEscrowAddress(),
        event_name: 'Deposit',
        block_number: depositBlockNumber,
        status: 'CONFIRMED',
        confirmed_at: new Date(),
      })

      return updatedBalance
    })

    res.json({ balance_usd: moneyToNumber(balance.balance_usd) })
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if ((error instanceof Error && error.name === 'ReplayError') || code === '23505') {
      return res.status(409).json({ error: 'Transaction hash has already been credited', code: 'TOPUP_REPLAYED' })
    }
    throw error
  }
})
