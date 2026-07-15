import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  builders,
  webhookDeliveries,
  webhookDeliveryStatusEnum,
  webhookEvents,
  webhookSubscriptions,
} from '../db/schema.js'
import { requireAuth, requireBuilder } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { validateAgentEndpoint, EndpointSecurityError } from '../lib/gateway/ssrf.js'
import { encryptAgentSecret } from '../lib/gateway/secrets.js'
import { cursorScope, decodeCursor, encodeCursor } from '../lib/platform/cursor.js'
import { sendPage } from '../lib/platform/http.js'
import { newWebhookSecret, WEBHOOK_EVENT_TYPES } from '../lib/platform/webhooks.js'

export const platformWebhooksRouter = Router()
platformWebhooksRouter.use(requireAuth, requireBuilder)

async function builderFor(userId: string) {
  const [builder] = await db
    .select()
    .from(builders)
    .where(eq(builders.user_id, userId))
    .limit(1)
  if (!builder) throw new AppError(403, 'BUILDER_NOT_FOUND', 'Builder profile not found')
  return builder
}

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
})

const subscriptionSchema = z.object({
  url: z.string().url(),
  description: z.string().max(200).optional(),
  event_types: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length),
}).strict()

platformWebhooksRouter.post('/webhooks', async (req, res) => {
  const parsed = subscriptionSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_WEBHOOK_INPUT', 'Invalid webhook subscription', {
      details: parsed.error.flatten(),
    })
  }
  try {
    await validateAgentEndpoint(parsed.data.url)
  } catch (error) {
    if (error instanceof EndpointSecurityError) throw new AppError(400, error.code, error.message)
    throw error
  }
  const builder = await builderFor(req.auth!.id)
  const secret = newWebhookSecret()
  const [subscription] = await db
    .insert(webhookSubscriptions)
    .values({
      builder_id: builder.id,
      url: parsed.data.url,
      description: parsed.data.description,
      event_types: [...new Set(parsed.data.event_types)],
      secret_ciphertext: encryptAgentSecret(secret),
      secret_hint: secret.slice(-6),
    })
    .returning()
  const { secret_ciphertext: _ciphertext, ...safe } = subscription
  res.status(201).json({ subscription: safe, secret })
})

platformWebhooksRouter.get('/webhooks', async (req, res) => {
  const parsed = pageQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid webhook query')
  const builder = await builderFor(req.auth!.id)
  const scope = cursorScope({ resource: 'webhooks', builderId: builder.id })
  const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
  const conditions = [eq(webhookSubscriptions.builder_id, builder.id)]
  if (boundary) {
    conditions.push(
      or(
        lt(webhookSubscriptions.created_at, boundary.createdAt),
        and(
          eq(webhookSubscriptions.created_at, boundary.createdAt),
          lt(webhookSubscriptions.id, boundary.id)
        )
      )!
    )
  }
  const rows = await db
    .select({
      id: webhookSubscriptions.id,
      url: webhookSubscriptions.url,
      description: webhookSubscriptions.description,
      event_types: webhookSubscriptions.event_types,
      secret_hint: webhookSubscriptions.secret_hint,
      status: webhookSubscriptions.status,
      last_delivery_at: webhookSubscriptions.last_delivery_at,
      created_at: webhookSubscriptions.created_at,
      updated_at: webhookSubscriptions.updated_at,
    })
    .from(webhookSubscriptions)
    .where(and(...conditions))
    .orderBy(desc(webhookSubscriptions.created_at), desc(webhookSubscriptions.id))
    .limit(parsed.data.limit + 1)
  const hasMore = rows.length > parsed.data.limit
  const data = rows.slice(0, parsed.data.limit)
  const last = data.at(-1)
  return sendPage(res, data, {
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }, scope) : null,
  })
})

const statusSchema = z.object({ action: z.enum(['PAUSE', 'RESUME']) }).strict()

platformWebhooksRouter.patch('/webhooks/:id/status', async (req, res) => {
  const parsed = statusSchema.safeParse(req.body)
  if (!parsed.success) throw new AppError(400, 'INVALID_WEBHOOK_ACTION', 'Action must be PAUSE or RESUME')
  const builder = await builderFor(req.auth!.id)
  const [subscription] = await db
    .update(webhookSubscriptions)
    .set({
      status: parsed.data.action === 'PAUSE' ? 'PAUSED' : 'ACTIVE',
      updated_at: new Date(),
    })
    .where(
      and(
        eq(webhookSubscriptions.id, req.params.id),
        eq(webhookSubscriptions.builder_id, builder.id)
      )
    )
    .returning()
  if (!subscription) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook subscription not found')
  const { secret_ciphertext: _ciphertext, ...safe } = subscription
  res.json({ subscription: safe })
})

platformWebhooksRouter.post('/webhooks/:id/rotate-secret', async (req, res) => {
  const builder = await builderFor(req.auth!.id)
  const secret = newWebhookSecret()
  const [subscription] = await db
    .update(webhookSubscriptions)
    .set({
      secret_ciphertext: encryptAgentSecret(secret),
      secret_hint: secret.slice(-6),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(webhookSubscriptions.id, req.params.id),
        eq(webhookSubscriptions.builder_id, builder.id)
      )
    )
    .returning()
  if (!subscription) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook subscription not found')
  const { secret_ciphertext: _ciphertext, ...safe } = subscription
  res.json({ subscription: safe, secret })
})

platformWebhooksRouter.delete('/webhooks/:id', async (req, res) => {
  const builder = await builderFor(req.auth!.id)
  const [subscription] = await db
    .update(webhookSubscriptions)
    .set({ status: 'REVOKED', updated_at: new Date() })
    .where(
      and(
        eq(webhookSubscriptions.id, req.params.id),
        eq(webhookSubscriptions.builder_id, builder.id)
      )
    )
    .returning({ id: webhookSubscriptions.id, status: webhookSubscriptions.status })
  if (!subscription) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook subscription not found')
  res.json({ subscription })
})

const deliveryQuery = pageQuery.extend({
  status: z.enum(webhookDeliveryStatusEnum.enumValues).optional(),
})

platformWebhooksRouter.get('/webhooks/:id/deliveries', async (req, res) => {
  const parsed = deliveryQuery.safeParse(req.query)
  if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid delivery query')
  const builder = await builderFor(req.auth!.id)
  const [subscription] = await db
    .select({ id: webhookSubscriptions.id })
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.id, req.params.id),
        eq(webhookSubscriptions.builder_id, builder.id)
      )
    )
    .limit(1)
  if (!subscription) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook subscription not found')
  const scope = cursorScope({
    resource: 'webhook-deliveries',
    subscriptionId: subscription.id,
    status: parsed.data.status ?? null,
  })
  const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
  const conditions = [eq(webhookDeliveries.subscription_id, subscription.id)]
  if (parsed.data.status) conditions.push(eq(webhookDeliveries.status, parsed.data.status))
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
      status: webhookDeliveries.status,
      attempt_count: webhookDeliveries.attempt_count,
      next_attempt_at: webhookDeliveries.next_attempt_at,
      last_status_code: webhookDeliveries.last_status_code,
      last_error: webhookDeliveries.last_error,
      delivered_at: webhookDeliveries.delivered_at,
      created_at: webhookDeliveries.created_at,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEvents, eq(webhookDeliveries.event_id, webhookEvents.id))
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
})
