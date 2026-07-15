import os from 'node:os'
import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { operationalHeartbeats } from '../../db/schema.js'

export type HeartbeatStatus = 'ok' | 'degraded' | 'failed'

export async function recordHeartbeat(
  serviceName: string,
  status: HeartbeatStatus = 'ok',
  details: Record<string, unknown> = {}
): Promise<void> {
  const now = new Date()
  await db
    .insert(operationalHeartbeats)
    .values({
      service_name: serviceName,
      instance_id: process.env.VELOSTRA_INSTANCE_ID ?? os.hostname(),
      release: process.env.VELOSTRA_RELEASE ?? 'development',
      status,
      details,
      last_seen_at: now,
    })
    .onConflictDoUpdate({
      target: operationalHeartbeats.service_name,
      set: {
        instance_id: process.env.VELOSTRA_INSTANCE_ID ?? os.hostname(),
        release: process.env.VELOSTRA_RELEASE ?? 'development',
        status,
        details,
        last_seen_at: now,
      },
    })
}

export async function heartbeatAgeSeconds(serviceName: string): Promise<number | undefined> {
  const [row] = await db
    .select({ lastSeenAt: operationalHeartbeats.last_seen_at })
    .from(operationalHeartbeats)
    .where(eq(operationalHeartbeats.service_name, serviceName))
    .limit(1)
  if (!row) return undefined
  return Math.max(0, (Date.now() - row.lastSeenAt.getTime()) / 1_000)
}
