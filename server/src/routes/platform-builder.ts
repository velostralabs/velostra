import { Router } from 'express'
import { z } from 'zod'
import {
  and,
  avg,
  count,
  desc,
  eq,
  gte,
  lte,
  lt,
  max,
  or,
  sql,
  sum,
} from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  agentCalls,
  agentCategoryEnum,
  agentRevisions,
  agents,
  builders,
  earningsClaims,
  priceTierEnum,
  userNotifications,
} from '../db/schema.js'
import { requireAuth, requireBuilder } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { MIN_PRICE_PER_CALL, priceTierFor } from '../lib/constants.js'
import { money, moneyToNumber } from '../lib/money.js'
import { cursorScope, decodeCursor, encodeCursor } from '../lib/platform/cursor.js'
import { sendPage } from '../lib/platform/http.js'
import {
  AgentEndpointError,
  EndpointSecurityError,
  safeFetchAgent,
  validateAgentEndpoint,
} from '../lib/gateway/ssrf.js'
import { buildGatewayHeaders } from '../lib/gateway/hmac.js'
import { decryptAgentSecret } from '../lib/gateway/secrets.js'

export const platformBuilderRouter = Router()
platformBuilderRouter.use(requireAuth, requireBuilder)

async function ownedBuilder(userId: string) {
  const [builder] = await db
    .select()
    .from(builders)
    .where(eq(builders.user_id, userId))
    .limit(1)
  if (!builder) throw new AppError(403, 'BUILDER_NOT_FOUND', 'Builder profile not found')
  return builder
}

async function ownedAgent(userId: string, agentId: string) {
  const builder = await ownedBuilder(userId)
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.builder_id, builder.id)))
    .limit(1)
  if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found')
  return { builder, agent }
}

function serializeRevision<T extends { price_per_call: string }>(revision: T) {
  return { ...revision, price_per_call: moneyToNumber(revision.price_per_call) }
}

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
})

platformBuilderRouter.get('/agents/:id/revisions', async (req, res) => {
  const parsed = pageQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid revision query')
  await ownedAgent(req.auth!.id, req.params.id)
  const scope = cursorScope({ resource: 'agent-revisions', agentId: req.params.id })
  const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
  const conditions = [eq(agentRevisions.agent_id, req.params.id)]
  if (boundary) {
    conditions.push(
      or(
        lt(agentRevisions.created_at, boundary.createdAt),
        and(eq(agentRevisions.created_at, boundary.createdAt), lt(agentRevisions.id, boundary.id))
      )!
    )
  }
  const rows = await db
    .select()
    .from(agentRevisions)
    .where(and(...conditions))
    .orderBy(desc(agentRevisions.created_at), desc(agentRevisions.id))
    .limit(parsed.data.limit + 1)
  const hasMore = rows.length > parsed.data.limit
  const data = rows.slice(0, parsed.data.limit)
  const last = data.at(-1)
  return sendPage(res, data.map(serializeRevision), {
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
  })
})

const revisionSchema = z
  .object({
    name: z.string().min(2).max(60).optional(),
    description: z.string().min(10).max(280).optional(),
    long_description: z.string().max(4000).nullable().optional(),
    category: z.enum(agentCategoryEnum.enumValues).optional(),
    endpoint_url: z.string().url().optional(),
    price_per_call: z.number().min(MIN_PRICE_PER_CALL).optional(),
    price_tier: z.enum(priceTierEnum.enumValues).optional(),
    logo_url: z.string().url().nullable().optional(),
    change_summary: z.string().min(3).max(500),
  })
  .strict()

platformBuilderRouter.post('/agents/:id/revisions', async (req, res) => {
  const parsed = revisionSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_REVISION_INPUT', 'Invalid agent revision', {
      details: parsed.error.flatten(),
    })
  }
  const { builder, agent } = await ownedAgent(req.auth!.id, req.params.id)
  if (parsed.data.endpoint_url) {
    try {
      await validateAgentEndpoint(parsed.data.endpoint_url)
    } catch (error) {
      if (error instanceof EndpointSecurityError) throw new AppError(400, error.code, error.message)
      throw error
    }
  }
  const requestedPrice = parsed.data.price_per_call === undefined
    ? agent.price_per_call
    : money(parsed.data.price_per_call)

  const revision = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${agent.id}))`)
    const [latest] = await tx
      .select({ value: max(agentRevisions.revision_number) })
      .from(agentRevisions)
      .where(eq(agentRevisions.agent_id, agent.id))
    const revisionNumber = Number(latest?.value ?? 0) + 1
    const [created] = await tx
      .insert(agentRevisions)
      .values({
        agent_id: agent.id,
        revision_number: revisionNumber,
        name: parsed.data.name ?? agent.name,
        description: parsed.data.description ?? agent.description,
        long_description: parsed.data.long_description === undefined
          ? agent.long_description
          : parsed.data.long_description,
        category: parsed.data.category ?? agent.category,
        endpoint_url: parsed.data.endpoint_url ?? agent.endpoint_url,
        price_per_call: requestedPrice,
        price_tier: parsed.data.price_tier ?? priceTierFor(Number(requestedPrice)),
        logo_url: parsed.data.logo_url === undefined ? agent.logo_url : parsed.data.logo_url,
        change_summary: parsed.data.change_summary,
        created_by_user_id: req.auth!.id,
      })
      .returning()
    await tx.insert(userNotifications).values({
      user_id: builder.user_id,
      type: 'agent.revision.created',
      title: 'Draft revision created',
      body: `${agent.name} revision ${revisionNumber} is ready for testing.`,
      metadata: { agent_id: agent.id, revision_id: created.id, revision_number: revisionNumber },
    })
    return created
  })
  res.status(201).json({ revision: serializeRevision(revision) })
})

async function activateRevision(input: {
  userId: string
  agentId: string
  revisionId: string
  mode: 'publish' | 'rollback'
}) {
  const { builder, agent } = await ownedAgent(input.userId, input.agentId)
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${agent.id}))`)
    const [revision] = await tx
      .select()
      .from(agentRevisions)
      .where(and(eq(agentRevisions.id, input.revisionId), eq(agentRevisions.agent_id, agent.id)))
      .limit(1)
    if (!revision) throw new AppError(404, 'REVISION_NOT_FOUND', 'Agent revision not found')

    if (input.mode === 'publish') {
      if (revision.status !== 'DRAFT') {
        throw new AppError(409, 'REVISION_NOT_DRAFT', 'Only a draft revision can be published')
      }
      const [published] = await tx
        .update(agentRevisions)
        .set({ status: 'PUBLISHED', published_at: new Date() })
        .where(and(eq(agentRevisions.id, revision.id), eq(agentRevisions.status, 'DRAFT')))
        .returning()
      if (!published) throw new AppError(409, 'REVISION_PUBLISH_RACE', 'Revision was already published')
    } else if (revision.status !== 'PUBLISHED') {
      throw new AppError(409, 'REVISION_NOT_PUBLISHED', 'Rollback target must be published')
    }

    const [updatedAgent] = await tx
      .update(agents)
      .set({
        active_revision_id: revision.id,
        name: revision.name,
        description: revision.description,
        long_description: revision.long_description,
        category: revision.category,
        endpoint_url: revision.endpoint_url,
        price_per_call: revision.price_per_call,
        price_tier: revision.price_tier,
        logo_url: revision.logo_url,
        status: 'PENDING',
        updated_at: new Date(),
      })
      .where(and(eq(agents.id, agent.id), eq(agents.builder_id, builder.id)))
      .returning()
    if (!updatedAgent) throw new AppError(409, 'AGENT_ACTIVATION_RACE', 'Agent revision activation lost its race')

    await tx.insert(userNotifications).values({
      user_id: builder.user_id,
      type: input.mode === 'publish' ? 'agent.revision.published' : 'agent.revision.rolled_back',
      title: input.mode === 'publish' ? 'Revision published' : 'Revision rollback requested',
      body: `${agent.name} revision ${revision.revision_number} is awaiting approval.`,
      metadata: { agent_id: agent.id, revision_id: revision.id, revision_number: revision.revision_number },
    })
    return { revision, agent: updatedAgent }
  })
}

platformBuilderRouter.post('/agents/:id/revisions/:revisionId/publish', async (req, res) => {
  res.json(await activateRevision({
    userId: req.auth!.id,
    agentId: req.params.id,
    revisionId: req.params.revisionId,
    mode: 'publish',
  }))
})

platformBuilderRouter.post('/agents/:id/revisions/:revisionId/rollback', async (req, res) => {
  res.json(await activateRevision({
    userId: req.auth!.id,
    agentId: req.params.id,
    revisionId: req.params.revisionId,
    mode: 'rollback',
  }))
})

platformBuilderRouter.post('/agents/:id/revisions/:revisionId/test', async (req, res) => {
  const { agent } = await ownedAgent(req.auth!.id, req.params.id)
  const [revision] = await db
    .select()
    .from(agentRevisions)
    .where(and(eq(agentRevisions.id, req.params.revisionId), eq(agentRevisions.agent_id, agent.id)))
    .limit(1)
  if (!revision) throw new AppError(404, 'REVISION_NOT_FOUND', 'Agent revision not found')

  const body = JSON.stringify({ input: 'Velostra endpoint readiness probe', probe: true })
  const started = Date.now()
  try {
    await validateAgentEndpoint(revision.endpoint_url)
    const response = await safeFetchAgent(revision.endpoint_url, {
      method: 'POST',
      headers: buildGatewayHeaders(body, agent.id, decryptAgentSecret(agent.secret_key_ciphertext)),
      body,
    })
    if (!response.ok) {
      throw new AppError(502, 'AGENT_PROBE_UPSTREAM_ERROR', `Agent endpoint returned HTTP ${response.status}`)
    }
    return res.json({
      reachable: true,
      status: response.status,
      duration_ms: Date.now() - started,
      response_bytes: Buffer.byteLength(response.text),
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof EndpointSecurityError || error instanceof AgentEndpointError) {
      throw new AppError(400, error.code, error.message)
    }
    throw error
  }
})

platformBuilderRouter.get('/notifications', async (req, res) => {
  const parsed = pageQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid notification query')
  const scope = cursorScope({ resource: 'notifications', userId: req.auth!.id })
  const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
  const conditions = [eq(userNotifications.user_id, req.auth!.id)]
  if (boundary) {
    conditions.push(
      or(
        lt(userNotifications.created_at, boundary.createdAt),
        and(eq(userNotifications.created_at, boundary.createdAt), lt(userNotifications.id, boundary.id))
      )!
    )
  }
  const rows = await db
    .select()
    .from(userNotifications)
    .where(and(...conditions))
    .orderBy(desc(userNotifications.created_at), desc(userNotifications.id))
    .limit(parsed.data.limit + 1)
  const hasMore = rows.length > parsed.data.limit
  const data = rows.slice(0, parsed.data.limit)
  const last = data.at(-1)
  return sendPage(res, data, {
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
  })
})

platformBuilderRouter.patch('/notifications/:id/read', async (req, res) => {
  const [notification] = await db
    .update(userNotifications)
    .set({ read_at: new Date() })
    .where(and(eq(userNotifications.id, req.params.id), eq(userNotifications.user_id, req.auth!.id)))
    .returning()
  if (!notification) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found')
  res.json({ notification })
})

const historyQuery = pageQuery.extend({
  agent_id: z.string().max(128).optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT']).optional(),
})

platformBuilderRouter.get('/calls', async (req, res) => {
  const parsed = historyQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid call history query')
  const builder = await ownedBuilder(req.auth!.id)
  const scope = cursorScope({
    resource: 'builder-calls',
    builderId: builder.id,
    agentId: parsed.data.agent_id ?? null,
    status: parsed.data.status ?? null,
  })
  const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
  const conditions = [eq(agents.builder_id, builder.id)]
  if (parsed.data.agent_id) conditions.push(eq(agentCalls.agent_id, parsed.data.agent_id))
  if (parsed.data.status) conditions.push(eq(agentCalls.status, parsed.data.status))
  if (boundary) {
    conditions.push(
      or(
        lt(agentCalls.created_at, boundary.createdAt),
        and(eq(agentCalls.created_at, boundary.createdAt), lt(agentCalls.id, boundary.id))
      )!
    )
  }
  const rows = await db
    .select({
      id: agentCalls.id,
      agent_id: agentCalls.agent_id,
      agent_name: agents.name,
      agent_revision_id: agentCalls.agent_revision_id,
      status: agentCalls.status,
      price_charged: agentCalls.price_charged,
      builder_earned: agentCalls.builder_earned,
      execution_ms: agentCalls.execution_ms,
      created_at: agentCalls.created_at,
      completed_at: agentCalls.completed_at,
    })
    .from(agentCalls)
    .innerJoin(agents, eq(agentCalls.agent_id, agents.id))
    .where(and(...conditions))
    .orderBy(desc(agentCalls.created_at), desc(agentCalls.id))
    .limit(parsed.data.limit + 1)
  const hasMore = rows.length > parsed.data.limit
  const data = rows.slice(0, parsed.data.limit)
  const last = data.at(-1)
  return sendPage(res, data.map((row) => ({
    ...row,
    price_charged: moneyToNumber(row.price_charged),
    builder_earned: moneyToNumber(row.builder_earned),
  })), {
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
  })
})

const analyticsQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  agent_id: z.string().max(128).optional(),
  revision_id: z.string().max(128).optional(),
})

platformBuilderRouter.get('/analytics', async (req, res) => {
  const parsed = analyticsQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid analytics query')
  const builder = await ownedBuilder(req.auth!.id)
  const to = parsed.data.to ?? new Date()
  const from = parsed.data.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (from > to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new AppError(400, 'INVALID_ANALYTICS_RANGE', 'Analytics range must be ordered and at most 366 days')
  }
  const conditions = [
    eq(agents.builder_id, builder.id),
    gte(agentCalls.created_at, from),
    lte(agentCalls.created_at, to),
  ]
  if (parsed.data.agent_id) conditions.push(eq(agentCalls.agent_id, parsed.data.agent_id))
  if (parsed.data.revision_id) conditions.push(eq(agentCalls.agent_revision_id, parsed.data.revision_id))

  const [[summary], revisions, [claimSummary]] = await Promise.all([
    db
      .select({
        calls: count(),
        successes: sql<number>`count(*) filter (where ${agentCalls.status} = 'SUCCESS')`,
        errors: sql<number>`count(*) filter (where ${agentCalls.status} in ('FAILED', 'TIMEOUT'))`,
        gross_volume: sum(agentCalls.price_charged),
        builder_earnings: sum(agentCalls.builder_earned),
        average_latency_ms: avg(agentCalls.execution_ms),
      })
      .from(agentCalls)
      .innerJoin(agents, eq(agentCalls.agent_id, agents.id))
      .where(and(...conditions)),
    db
      .select({
        revision_id: agentCalls.agent_revision_id,
        revision_number: agentRevisions.revision_number,
        calls: count(),
        successes: sql<number>`count(*) filter (where ${agentCalls.status} = 'SUCCESS')`,
        gross_volume: sum(agentCalls.price_charged),
        builder_earnings: sum(agentCalls.builder_earned),
        average_latency_ms: avg(agentCalls.execution_ms),
      })
      .from(agentCalls)
      .innerJoin(agents, eq(agentCalls.agent_id, agents.id))
      .leftJoin(agentRevisions, eq(agentCalls.agent_revision_id, agentRevisions.id))
      .where(and(...conditions))
      .groupBy(agentCalls.agent_revision_id, agentRevisions.revision_number)
      .orderBy(desc(count())),
    db
      .select({ amount: sum(earningsClaims.amount), claims: count() })
      .from(earningsClaims)
      .where(
        and(
          eq(earningsClaims.builder_id, builder.id),
          gte(earningsClaims.created_at, from),
          lte(earningsClaims.created_at, to)
        )
      ),
  ])
  const calls = Number(summary?.calls ?? 0)
  const successes = Number(summary?.successes ?? 0)
  res.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      calls,
      successes,
      errors: Number(summary?.errors ?? 0),
      success_rate: calls === 0 ? 0 : successes / calls,
      gross_volume: Number(summary?.gross_volume ?? 0),
      builder_earnings: Number(summary?.builder_earnings ?? 0),
      claims: Number(claimSummary?.claims ?? 0),
      claimed_amount: Number(claimSummary?.amount ?? 0),
      average_latency_ms: Number(summary?.average_latency_ms ?? 0),
    },
    revisions: revisions.map((row) => ({
      ...row,
      calls: Number(row.calls),
      successes: Number(row.successes),
      success_rate: Number(row.calls) === 0 ? 0 : Number(row.successes) / Number(row.calls),
      gross_volume: Number(row.gross_volume ?? 0),
      builder_earnings: Number(row.builder_earnings ?? 0),
      average_latency_ms: Number(row.average_latency_ms ?? 0),
    })),
  })
})
