import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  adminAuditLogs,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEvents,
  webhookSubscriptions,
} from '../db/schema.js'
import { requireAuth, requireAdminPermission } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { cursorScope, decodeCursor, encodeCursor } from '../lib/platform/cursor.js'
import { sendPage } from '../lib/platform/http.js'

export const platformAdminRouter = Router()

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
})

platformAdminRouter.get(
  '/webhooks/dead-letter',
  requireAuth,
  requireAdminPermission('webhook:operate'),
  async (req, res) => {
    const parsed = pageQuery.safeParse(req.query)
    if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid dead-letter query')
    const scope = cursorScope({ resource: 'webhook-dead-letter' })
    const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
    const conditions = [eq(webhookDeliveries.status, 'DEAD_LETTER' as const)]
    if (boundary) {
      conditions.push(
        or(
          lt(webhookDeliveries.created_at, boundary.createdAt),
          and(eq(webhookDeliveries.created_at, boundary.createdAt), lt(webhookDeliveries.id, boundary.id))
        )!
      )
    }
    const rows = await db
      .select({
        id: webhookDeliveries.id,
        event_id: webhookEvents.id,
        event_type: webhookEvents.event_type,
        subscription_id: webhookSubscriptions.id,
        subscription_url: webhookSubscriptions.url,
        attempt_count: webhookDeliveries.attempt_count,
        last_status_code: webhookDeliveries.last_status_code,
        last_error: webhookDeliveries.last_error,
        created_at: webhookDeliveries.created_at,
        updated_at: webhookDeliveries.updated_at,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookDeliveries.event_id, webhookEvents.id))
      .innerJoin(webhookSubscriptions, eq(webhookDeliveries.subscription_id, webhookSubscriptions.id))
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.created_at), desc(webhookDeliveries.id))
      .limit(parsed.data.limit + 1)
    const hasMore = rows.length > parsed.data.limit
    const data = rows.slice(0, parsed.data.limit)
    const last = data.at(-1)
    return sendPage(res, data, {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
    })
  }
)

platformAdminRouter.get(
  '/webhooks/deliveries/:id/attempts',
  requireAuth,
  requireAdminPermission('webhook:operate'),
  async (req, res) => {
    const rows = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.delivery_id, req.params.id))
      .orderBy(desc(webhookDeliveryAttempts.attempt_number))
      .limit(100)
    res.json({ attempts: rows })
  }
)

platformAdminRouter.post(
  '/webhooks/deliveries/:id/replay',
  requireAuth,
  requireAdminPermission('webhook:operate'),
  async (req, res) => {
    const delivery = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, req.params.id))
        .for('update')
        .limit(1)
      if (!current) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Webhook delivery not found')
      if (current.status !== 'DEAD_LETTER') {
        throw new AppError(409, 'DELIVERY_NOT_DEAD_LETTER', 'Only a dead-letter delivery can be replayed')
      }
      const [updated] = await tx
        .update(webhookDeliveries)
        .set({
          status: 'PENDING',
          attempt_count: 0,
          next_attempt_at: new Date(),
          locked_until: null,
          last_error: null,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(webhookDeliveries.id, current.id),
            eq(webhookDeliveries.status, 'DEAD_LETTER')
          )
        )
        .returning()
      if (!updated) throw new AppError(409, 'DELIVERY_REPLAY_RACE', 'Delivery replay lost its race')
      await tx.insert(adminAuditLogs).values({
        actor_user_id: req.auth!.id,
        action: 'webhook.delivery.replay',
        target_type: 'webhook_delivery',
        target_id: updated.id,
        request_id: req.requestId,
        ip_address: req.ip,
        metadata: { previous_attempts: current.attempt_count },
      })
      return updated
    })
    res.json({ delivery })
  }
)

platformAdminRouter.post(
  '/webhooks/subscriptions/:id/pause',
  requireAuth,
  requireAdminPermission('webhook:operate'),
  async (req, res) => {
    const subscription = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(webhookSubscriptions)
        .set({ status: 'PAUSED', updated_at: new Date() })
        .where(eq(webhookSubscriptions.id, req.params.id))
        .returning({ id: webhookSubscriptions.id, status: webhookSubscriptions.status })
      if (!updated) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook subscription not found')
      await tx.insert(adminAuditLogs).values({
        actor_user_id: req.auth!.id,
        action: 'webhook.subscription.pause',
        target_type: 'webhook_subscription',
        target_id: updated.id,
        request_id: req.requestId,
        ip_address: req.ip,
        metadata: {},
      })
      return updated
    })
    res.json({ subscription })
  }
)
