import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { privacyRequestTypeEnum, privacyRequests } from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { buildUserExport, PRIVACY_RETENTION_POLICY } from '../lib/platform/privacy.js'
import { cursorScope, decodeCursor, encodeCursor } from '../lib/platform/cursor.js'
import { sendPage } from '../lib/platform/http.js'

export const platformPrivacyRouter = Router()
platformPrivacyRouter.use(requireAuth)

platformPrivacyRouter.get('/policy', (_req, res) => {
  res.json({ policy: PRIVACY_RETENTION_POLICY })
})

const requestSchema = z.object({
  type: z.enum(privacyRequestTypeEnum.enumValues),
  reason: z.string().max(500).optional(),
}).strict()

platformPrivacyRouter.post('/requests', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body)
  if (!parsed.success) throw new AppError(400, 'INVALID_PRIVACY_REQUEST', 'Invalid privacy request')
  const [active] = await db
    .select({ id: privacyRequests.id })
    .from(privacyRequests)
    .where(
      and(
        eq(privacyRequests.user_id, req.auth!.id),
        eq(privacyRequests.type, parsed.data.type),
        inArray(privacyRequests.status, ['PENDING', 'PROCESSING'])
      )
    )
    .limit(1)
  if (active) throw new AppError(409, 'PRIVACY_REQUEST_ACTIVE', 'A matching privacy request is already active')
  const [created] = await db
    .insert(privacyRequests)
    .values({
      user_id: req.auth!.id,
      type: parsed.data.type,
      request_reason: parsed.data.reason,
    })
    .returning()
  res.status(201).json({ request: created, policy: PRIVACY_RETENTION_POLICY })
})

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
})

platformPrivacyRouter.get('/requests', async (req, res) => {
  const parsed = pageQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid privacy request query')
  const scope = cursorScope({ resource: 'privacy-requests', userId: req.auth!.id })
  const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
  const conditions = [eq(privacyRequests.user_id, req.auth!.id)]
  if (boundary) {
    conditions.push(
      or(
        lt(privacyRequests.created_at, boundary.createdAt),
        and(eq(privacyRequests.created_at, boundary.createdAt), lt(privacyRequests.id, boundary.id))
      )!
    )
  }
  const rows = await db
    .select()
    .from(privacyRequests)
    .where(and(...conditions))
    .orderBy(desc(privacyRequests.created_at), desc(privacyRequests.id))
    .limit(parsed.data.limit + 1)
  const hasMore = rows.length > parsed.data.limit
  const data = rows.slice(0, parsed.data.limit)
  const last = data.at(-1)
  return sendPage(res, data, {
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
  })
})

platformPrivacyRouter.get('/requests/:id/export', async (req, res) => {
  const [request] = await db
    .select()
    .from(privacyRequests)
    .where(and(eq(privacyRequests.id, req.params.id), eq(privacyRequests.user_id, req.auth!.id)))
    .limit(1)
  if (!request) throw new AppError(404, 'PRIVACY_REQUEST_NOT_FOUND', 'Privacy request not found')
  if (request.type !== 'EXPORT' || request.status !== 'COMPLETED') {
    throw new AppError(409, 'PRIVACY_EXPORT_NOT_READY', 'Privacy export is not completed')
  }
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('Content-Disposition', `attachment; filename="velostra-export-${request.id}.json"`)
  res.json({ request_id: request.id, export: await buildUserExport(req.auth!.id) })
})
