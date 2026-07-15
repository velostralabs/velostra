import { Router } from 'express'
import { and, desc, eq, ilike, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { agentCategoryEnum, agents, builders } from '../db/schema.js'
import { agentsRouter } from './agents.js'
import { builderRouter } from './builder.js'
import { dashboardRouter } from './dashboard.js'
import { adminRouter } from './admin.js'
import { authRouter } from './auth.js'
import { platformBuilderRouter } from './platform-builder.js'
import { platformWebhooksRouter } from './platform-webhooks.js'
import { platformAdminRouter } from './platform-admin.js'
import { platformTrustRouter } from './platform-trust.js'
import { platformPrivacyRouter } from './platform-privacy.js'
import { platformGovernanceAdminRouter } from './platform-governance-admin.js'
import { cursorScope, decodeCursor, encodeCursor } from '../lib/platform/cursor.js'
import { sendPage } from '../lib/platform/http.js'
import { moneyToNumber } from '../lib/money.js'

export const v1Router = Router()

const listQuery = z.object({
  category: z.enum(agentCategoryEnum.enumValues).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
})

v1Router.get('/agents', async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid marketplace query', code: 'INVALID_QUERY', details: parsed.error.flatten() })
  }
  const query = parsed.data
  const scope = cursorScope({ resource: 'agents', category: query.category ?? null, q: query.q ?? null })
  const boundary = query.cursor ? decodeCursor(query.cursor, scope) : undefined
  const conditions = [eq(agents.status, 'APPROVED')]
  if (query.category) conditions.push(eq(agents.category, query.category))
  if (query.q) conditions.push(ilike(agents.name, '%' + query.q + '%'))
  if (boundary) {
    conditions.push(
      or(
        lt(agents.created_at, boundary.createdAt),
        and(eq(agents.created_at, boundary.createdAt), lt(agents.id, boundary.id))
      )!
    )
  }

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
      created_at: agents.created_at,
      builder_name: builders.display_name,
      builder_verified: builders.verified,
    })
    .from(agents)
    .innerJoin(builders, eq(agents.builder_id, builders.id))
    .where(and(...conditions))
    .orderBy(desc(agents.created_at), desc(agents.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const pageRows = rows.slice(0, query.limit)
  const last = pageRows.at(-1)
  return sendPage(
    res,
    pageRows.map(({ created_at: _createdAt, builder_name, builder_verified, ...row }) => ({
      ...row,
      price_per_call: moneyToNumber(row.price_per_call),
      builder: { display_name: builder_name, verified: builder_verified },
    })),
    {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
    }
  )
})

v1Router.use('/auth', authRouter)
v1Router.use('/agents', agentsRouter)
v1Router.use('/builder', platformBuilderRouter)
v1Router.use('/builder', platformWebhooksRouter)
v1Router.use('/builder', builderRouter)
v1Router.use('/dashboard', dashboardRouter)
v1Router.use('/trust', platformTrustRouter)
v1Router.use('/privacy', platformPrivacyRouter)
v1Router.use('/admin', platformGovernanceAdminRouter)
v1Router.use('/admin', platformAdminRouter)
v1Router.use('/admin', adminRouter)
