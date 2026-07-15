import { pathToFileURL } from 'node:url'
import { and, eq, inArray, isNull, lte, max, or, sql } from 'drizzle-orm'
import { db, pool } from '../db/client.js'
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEvents,
  webhookSubscriptions,
} from '../db/schema.js'
import { decryptAgentSecret } from '../lib/gateway/secrets.js'
import { safeFetchAgent } from '../lib/gateway/ssrf.js'
import { deliveryAttemptId, signWebhookBody, webhookBody } from '../lib/platform/webhooks.js'
import { recordHeartbeat } from '../lib/observability/heartbeats.js'

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`)
  }
  return parsed
}

const batchSize = () => positiveInteger('WEBHOOK_BATCH_SIZE', 25, 100)
const maxAttempts = () => positiveInteger('WEBHOOK_MAX_ATTEMPTS', 8, 20)
const baseRetryMs = () => positiveInteger('WEBHOOK_RETRY_BASE_MS', 1_000, 60_000)
const maxRetryMs = () => positiveInteger('WEBHOOK_RETRY_MAX_MS', 60 * 60 * 1000, 24 * 60 * 60 * 1000)
const lockMs = () => positiveInteger('WEBHOOK_LOCK_MS', 60_000, 10 * 60 * 1000)

interface ClaimedDelivery {
  id: string
  attempt_count: number
  event_id: string
  subscription_id: string
  event_type: string
  event_created_at: Date
  payload: unknown
  url: string
  secret_ciphertext: string
}

async function claimBatch(): Promise<ClaimedDelivery[]> {
  const now = new Date()
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .innerJoin(
        webhookSubscriptions,
        eq(webhookDeliveries.subscription_id, webhookSubscriptions.id)
      )
      .where(
        and(
          inArray(webhookDeliveries.status, ['PENDING', 'RETRYING']),
          lte(webhookDeliveries.next_attempt_at, now),
          or(isNull(webhookDeliveries.locked_until), lte(webhookDeliveries.locked_until, now)),
          eq(webhookSubscriptions.status, 'ACTIVE')
        )
      )
      .orderBy(webhookDeliveries.next_attempt_at, webhookDeliveries.id)
      .limit(batchSize())
      .for('update', { skipLocked: true, of: webhookDeliveries })
    if (candidates.length === 0) return []

    const ids = candidates.map((row) => row.id)
    await tx
      .update(webhookDeliveries)
      .set({
        status: 'RETRYING',
        attempt_count: sql`${webhookDeliveries.attempt_count} + 1`,
        locked_until: new Date(now.getTime() + lockMs()),
        updated_at: now,
      })
      .where(inArray(webhookDeliveries.id, ids))

    return tx
      .select({
        id: webhookDeliveries.id,
        attempt_count: webhookDeliveries.attempt_count,
        event_id: webhookEvents.id,
        subscription_id: webhookSubscriptions.id,
        event_type: webhookEvents.event_type,
        event_created_at: webhookEvents.created_at,
        payload: webhookEvents.payload,
        url: webhookSubscriptions.url,
        secret_ciphertext: webhookSubscriptions.secret_ciphertext,
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookDeliveries.event_id, webhookEvents.id))
      .innerJoin(
        webhookSubscriptions,
        eq(webhookDeliveries.subscription_id, webhookSubscriptions.id)
      )
      .where(inArray(webhookDeliveries.id, ids))
  })
}

function retryDelay(attempt: number): number {
  return Math.min(maxRetryMs(), baseRetryMs() * 2 ** Math.max(0, attempt - 1))
}

async function deliver(delivery: ClaimedDelivery): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const body = webhookBody({
    id: delivery.event_id,
    event_type: delivery.event_type,
    created_at: delivery.event_created_at,
    payload: delivery.payload,
  })
  const signature = signWebhookBody(
    decryptAgentSecret(delivery.secret_ciphertext),
    timestamp,
    delivery.event_id,
    body
  )
  const started = Date.now()
  let status: number | undefined
  let failure: unknown
  try {
    const response = await safeFetchAgent(delivery.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Velostra-Webhook/1.0',
        'x-velostra-event-id': delivery.event_id,
        'x-velostra-event-type': delivery.event_type,
        'x-velostra-timestamp': timestamp,
        'x-velostra-signature': signature,
      },
      body,
    })
    status = response.status
    if (!response.ok) throw new Error(`Webhook endpoint returned HTTP ${response.status}`)
  } catch (error) {
    failure = error
  }

  const duration = Date.now() - started
  await db.transaction(async (tx) => {
    const [previousAttempt] = await tx
      .select({ value: max(webhookDeliveryAttempts.attempt_number) })
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.delivery_id, delivery.id))
    const attemptNumber = Number(previousAttempt?.value ?? 0) + 1
    await tx.insert(webhookDeliveryAttempts).values({
      id: deliveryAttemptId(),
      delivery_id: delivery.id,
      attempt_number: attemptNumber,
      request_timestamp: timestamp,
      signature,
      response_status: status,
      error_code: failure instanceof Error ? failure.name : failure ? 'DELIVERY_FAILED' : null,
      duration_ms: duration,
    })
    if (!failure) {
      await tx
        .update(webhookDeliveries)
        .set({
          status: 'DELIVERED',
          locked_until: null,
          last_status_code: status,
          last_error: null,
          delivered_at: new Date(),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(webhookDeliveries.id, delivery.id),
            eq(webhookDeliveries.attempt_count, delivery.attempt_count)
          )
        )
      await tx
        .update(webhookSubscriptions)
        .set({ last_delivery_at: new Date(), updated_at: new Date() })
        .where(eq(webhookSubscriptions.id, delivery.subscription_id))
      return
    }

    const exhausted = delivery.attempt_count >= maxAttempts()
    await tx
      .update(webhookDeliveries)
      .set({
        status: exhausted ? 'DEAD_LETTER' : 'RETRYING',
        locked_until: null,
        last_status_code: status,
        last_error: failure instanceof Error ? failure.message.slice(0, 1000) : 'Webhook delivery failed',
        next_attempt_at: exhausted
          ? new Date()
          : new Date(Date.now() + retryDelay(delivery.attempt_count)),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(webhookDeliveries.id, delivery.id),
          eq(webhookDeliveries.attempt_count, delivery.attempt_count)
        )
      )
  })
}

export async function processWebhookBatch(): Promise<{ claimed: number; delivered: number }> {
  const batch = await claimBatch()
  let delivered = 0
  for (const item of batch) {
    await deliver(item)
    const [state] = await db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, item.id))
      .limit(1)
    if (state?.status === 'DELIVERED') delivered += 1
  }
  await recordHeartbeat('webhook-worker', batch.length === 0 ? 'ok' : 'ok', {
    claimed: batch.length,
    delivered,
  })
  return { claimed: batch.length, delivered }
}

async function main() {
  const watch = process.argv.includes('--watch')
  const interval = positiveInteger('WEBHOOK_INTERVAL_MS', 5_000, 5 * 60 * 1000)
  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  do {
    try {
      const result = await processWebhookBatch()
      console.info('[webhooks] batch complete', result)
    } catch (error) {
      console.error('[webhooks] worker iteration failed', error)
      await recordHeartbeat('webhook-worker', 'failed', {
        error: error instanceof Error ? error.name : 'UnknownError',
      }).catch(() => undefined)
      if (!watch) throw error
    }
    if (watch && !stopping) await new Promise((resolve) => setTimeout(resolve, interval))
  } while (watch && !stopping)
  await pool.end()
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  main().catch(async (error) => {
    console.error('[webhooks] fatal', error)
    await pool.end().catch(() => undefined)
    process.exitCode = 1
  })
}
