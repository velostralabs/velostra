import { Router } from 'express'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  builders,
  builderEarnings,
  agents,
  agentTags,
  agentRevisions,
  earningsClaims,
  userNotifications,
} from '../db/schema.js'
import { requireAuth, requireBuilder } from '../middleware/auth.js'
import { AGENT_CATEGORIES, MIN_PRICE_PER_CALL, priceTierFor } from '../lib/constants.js'
import { signJWT } from '../lib/auth.js'
import { authCookieOptions } from '../lib/config.js'
import { EndpointSecurityError, validateAgentEndpoint } from '../lib/gateway/ssrf.js'
import {
  encryptAgentSecret,
  generateAgentSecret,
  omitAgentSecret,
} from '../lib/gateway/secrets.js'
import {
  getVelostraEscrowAddress,
  OnchainVerificationError,
  velostraChainId,
  verifyClaimTransaction,
} from '../lib/gateway/onchain.js'
import { compareMoney, money, moneyToNumber } from '../lib/money.js'
import { enqueueBuilderWebhook } from '../lib/platform/webhooks.js'

export const builderRouter = Router()

function serializeAgentMoney<T extends { secret_key_ciphertext: string; price_per_call: string; total_revenue: string }>(agent: T) {
  return {
    ...omitAgentSecret(agent),
    price_per_call: moneyToNumber(agent.price_per_call),
    total_revenue: moneyToNumber(agent.total_revenue),
  }
}

function serializeEarnings<T extends { total_earned: string; available: string; total_claimed: string }>(row: T) {
  return {
    ...row,
    total_earned: moneyToNumber(row.total_earned),
    available: moneyToNumber(row.available),
    total_claimed: moneyToNumber(row.total_claimed),
  }
}

// ─────────────────────────────────────────
// POST /api/builder/register — become a builder
// ─────────────────────────────────────────

const registerSchema = z.object({
  display_name: z.string().min(2).max(60),
  bio: z.string().max(500).optional(),
  website_url: z.string().url().optional(),
  twitter_url: z.string().url().optional(),
  github_url: z.string().url().optional(),
})

builderRouter.post('/register', requireAuth, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'INVALID_BUILDER_INPUT' })

  const [existing] = await db.select().from(builders).where(eq(builders.user_id, req.auth!.id)).limit(1)
  if (existing) return res.status(409).json({ error: 'Already registered as a builder', code: 'BUILDER_ALREADY_REGISTERED' })

  const builder = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(builders)
      .values({
        user_id: req.auth!.id,
        wallet_address: req.auth!.wallet_address,
        ...parsed.data,
      })
      .returning()

    await tx.insert(builderEarnings).values({ builder_id: created.id })
    return created
  })

  // The JWT issued at login was minted before this builder profile existed,
  // so its `is_builder` claim is stale. Reissue it now so requireBuilder()
  // on subsequent requests (in this same session) sees the correct status
  // without forcing the user to sign out and back in.
  const token = await signJWT({
    id: req.auth!.id,
    wallet_address: req.auth!.wallet_address,
    display_name: req.auth!.display_name,
    is_builder: true,
    is_admin: req.auth!.is_admin,
    admin_roles: req.auth!.admin_roles,
  })

  res
    .cookie('velostra_token', token, authCookieOptions())
    .json({ builder })
})

// ─────────────────────────────────────────
// GET /api/builder/me — dashboard summary
// ─────────────────────────────────────────

builderRouter.get('/me', requireAuth, requireBuilder, async (req, res) => {
  const [builder] = await db.select().from(builders).where(eq(builders.user_id, req.auth!.id)).limit(1)
  if (!builder) return res.json({ builder: null })

  const [earnings] = await db.select().from(builderEarnings).where(eq(builderEarnings.builder_id, builder.id)).limit(1)
  const builderAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.builder_id, builder.id))
    .orderBy(desc(agents.created_at))

  res.json({
    builder: {
      ...builder,
      earnings: earnings ? serializeEarnings(earnings) : null,
      agents: builderAgents.map(serializeAgentMoney),
    },
  })
})

// ─────────────────────────────────────────
// POST /api/builder/agents — submit a new agent
// ─────────────────────────────────────────

const submitSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().min(10).max(280),
  long_description: z.string().max(4000).optional(),
  category: z.enum(AGENT_CATEGORIES),
  endpoint_url: z.string().url(),
  price_per_call: z.number().min(MIN_PRICE_PER_CALL),
  logo_url: z.string().url().optional(),
  tags: z.array(z.string()).max(8).optional(),
})

builderRouter.post('/agents', requireAuth, requireBuilder, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'INVALID_BUILDER_INPUT' })

  const [builder] = await db.select().from(builders).where(eq(builders.user_id, req.auth!.id)).limit(1)
  if (!builder) return res.status(403).json({ error: 'Builder profile not found', code: 'BUILDER_NOT_FOUND' })

  try {
    await validateAgentEndpoint(parsed.data.endpoint_url)
  } catch (error) {
    if (error instanceof EndpointSecurityError) {
      return res.status(400).json({ error: error.message, code: error.code })
    }
    throw error
  }

  let pricePerCall: ReturnType<typeof money>
  try {
    pricePerCall = money(parsed.data.price_per_call)
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid price', code: 'INVALID_AGENT_PRICE' })
  }
  const slug = `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nanoid(6)}`
  const secretKey = generateAgentSecret()
  const encryptedSecret = encryptAgentSecret(secretKey)

  const agent = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agents)
      .values({
        builder_id: builder.id,
        name: parsed.data.name,
        slug,
        description: parsed.data.description,
        long_description: parsed.data.long_description,
        category: parsed.data.category,
        endpoint_url: parsed.data.endpoint_url,
        secret_key_ciphertext: encryptedSecret,
        price_per_call: pricePerCall,
        price_tier: priceTierFor(parsed.data.price_per_call),
        logo_url: parsed.data.logo_url,
        status: 'PENDING',
      })
      .returning()

    const [revision] = await tx
      .insert(agentRevisions)
      .values({
        agent_id: created.id,
        revision_number: 1,
        status: 'PUBLISHED',
        name: created.name,
        description: created.description,
        long_description: created.long_description,
        category: created.category,
        endpoint_url: created.endpoint_url,
        price_per_call: created.price_per_call,
        price_tier: created.price_tier,
        logo_url: created.logo_url,
        change_summary: 'Initial agent submission',
        created_by_user_id: req.auth!.id,
        published_at: new Date(),
      })
      .returning()

    const [activated] = await tx
      .update(agents)
      .set({ active_revision_id: revision.id })
      .where(eq(agents.id, created.id))
      .returning()

    if (parsed.data.tags?.length) {
      await tx.insert(agentTags).values(parsed.data.tags.map((tag) => ({ agent_id: created.id, tag })))
    }
    await tx.insert(userNotifications).values({
      user_id: builder.user_id,
      type: 'agent.submitted',
      title: 'Agent submitted for review',
      body: `${created.name} revision 1 is awaiting approval.`,
      metadata: { agent_id: created.id, revision_id: revision.id, revision_number: 1 },
    })
    return activated
  })

  res.json({ agent: serializeAgentMoney(agent), secret_key: secretKey })
})

// ─────────────────────────────────────────
// POST /api/builder/agents/:id/secret/rotate
// ─────────────────────────────────────────

builderRouter.post('/agents/:id/secret/rotate', requireAuth, requireBuilder, async (req, res) => {
  const [builder] = await db
    .select({ id: builders.id })
    .from(builders)
    .where(eq(builders.user_id, req.auth!.id))
    .limit(1)
  if (!builder) return res.status(403).json({ error: 'Builder profile not found', code: 'BUILDER_NOT_FOUND' })

  const secretKey = generateAgentSecret()
  const [agent] = await db
    .update(agents)
    .set({
      secret_key_ciphertext: encryptAgentSecret(secretKey),
      secret_version: sql`${agents.secret_version} + 1`,
      secret_rotated_at: new Date(),
      secret_revoked_at: null,
      updated_at: new Date(),
    })
    .where(and(eq(agents.id, req.params.id), eq(agents.builder_id, builder.id)))
    .returning()
  if (!agent) return res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })

  res.json({ agent: serializeAgentMoney(agent), secret_key: secretKey })
})

// ─────────────────────────────────────────
// POST /api/builder/agents/:id/secret/revoke
// ─────────────────────────────────────────

builderRouter.post('/agents/:id/secret/revoke', requireAuth, requireBuilder, async (req, res) => {
  const [builder] = await db
    .select({ id: builders.id })
    .from(builders)
    .where(eq(builders.user_id, req.auth!.id))
    .limit(1)
  if (!builder) return res.status(403).json({ error: 'Builder profile not found', code: 'BUILDER_NOT_FOUND' })

  const [agent] = await db
    .update(agents)
    .set({ secret_revoked_at: new Date(), updated_at: new Date() })
    .where(and(eq(agents.id, req.params.id), eq(agents.builder_id, builder.id)))
    .returning()
  if (!agent) return res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })

  res.json({ agent: serializeAgentMoney(agent), secret_revoked: true })
})

// ─────────────────────────────────────────
// GET /api/builder/earnings
// ─────────────────────────────────────────

builderRouter.get('/earnings', requireAuth, requireBuilder, async (req, res) => {
  const [builder] = await db.select().from(builders).where(eq(builders.user_id, req.auth!.id)).limit(1)
  if (!builder) return res.status(404).json({ error: 'Builder profile not found', code: 'BUILDER_NOT_FOUND' })

  const [earnings] = await db.select().from(builderEarnings).where(eq(builderEarnings.builder_id, builder.id)).limit(1)
  const claims = await db
    .select()
    .from(earningsClaims)
    .where(eq(earningsClaims.builder_id, builder.id))
    .orderBy(desc(earningsClaims.created_at))
    .limit(20)

  res.json({
    earnings: earnings ? serializeEarnings(earnings) : null,
    claims: claims.map((claim) => ({
      ...claim,
      amount: moneyToNumber(claim.amount),
      block_number: claim.block_number?.toString() ?? null,
    })),
  })
})

// ─────────────────────────────────────────
// POST /api/builder/claim — request an earnings claim
// ─────────────────────────────────────────
// NOTE: this records the claim intent in Postgres; the actual onchain
// settlement happens by calling `claimEarnings(amount)` on VelostraEscrow.sol
// from the builder's own wallet (signed client-side via wagmi), then
// reporting the resulting tx_hash back here to reconcile `available`.

const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const claimSchema = z.object({
  amount: z.number().positive(),
  tx_hash: txHashSchema,
})

builderRouter.post('/claim', requireAuth, requireBuilder, async (req, res) => {
  const parsed = claimSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'amount and a valid transaction hash are required', code: 'INVALID_CLAIM_INPUT' })
  }

  const [builder] = await db.select().from(builders).where(eq(builders.user_id, req.auth!.id)).limit(1)
  if (!builder) return res.status(404).json({ error: 'Builder profile not found', code: 'BUILDER_NOT_FOUND' })

  let claimAmount: ReturnType<typeof money>
  try {
    claimAmount = money(parsed.data.amount)
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid amount', code: 'INVALID_CLAIM_AMOUNT' })
  }
  const hash = parsed.data.tx_hash as `0x${string}`
  const [replayed] = await db
    .select({ id: earningsClaims.id })
    .from(earningsClaims)
    .where(eq(earningsClaims.tx_hash, hash))
    .limit(1)
  if (replayed) return res.status(409).json({ error: 'Transaction hash has already been reconciled', code: 'CLAIM_REPLAYED' })

  let claimBlockNumber: bigint | undefined
  try {
    const receipt = await verifyClaimTransaction(
      hash,
      builder.wallet_address as `0x${string}`,
      claimAmount
    )
    claimBlockNumber = receipt.blockNumber
  } catch (error) {
    const message =
      error instanceof OnchainVerificationError ? error.message : 'Unable to verify claim onchain'
    return res.status(400).json({ error: message, code: 'CLAIM_VERIFICATION_FAILED' })
  }

  try {
    const claim = await db.transaction(async (tx) => {
      const [alreadyUsed] = await tx
        .select({ id: earningsClaims.id })
        .from(earningsClaims)
        .where(eq(earningsClaims.tx_hash, hash))
        .limit(1)
      if (alreadyUsed) {
        const error = new Error('Transaction hash has already been reconciled')
        error.name = 'ReplayError'
        throw error
      }

      const [earnings] = await tx
        .select()
        .from(builderEarnings)
        .where(eq(builderEarnings.builder_id, builder.id))
        .for('update')
        .limit(1)
      if (!earnings) throw new Error('Earnings record not found')
      if (compareMoney(claimAmount, earnings.available) > 0) {
        const error = new Error('Amount exceeds available balance')
        error.name = 'InsufficientEarningsError'
        throw error
      }

      const [created] = await tx
        .insert(earningsClaims)
        .values({
          builder_id: builder.id,
          amount: claimAmount,
          wallet_address: builder.wallet_address,
          tx_hash: hash,
          chain_id: velostraChainId,
          contract_address: getVelostraEscrowAddress(),
          block_number: claimBlockNumber,
          status: 'COMPLETED',
          completed_at: new Date(),
        })
        .returning()

      await tx
        .update(builderEarnings)
        .set({
          available: sql`${builderEarnings.available} - ${claimAmount}`,
          total_claimed: sql`${builderEarnings.total_claimed} + ${claimAmount}`,
          updated_at: new Date(),
        })
        .where(eq(builderEarnings.builder_id, builder.id))

      await enqueueBuilderWebhook(tx, {
        builderId: builder.id,
        eventType: 'claim.confirmed',
        aggregateType: 'earnings_claim',
        aggregateId: created.id,
        dedupeKey: `claim.confirmed:${created.id}`,
        payload: {
          claim_id: created.id,
          amount: created.amount,
          transaction_hash: hash,
          block_number: claimBlockNumber?.toString() ?? null,
          confirmed_at: created.completed_at?.toISOString() ?? new Date().toISOString(),
        },
      })

      return created
    })

    res.json({
      claim: {
        ...claim,
      amount: moneyToNumber(claim.amount),
        block_number: claim.block_number?.toString() ?? null,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'InsufficientEarningsError') {
      return res.status(400).json({ error: error.message, code: 'INSUFFICIENT_EARNINGS' })
    }
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if ((error instanceof Error && error.name === 'ReplayError') || code === '23505') {
      return res.status(409).json({ error: 'Transaction hash has already been reconciled', code: 'CLAIM_REPLAYED' })
    }
    throw error
  }
})
