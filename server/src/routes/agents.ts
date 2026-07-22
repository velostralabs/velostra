import { Router } from 'express'
import { z } from 'zod'
import { and, desc, asc, eq, ilike, or, avg, count, gte, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { Address, Hash } from 'viem'
import { db } from '../db/client.js'
import {
  agents,
  agentTags,
  builders,
  reviews,
  agentCategoryEnum,
  agentCalls,
  creditBalances,
  settlementAttempts,
  users,
} from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'
import { buildGatewayHeaders } from '../lib/gateway/hmac.js'
import { AgentEndpointError, safeFetchAgent } from '../lib/gateway/ssrf.js'
import { decryptAgentSecret, omitAgentSecret } from '../lib/gateway/secrets.js'
import {
  checkRateLimit,
  checkAgentRateLimit,
  checkGlobalRateLimit,
  checkPublicTestnetPaidCallLimit,
} from '../lib/gateway/ratelimit.js'
import { hasFreeTierRemaining, incrementFreeTier } from '../lib/gateway/quota.js'
import { PLATFORM_FEE_BPS } from '../lib/constants.js'
import {
  broadcastBuilderCredit,
  waitForBuilderCredit,
  OnchainSettlementRevertedError,
  getVelostraEscrowAddress,
  hashAgentCallId,
  velostraChainId,
  verifyBuilderCreditReceipt,
} from '../lib/gateway/onchain.js'
import { money, moneyToNumber, splitFee } from '../lib/money.js'
import {
  failUnsettledCall,
  finalizeSettlement,
  markSettlementAmbiguous,
  markSettlementConfirmed,
  markSettlementReady,
  markSettlementSubmitted,
} from '../lib/gateway/settlement.js'
import {
  Phase3AdmissionError,
  resolvePhase3PaidCallAdmission,
  type Phase3PaidCallAdmission,
} from '../lib/phase3-canary.js'
import { persistPhase3CanaryAdmission } from '../lib/phase3-canary-db.js'

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
  if (q) {
    const term = `%${q.trim()}%`
    const search = or(
      ilike(agents.name, term),
      ilike(agents.description, term),
      ilike(agents.long_description, term)
    )
    if (search) conditions.push(search)
  }

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
    price_per_call: moneyToNumber(r.price_per_call),
    builder: { display_name: r.builder_name, verified: r.builder_verified },
  }))

  res.json({ agents: list })
})

// ─────────────────────────────────────────
// GET /api/agents/:slug
// ─────────────────────────────────────────

agentsRouter.get('/:slug', async (req, res) => {
  const [agent] = await db.select().from(agents).where(eq(agents.slug, req.params.slug)).limit(1)
  if (!agent || agent.status !== 'APPROVED') return res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })

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
      price_per_call: moneyToNumber(agent.price_per_call),
      total_revenue: moneyToNumber(agent.total_revenue),
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
  if (!parsed.success) {
    return res.status(400).json({ error: 'input is required', code: 'INVALID_INPUT' })
  }

  const userId = req.auth!.id
  if (!(await checkGlobalRateLimit())) {
    return res.status(429).json({ error: 'Platform is busy, try again shortly', code: 'GLOBAL_RATE_LIMITED' })
  }
  const { allowed } = await checkRateLimit(userId)
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded, try again in a minute', code: 'USER_RATE_LIMITED' })
  }

  const [agent] = await db.select().from(agents).where(eq(agents.slug, req.params.slug)).limit(1)
  if (!agent || agent.status !== 'APPROVED') {
    return res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })
  }
  if (!(await checkAgentRateLimit(userId, agent.id))) {
    return res.status(429).json({ error: 'Too many calls to this agent, slow down', code: 'AGENT_RATE_LIMITED' })
  }
  if (agent.secret_revoked_at) {
    return res.status(409).json({
      error: 'Agent gateway secret has been revoked by its builder',
      code: 'AGENT_SECRET_REVOKED',
    })
  }

  const isFreeTier = await hasFreeTierRemaining(userId)
  const [[builder], [caller]] = await Promise.all([
    db
      .select({ wallet_address: builders.wallet_address })
      .from(builders)
      .where(eq(builders.id, agent.builder_id))
      .limit(1),
    db
      .select({ wallet_address: users.wallet_address })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ])
  if (!builder) {
    return res.status(500).json({ error: 'Agent builder profile is missing', code: 'BUILDER_MISSING' })
  }
  if (!caller) {
    return res.status(500).json({ error: 'Authenticated user profile is missing', code: 'USER_MISSING' })
  }

  const callId = createId()
  const onchainCallId = isFreeTier ? null : hashAgentCallId(callId)
  const split = splitFee(agent.price_per_call, PLATFORM_FEE_BPS)
  let phase3Admission: Phase3PaidCallAdmission | null = null
  if (!isFreeTier) {
    try {
      phase3Admission = resolvePhase3PaidCallAdmission({
        walletAddress: caller.wallet_address,
        agentId: agent.id,
        builderAddress: builder.wallet_address,
        gross: split.gross,
      })
    } catch (error) {
      if (error instanceof Phase3AdmissionError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code })
      }
      throw error
    }

    const publicTestnetLimit = await checkPublicTestnetPaidCallLimit(userId)
    if (!publicTestnetLimit.allowed) {
      const walletLimited = publicTestnetLimit.reason === 'wallet'
      return res.status(429).json({
        error: walletLimited
          ? 'This wallet has reached its public testnet paid-call allowance for today'
          : 'The public testnet has reached its paid-call allowance for today',
        code: walletLimited
          ? 'PUBLIC_TESTNET_WALLET_DAILY_LIMIT'
          : 'PUBLIC_TESTNET_GLOBAL_DAILY_LIMIT',
      })
    }
  }
  const body = JSON.stringify({ input: parsed.data.input, user_id: userId, call_id: callId })
  const headers = buildGatewayHeaders(
    body,
    agent.id,
    decryptAgentSecret(agent.secret_key_ciphertext)
  )

  let durableCallCreated = false
  let settlementTxHash: Hash | null = null

  try {
    // Commit the call intent, funds reservation, and outbox row together.
    // No database transaction remains open during builder HTTP or chain RPC.
    await db.transaction(async (tx) => {
      await tx.insert(agentCalls).values({
        id: callId,
        agent_id: agent.id,
        user_id: userId,
        agent_revision_id: agent.active_revision_id,
        input: parsed.data.input,
        status: 'PROCESSING',
        is_free_tier: isFreeTier,
        onchain_call_id: onchainCallId,
      })

      if (!isFreeTier) {
        if (phase3Admission?.mode === 'canary') {
          await persistPhase3CanaryAdmission(tx, callId, phase3Admission)
        }

        const [reserved] = await tx
          .update(creditBalances)
          .set({
            reserved_usd: sql`${creditBalances.reserved_usd} + ${split.gross}`,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(creditBalances.user_id, userId),
              gte(
                sql`${creditBalances.balance_usd} - ${creditBalances.reserved_usd}`,
                split.gross
              )
            )
          )
          .returning({ id: creditBalances.id })
        if (!reserved) {
          const error = new Error('Insufficient available credits')
          error.name = 'InsufficientCreditsError'
          throw error
        }

        await tx.insert(settlementAttempts).values({
          agent_call_id: callId,
          onchain_call_id: onchainCallId!,
          builder_address: builder.wallet_address,
          gross_amount: split.gross,
          builder_amount: split.builder,
          platform_amount: split.platform,
          status: 'PREPARED',
          chain_id: velostraChainId,
          contract_address: getVelostraEscrowAddress(),
        })
      }
    })
    durableCallCreated = true

    const started = Date.now()
    const upstream = await safeFetchAgent(agent.endpoint_url, {
      method: 'POST',
      headers,
      body,
    })
    const executionMs = Date.now() - started
    let output: unknown = upstream.text
    try {
      output = upstream.text ? JSON.parse(upstream.text) : null
    } catch {
      // Plain-text responses are valid.
    }
    if (!upstream.ok) {
      const error = new Error(`Agent endpoint returned HTTP ${upstream.status}`)
      error.name = 'UpstreamAgentError'
      throw error
    }

    await db
      .update(agentCalls)
      .set({ output, execution_ms: executionMs, error_message: null })
      .where(and(eq(agentCalls.id, callId), eq(agentCalls.status, 'PROCESSING')))

    if (!isFreeTier) await markSettlementReady(callId)

    if (isFreeTier) {
      const finalized = await db.transaction(async (tx) => {
        const [won] = await tx
          .update(agentCalls)
          .set({
            status: 'SUCCESS',
            output,
            execution_ms: executionMs,
            price_charged: money(0),
            builder_earned: money(0),
            platform_earned: money(0),
            error_message: null,
            completed_at: new Date(),
          })
          .where(and(eq(agentCalls.id, callId), eq(agentCalls.status, 'PROCESSING')))
          .returning({ id: agentCalls.id })
        if (won) {
          await tx
            .update(agents)
            .set({
              total_calls: sql`${agents.total_calls} + 1`,
              updated_at: new Date(),
            })
            .where(eq(agents.id, agent.id))
        }
        return Boolean(won)
      })

      if (finalized) {
        try {
          await incrementFreeTier(userId)
        } catch (error) {
          console.error('[free-tier] Redis increment failed; Postgres remains authoritative', error)
        }
      }

      return res.json({
        call_id: callId,
        output,
        execution_ms: executionMs,
        is_free_tier: true,
        settlement_tx_hash: null,
      })
    }

    try {
      settlementTxHash = await broadcastBuilderCredit(
        builder.wallet_address as `0x${string}`,
        split.gross,
        onchainCallId!
      )
      if (
        process.env.NODE_ENV === 'test' &&
        process.env.RECONCILE_TEST_AMBIGUOUS_BROADCAST_INPUT === parsed.data.input
      ) {
        const transmittedHash = settlementTxHash
        await markSettlementAmbiguous(
          callId,
          new Error('Injected lost broadcast response after transaction transmission')
        )
        settlementTxHash = null
        console.error('[agent-call] injected unknown broadcast outcome; reconciliation pending', {
          callId,
          onchainCallId,
          transmittedHash,
        })
        return res.status(503).json({
          error: 'Settlement broadcast outcome is uncertain; reconciliation is pending',
          code: 'SETTLEMENT_AMBIGUOUS',
          call_id: callId,
          reconciliation_pending: true,
        })
      }
    } catch (error) {
      await markSettlementAmbiguous(callId, error)
      console.error('[agent-call] broadcast outcome is ambiguous; reconciliation pending', {
        callId,
        onchainCallId,
        error,
      })
      return res.status(503).json({
        error: 'Settlement broadcast outcome is uncertain; reconciliation is pending',
        code: 'SETTLEMENT_AMBIGUOUS',
        call_id: callId,
        reconciliation_pending: true,
      })
    }

    // Persist the hash before receipt polling. A crash after this write is
    // recoverable without relying only on a broad event scan.
    await markSettlementSubmitted(callId, settlementTxHash)

    let receipt
    let confirmedSplit: ReturnType<typeof verifyBuilderCreditReceipt>
    try {
      if (
        process.env.NODE_ENV === 'test' &&
        process.env.RECONCILE_TEST_AMBIGUOUS_RECEIPT_INPUT === parsed.data.input
      ) {
        throw new Error('Injected ambiguous receipt lookup')
      }
      receipt = await waitForBuilderCredit(settlementTxHash)
      confirmedSplit = verifyBuilderCreditReceipt(
        receipt,
        builder.wallet_address as Address,
        onchainCallId!,
        split.gross
      )
    } catch (error) {
      if (error instanceof OnchainSettlementRevertedError) {
        await failUnsettledCall(callId, error)
        return res.status(502).json({
          error: 'Onchain settlement reverted; reserved credits were released',
          code: 'SETTLEMENT_REVERTED',
          call_id: callId,
          settlement_tx_hash: settlementTxHash,
        })
      }

      await markSettlementAmbiguous(callId, error, settlementTxHash)
      console.error('[agent-call] receipt unavailable; reconciliation pending', {
        callId,
        settlementTxHash,
        error,
      })
      return res.status(503).json({
        error: 'Settlement receipt is not yet available; reconciliation is pending',
        code: 'SETTLEMENT_AMBIGUOUS',
        call_id: callId,
        settlement_tx_hash: settlementTxHash,
        reconciliation_pending: true,
      })
    }

    await markSettlementConfirmed(
      callId,
      settlementTxHash,
      receipt.blockNumber,
      confirmedSplit.builderAmount,
      confirmedSplit.platformAmount
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
      const pauseMs = Number(process.env.RECONCILE_TEST_PAUSE_AFTER_SETTLEMENT_MS ?? 0)
      if (Number.isFinite(pauseMs) && pauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs))
      }
    }

    await finalizeSettlement({
      callId,
      txHash: settlementTxHash,
      blockNumber: receipt.blockNumber,
      confirmedAt: new Date(),
      builderAmount: confirmedSplit.builderAmount,
      platformAmount: confirmedSplit.platformAmount,
    })

    return res.json({
      call_id: callId,
      output,
      execution_ms: executionMs,
      is_free_tier: false,
      settlement_tx_hash: settlementTxHash,
    })
  } catch (error) {
    if (durableCallCreated && !settlementTxHash) {
      try {
        await failUnsettledCall(callId, error)
      } catch (recordError) {
        console.error('[agent-call] failed to release failed call reservation', recordError)
      }
    }

    if (settlementTxHash) {
      console.error('[agent-call] chain side effect may exist; reconciliation pending', {
        callId,
        onchainCallId,
        settlementTxHash,
        error,
      })
      return res.status(503).json({
        error: 'Settlement may be confirmed; call reconciliation is pending',
        code: 'RECONCILIATION_PENDING',
        call_id: callId,
        settlement_tx_hash: settlementTxHash,
        reconciliation_pending: true,
      })
    }
    if (error instanceof Phase3AdmissionError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code })
    }
    if (error instanceof Error && error.name === 'InsufficientCreditsError') {
      return res.status(402).json({
        error: 'Insufficient credits - top up to keep using this agent',
        code: 'INSUFFICIENT_CREDITS',
      })
    }

    const endpointFailure =
      error instanceof AgentEndpointError ||
      (error instanceof Error && error.name === 'UpstreamAgentError')
    return res.status(endpointFailure ? 502 : 500).json({
      error: endpointFailure
        ? 'Agent endpoint failed to respond safely'
        : 'Agent call could not be completed',
      code: endpointFailure ? 'AGENT_ENDPOINT_FAILED' : 'AGENT_CALL_FAILED',
    })
  }
})

const reviewSchema = z.object({ rating: z.number().min(1).max(5), comment: z.string().max(1000).optional() })

agentsRouter.post('/:slug/review', requireAuth, async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'rating (1-5) is required', code: 'INVALID_REVIEW' })

  const [agent] = await db.select().from(agents).where(eq(agents.slug, req.params.slug)).limit(1)
  if (!agent) return res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })

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
