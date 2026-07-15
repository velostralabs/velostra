import crypto from 'node:crypto'
import { and, arrayContains, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/client.js'
import {
  webhookDeliveries,
  webhookEvents,
  webhookSubscriptions,
} from '../../db/schema.js'

export const WEBHOOK_EVENT_TYPES = [
  'agent.revision.published',
  'agent.revision.rolled_back',
  'agent.approved',
  'agent.rejected',
  'call.settled',
  'claim.confirmed',
  'report.created',
  'report.resolved',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]
type PlatformTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function enqueueBuilderWebhook(
  tx: PlatformTransaction,
  input: {
    builderId: string
    eventType: WebhookEventType
    aggregateType: string
    aggregateId: string
    dedupeKey: string
    payload: Record<string, unknown>
  }
): Promise<string> {
  const [created] = await tx
    .insert(webhookEvents)
    .values({
      event_type: input.eventType,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      dedupe_key: input.dedupeKey,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: webhookEvents.dedupe_key })
    .returning({ id: webhookEvents.id })

  let eventId = created?.id
  if (!eventId) {
    const [existing] = await tx
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(eq(webhookEvents.dedupe_key, input.dedupeKey))
      .limit(1)
    if (!existing) throw new Error('Webhook event dedupe state is missing')
    eventId = existing.id
  }

  const subscriptions = await tx
    .select({ id: webhookSubscriptions.id })
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.builder_id, input.builderId),
        eq(webhookSubscriptions.status, 'ACTIVE'),
        arrayContains(webhookSubscriptions.event_types, [input.eventType])
      )
    )
  if (subscriptions.length > 0) {
    const deliveries = subscriptions.map((subscription) => ({
      event_id: eventId,
      subscription_id: subscription.id,
    }))
    if (deliveries.length > 0) {
      await tx.insert(webhookDeliveries).values(deliveries).onConflictDoNothing()
    }
  }
  return eventId
}

export function webhookBody(event: {
  id: string
  event_type: string
  created_at: Date
  payload: unknown
}): string {
  return JSON.stringify({
    id: event.id,
    type: event.event_type,
    created_at: event.created_at.toISOString(),
    data: event.payload,
  })
}

export function signWebhookBody(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + eventId + '.' + body)
    .digest('hex')
}

export function newWebhookSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function deliveryAttemptId(): string {
  return createId()
}
