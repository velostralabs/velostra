import { Router } from 'express'
import { z } from 'zod'
import { and, desc, asc, eq, ilike, avg, count, gte, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../db/client.js'
import {
  agents,
  agentTags,
  builders,
  reviews,
  agentCategoryEnum,
  agentCalls,
  creditBalances,
  builderEarnings,
  transactions,
} from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'
import { buildGatewayHeaders } from '../lib/gateway/hmac.js'
import { AgentEndpointError, safeFetchAgent } from '../lib/gateway/ssrf.js'
import { decryptAgentSecret, omitAgentSecret } from '../lib/gateway/secrets.js'
import { checkRateLimit, checkAgentRateLimit, checkGlobalRateLimit } from '../lib/gateway/ratelimit.js'
import { hasFreeTierRemaining, hasSufficientCredits, incrementFreeTier } from '../lib/gateway/quota.js'
import { BUILDER_SHARE_BPS, PLATFORM_FEE_BPS } from '../lib/constants.js'
import {
  creditBuilderEarningsOnchain,
  getVelostraEscrowAddress,
  hashAgentCallId,
  velostraChainId,
} from '../lib/gateway/onchain.js'

export const agentsRouter = Router()

// ─────────────────────────────────────────
// GET /api/agents — browse marketplace
// ─────────────────────────────────────────

agentsRouter.get('/', async (req, res) => {
  const { category, sort, q } = req.query as { category?: string; sort?: string; q?: string }

  const conditions = [eq(agents.status, 'APPROVED')]
  if (category && (agentCategoryEnum.enumValues as readonly string[]).includes(category)) {
    conditions.push(eq(agents.category, category as (typeof agentCategoryEnum.enumValues)[number]))
  }
  if (q) conditions.push(ilike(agents.name, `%${q}%`))

  const orderBy =
    sort === 'popular' ? desc(agents.total_calls) : sort === 'price' ? asc(agents.price_per_call) : desc(agents.featured)

  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      description: agents.description,
      category: agents.category,
      price_per_call: agents.price_per_call,
      price_tier: agents.price_tier,
      logo_url: agents.logo_url,
      total_calls: agents.total_calls,
      avg_rating: agents.avg_rating,
      builder_name: builders.display_name,
      builder_verified: builders.verified,
    })
    .from(agents)
    .innerJoin(builders, eq(agents.builder_id, builders.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(60)

  const list = rows.map((r) => ({
    ...r,
    builder: { display_name: r.builder_name, verified: r.builder_verified },
  }))

  res.json({ agents: list })
})

// ─────────────────────────────────────────
// GET /api/agents/:slug
// ─────────────────────────────────────────

agentsRouter.get('/:slug', async (req, res) => {
  const [agent] = await db.select().from(agents).where(eq(agents.slug, req.params.slug)).limit(1)
  if (!agent || agent.status !== 'APPROVED') return res.status(404).json({ error: 'Agent not found' })

  const [builder] = await db.select().from(builders).where(eq(builders.id, agent.builder_id)).limit(1)
  const tags = await db.select().from(agentTags).where(eq(agentTags.agent_id, agent.id))
  const agentReviews = await db
    .select()
    .from(reviews)
    .where(eq(reviews.agent_id, agent.id))
    .orderBy(desc(reviews.created_at))
    .limit(10)

  res.json({
    agent: {
      ...omitAgentSecret(agent),
      builder: builder
        ? { display_name: builder.display_name, verified: builder.verified, bio: builder.bio }
        : null,
      tags,
      reviews: agentReviews,
    },
  })
})

// ─────────────────────────────────────────
// POST /api/agents/:slug/run — execute an agent call
// ─────────────────────────────────────────

const runSchema = z.object({ input: z.string().min(1).max(10_000) })

agentsRouter.post('/:slug/run', requireAuth, async (req, res) => {
  const parsed = runSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'input is required' })

  const userId = req.auth!.id

  if (!(await checkGlobalRateLimit())) {
    return res.status(429).json({ error: 'Platform is busy, try again shortly' })
  }

  const { allowed } = await checkRateLimit(userId)
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded, try again in a minute' })
  }

  const [agent] = await db.select().from(agents).where(eq(agents.slug, req.params.slug)).limit(1)
  if (!agent || agent.status !== 'APPROVED') {
    return res.status(404).json({ error: 'Agent not found' })
  }

  if (!(await checkAgentRateLimit(userId, agent.id))) {
    return res.status(429).json({ error: 'Too many calls to this agent, slow down' })
  }

  const isFreeTier = await hasFreeTierRemaining(userId)
  if (!isFreeTier && !(await hasSufficientCredits(userId, agent.price_per_call))) {
    return res.status(402).json({ error: 'Insufficient credits - top up to keep using this agent' })
  }

  const [builder] = await db
    .select({ wallet_address: builders.wallet_address })
    .from(builders)
    .where(eq(builders.id, agent.builder_id))
    .limit(1)
  if (!builder) return res.status(500).json({ error: 'Agent builder profile is missing' })

  const callId = createId()
  const onchainCallId = isFreeTier ? null : hashAgentCallId(callId)
  const body = JSON.stringify({ input: parsed.data.input, user_id: userId, call_id: callId })
  if (agent.secret_revoked_at) {
    return res.status(409).json({
      error: 'Agent gateway secret has been revoked by its builder',
      code: 'AGENT_SECRET_REVOKED',
    })
  }
  const headers = buildGatewayHeaders(
    body,
    agent.id,
    decryptAgentSecret(agent.secret_key_ciphertext)
  )
  const platformCut = Number(
    ((agent.price_per_call * PLATFORM_FEE_BPS) / 10_000).toFixed(6)
  )
  const builderCut = Number(
    ((agent.price_per_call * BUILDER_SHARE_BPS) / 10_000).toFixed(6)
  )

  let durableCallCreated = false
  let settlementTxHash: string | null = null

  try {
    // This intent must commit before any external side effect. If the API dies
    // after the chain receipt, the reconciliation worker can still find the
    // exact call through onchain_call_id.
    await db.insert(agentCalls).values({
      id: callId,
      agent_id: agent.id,
      user_id: userId,
      input: parsed.data.input,
      status: 'PROCESSING',
      is_free_tier: isFreeTier,
      onchain_call_id: onchainCallId,
    })
    durableCallCreated = true

    const result = await db.transaction(async (tx) => {
      if (!isFreeTier) {
        const [lockedBalance] = await tx
          .select({ balance_usd: creditBalances.balance_usd })
          .from(creditBalances)
          .where(eq(creditBalances.user_id, userId))
          .for('update')
          .limit(1)

        if (!lockedBalance || lockedBalance.balance_usd < agent.price_per_call) {
          const error = new Error('Insufficient credits')
          error.name = 'InsufficientCreditsError'
          throw error
        }
      }

      const started = Date.now()
      const upstream = await safeFetchAgent(agent.endpoint_url, {
        method: 'POST',
        headers,
        body,
      })
      const rawOutput = upstream.text
      let output: unknown = rawOutput
      try {
        output = rawOutput ? JSON.parse(rawOutput) : null
      } catch {
        // Plain-text agent responses are valid output too.
      }
      if (!upstream.ok) {
        const error = new Error(`Agent endpoint returned HTTP ${upstream.status}`)
        error.name = 'UpstreamAgentError'
        throw error
      }

      const executionMs = Date.now() - started

      // Persist the successful upstream result independently of the settlement
      // transaction. A later onchain-confirmed/DB-rollback recovery therefore
      // keeps the actual agent output instead of only repairing money totals.
      await db
        .update(agentCalls)
        .set({ output, execution_ms: executionMs, error_message: null })
        .where(eq(agentCalls.id, callId))

      if (!isFreeTier) {
        settlementTxHash = await creditBuilderEarningsOnchain(
          builder.wallet_address as `0x${string}`,
          agent.price_per_call,
          onchainCallId!
        )

        if (
          process.env.NODE_ENV === 'test' &&
          process.env.RECONCILE_TEST_FAIL_AFTER_SETTLEMENT_INPUT === parsed.data.input
        ) {
          const error = new Error('Injected failure after onchain settlement')
          error.name = 'PostSettlementTestError'
          throw error
        }

        if (
          process.env.NODE_ENV === 'test' &&
          process.env.RECONCILE_TEST_PAUSE_AFTER_SETTLEMENT_INPUT === parsed.data.input
        ) {
          const pauseMs = Number(
            process.env.RECONCILE_TEST_PAUSE_AFTER_SETTLEMENT_MS ?? 0
          )
          if (Number.isFinite(pauseMs) && pauseMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, pauseMs))
          }
        }
      }

      // Atomically claim finalization. The live path and reconciliation worker
      // use the same PROCESSING -> SUCCESS guard, so exactly one transaction
      // owns every ledger/stat side effect for this call.
      const [wonFinalization] = await tx
        .update(agentCalls)
        .set({
          status: 'SUCCESS',
          output,
          execution_ms: executionMs,
          price_charged: isFreeTier ? 0 : agent.price_per_call,
          builder_earned: isFreeTier ? 0 : builderCut,
          platform_earned: isFreeTier ? 0 : platformCut,
          error_message: null,
          completed_at: new Date(),
        })
        .where(and(eq(agentCalls.id, callId), eq(agentCalls.status, 'PROCESSING')))
        .returning({ id: agentCalls.id })

      const wonCallFinalization = Boolean(wonFinalization)
      let shouldApplyPaidLedger = wonCallFinalization && !isFreeTier

      if (!wonCallFinalization) {
        console.info('[agent-call] call already finalized; live path no-op', { callId })
      }

      if (!isFreeTier && settlementTxHash) {
        if (wonCallFinalization) {
          const [insertedSettlement] = await tx
            .insert(transactions)
            .values({
              agent_call_id: callId,
              type: 'AGENT_CALL',
              amount: agent.price_per_call,
              currency: 'USDG',
              tx_hash: settlementTxHash,
              wallet_address: builder.wallet_address,
              chain_id: velostraChainId,
              contract_address: getVelostraEscrowAddress(),
              event_name: 'EarningsCredited',
              status: 'CONFIRMED',
              confirmed_at: new Date(),
            })
            .onConflictDoNothing({ target: transactions.tx_hash })
            .returning({ id: transactions.id })

          shouldApplyPaidLedger = Boolean(insertedSettlement)
          if (!insertedSettlement) {
            await tx
              .update(transactions)
              .set({ agent_call_id: callId })
              .where(eq(transactions.tx_hash, settlementTxHash))
          }
        } else {
          await tx
            .update(transactions)
            .set({ agent_call_id: callId })
            .where(eq(transactions.tx_hash, settlementTxHash))
        }
      }

      if (shouldApplyPaidLedger) {
          const [deducted] = await tx
            .update(creditBalances)
            .set({
              balance_usd: sql`${creditBalances.balance_usd} - ${agent.price_per_call}`,
              updated_at: new Date(),
            })
            .where(
              and(
                eq(creditBalances.user_id, userId),
                gte(creditBalances.balance_usd, agent.price_per_call)
              )
            )
            .returning({ balance_usd: creditBalances.balance_usd })
          if (!deducted) {
            const error = new Error('Insufficient credits')
            error.name = 'InsufficientCreditsError'
            throw error
          }

          const [credited] = await tx
            .update(builderEarnings)
            .set({
              available: sql`${builderEarnings.available} + ${builderCut}`,
              total_earned: sql`${builderEarnings.total_earned} + ${builderCut}`,
              updated_at: new Date(),
            })
            .where(eq(builderEarnings.builder_id, agent.builder_id))
            .returning({ id: builderEarnings.id })
          if (!credited) throw new Error('Builder earnings record is missing')
      }

      if (wonCallFinalization && (isFreeTier || shouldApplyPaidLedger)) {
        await tx
          .update(agents)
          .set({
            total_calls: sql`${agents.total_calls} + 1`,
            total_revenue: sql`${agents.total_revenue} + ${isFreeTier ? 0 : agent.price_per_call}`,
            updated_at: new Date(),
          })
          .where(eq(agents.id, agent.id))
      }

      return { output, executionMs }
    })

    if (isFreeTier) {
      try {
        await incrementFreeTier(userId)
      } catch (error) {
        console.error('[free-tier] Redis increment failed; Postgres fallback remains authoritative', error)
      }
    }

    res.json({
      call_id: callId,
      output: result.output,
      execution_ms: result.executionMs,
      is_free_tier: isFreeTier,
      settlement_tx_hash: settlementTxHash,
    })
  } catch (err) {
    if (durableCallCreated && !settlementTxHash) {
      try {
        await db
          .update(agentCalls)
          .set({
            status: 'FAILED',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            completed_at: new Date(),
          })
          .where(and(eq(agentCalls.id, callId), eq(agentCalls.status, 'PROCESSING')))
      } catch (recordError) {
        console.error('[agent-call] failed to update failed call', recordError)
      }
    }

    if (settlementTxHash) {
      console.error(
        '[agent-call] settlement confirmed but DB commit failed; reconciliation pending',
        { callId, onchainCallId, settlementTxHash, error: err }
      )
      return res.status(503).json({
        error: 'Settlement confirmed; call reconciliation is pending',
        call_id: callId,
        settlement_tx_hash: settlementTxHash,
        reconciliation_pending: true,
      })
    }

    if (err instanceof Error && err.name === 'InsufficientCreditsError') {
      return res.status(402).json({ error: 'Insufficient credits - top up to keep using this agent' })
    }

    const message =
      err instanceof AgentEndpointError ||
      (err instanceof Error && err.name === 'UpstreamAgentError')
        ? 'Agent endpoint failed to respond safely'
        : 'Onchain settlement failed; the call was not charged'
    res.status(502).json({ error: message })
  }
})

// ─────────────────────────────────────────
// POST /api/agents/:slug/review
// ─────────────────────────────────────────

const reviewSchema = z.object({ rating: z.number().min(1).max(5), comment: z.string().max(1000).optional() })

agentsRouter.post('/:slug/review', requireAuth, async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'rating (1-5) is required' })

  const [agent] = await db.select().from(agents).where(eq(agents.slug, req.params.slug)).limit(1)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const [review] = await db
    .insert(reviews)
    .values({
      agent_id: agent.id,
      user_id: req.auth!.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
    })
    .onConflictDoUpdate({
      target: [reviews.agent_id, reviews.user_id],
      set: { rating: parsed.data.rating, comment: parsed.data.comment },
    })
    .returning()

  const [agg] = await db
    .select({ avgRating: avg(reviews.rating), reviewCount: count() })
    .from(reviews)
    .where(eq(reviews.agent_id, agent.id))

  await db
    .update(agents)
    .set({
      avg_rating: agg?.avgRating ? Number(agg.avgRating) : null,
      review_count: agg?.reviewCount ?? 0,
    })
    .where(eq(agents.id, agent.id))

  res.json({ review })
})
