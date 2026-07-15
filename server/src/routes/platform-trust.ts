import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq, gte, lt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  agentCalls,
  agents,
  builders,
  moderationActions,
  reportReasonEnum,
  reports,
  userNotifications,
} from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { checkRateLimit } from '../lib/gateway/ratelimit.js'
import { enqueueBuilderWebhook } from '../lib/platform/webhooks.js'
import { cursorScope, decodeCursor, encodeCursor } from '../lib/platform/cursor.js'
import { sendPage } from '../lib/platform/http.js'

export const platformTrustRouter = Router()
platformTrustRouter.use(requireAuth)

const referenceUrl = z.string().url().max(500).refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
}, 'reference_url must be HTTPS without credentials, query, or fragment')

const evidenceSchema = z.object({
  call_id: z.string().min(1).max(128).optional(),
  transaction_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  reference_url: referenceUrl.optional(),
  observed_at: z.string().datetime().optional(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict()

const createReportSchema = z.object({
  reason: z.enum(reportReasonEnum.enumValues),
  description: z.string().min(10).max(4000),
  evidence: evidenceSchema.default({}),
}).strict()

platformTrustRouter.post('/agents/:id/reports', async (req, res) => {
  const parsed = createReportSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_REPORT_INPUT', 'Invalid report evidence', {
      details: parsed.error.flatten(),
    })
  }
  const rate = await checkRateLimit('report:' + req.auth!.id)
  if (!rate.allowed) throw new AppError(429, 'REPORT_RATE_LIMITED', 'Too many reports; try again later')

  const [agent] = await db
    .select({ id: agents.id, name: agents.name, builder_id: agents.builder_id, status: agents.status })
    .from(agents)
    .where(eq(agents.id, req.params.id))
    .limit(1)
  if (!agent || agent.status === 'REMOVED') throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found')

  if (parsed.data.evidence.call_id) {
    const [call] = await db
      .select({ id: agentCalls.id })
      .from(agentCalls)
      .where(
        and(
          eq(agentCalls.id, parsed.data.evidence.call_id),
          eq(agentCalls.user_id, req.auth!.id),
          eq(agentCalls.agent_id, agent.id)
        )
      )
      .limit(1)
    if (!call) throw new AppError(400, 'REPORT_CALL_NOT_OWNED', 'Referenced call does not belong to this user and agent')
  }

  const [duplicate] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.user_id, req.auth!.id),
        eq(reports.agent_id, agent.id),
        eq(reports.reason, parsed.data.reason),
        gte(reports.created_at, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    )
    .limit(1)
  if (duplicate) throw new AppError(409, 'REPORT_DUPLICATE', 'A matching report was already submitted recently')

  const report = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(reports)
      .values({
        agent_id: agent.id,
        user_id: req.auth!.id,
        reason: parsed.data.reason,
        description: parsed.data.description,
        evidence: parsed.data.evidence,
      })
      .returning()
    await tx.insert(moderationActions).values({
      report_id: created.id,
      actor_user_id: req.auth!.id,
      action: 'report.created',
      previous_status: null,
      next_status: 'PENDING',
      metadata: { evidence_fields: Object.keys(parsed.data.evidence).sort() },
    })
    const [builder] = await tx
      .select({ id: builders.id, user_id: builders.user_id })
      .from(builders)
      .where(eq(builders.id, agent.builder_id))
      .limit(1)
    if (builder) {
      await tx.insert(userNotifications).values({
        user_id: builder.user_id,
        type: 'report.created',
        title: 'A user report requires review',
        body: `${agent.name} received a ${created.reason.replaceAll('_', ' ').toLowerCase()} report.`,
        metadata: { report_id: created.id, agent_id: agent.id, reason: created.reason },
      })
      await enqueueBuilderWebhook(tx, {
        builderId: builder.id,
        eventType: 'report.created',
        aggregateType: 'report',
        aggregateId: created.id,
        dedupeKey: `report.created:${created.id}`,
        payload: { report_id: created.id, agent_id: agent.id, reason: created.reason, status: created.status },
      })
    }
    return created
  })
  res.status(201).json({ report })
})

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
})

platformTrustRouter.get('/reports', async (req, res) => {
  const parsed = pageQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid report history query')
  const scope = cursorScope({ resource: 'user-reports', userId: req.auth!.id })
  const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
  const conditions = [eq(reports.user_id, req.auth!.id)]
  if (boundary) {
    conditions.push(
      or(
        lt(reports.created_at, boundary.createdAt),
        and(eq(reports.created_at, boundary.createdAt), lt(reports.id, boundary.id))
      )!
    )
  }
  const rows = await db
    .select({
      id: reports.id,
      agent_id: reports.agent_id,
      agent_name: agents.name,
      reason: reports.reason,
      description: reports.description,
      evidence: reports.evidence,
      status: reports.status,
      created_at: reports.created_at,
      updated_at: reports.updated_at,
      resolved_at: reports.resolved_at,
    })
    .from(reports)
    .innerJoin(agents, eq(reports.agent_id, agents.id))
    .where(and(...conditions))
    .orderBy(desc(reports.created_at), desc(reports.id))
    .limit(parsed.data.limit + 1)
  const hasMore = rows.length > parsed.data.limit
  const data = rows.slice(0, parsed.data.limit)
  const last = data.at(-1)
  return sendPage(res, data, {
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
  })
})
