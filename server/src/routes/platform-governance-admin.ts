import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  adminAuditLogs,
  agents,
  builders,
  moderationActions,
  privacyRequestStatusEnum,
  privacyRequests,
  reports,
  reportStatusEnum,
  telemetryClassificationEnum,
  telemetryFieldRegistry,
  userNotifications,
  users,
} from '../db/schema.js'
import { requireAuth, requireAdminPermission } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'
import { cursorScope, decodeCursor, encodeCursor } from '../lib/platform/cursor.js'
import { sendPage } from '../lib/platform/http.js'
import { anonymizeUserData, PRIVACY_RETENTION_POLICY } from '../lib/platform/privacy.js'
import { enqueueBuilderWebhook } from '../lib/platform/webhooks.js'

export const platformGovernanceAdminRouter = Router()

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
})

const reportQuery = pageQuery.extend({
  status: z.enum(reportStatusEnum.enumValues).default('PENDING'),
})

platformGovernanceAdminRouter.get(
  '/reports',
  requireAuth,
  requireAdminPermission('report:read'),
  async (req, res) => {
    const parsed = reportQuery.safeParse(req.query)
    if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid moderation queue query')
    const scope = cursorScope({ resource: 'moderation-reports', status: parsed.data.status })
    const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
    const conditions = [eq(reports.status, parsed.data.status)]
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
        reason: reports.reason,
        description: reports.description,
        evidence: reports.evidence,
        status: reports.status,
        assigned_to_user_id: reports.assigned_to_user_id,
        created_at: reports.created_at,
        updated_at: reports.updated_at,
        agent_id: agents.id,
        agent_name: agents.name,
        agent_slug: agents.slug,
        reporter_id: users.id,
        reporter_wallet: users.wallet_address,
      })
      .from(reports)
      .innerJoin(agents, eq(reports.agent_id, agents.id))
      .innerJoin(users, eq(reports.user_id, users.id))
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
  }
)

platformGovernanceAdminRouter.post(
  '/reports/:id/assign',
  requireAuth,
  requireAdminPermission('report:resolve'),
  async (req, res) => {
    const [report] = await db
      .update(reports)
      .set({ assigned_to_user_id: req.auth!.id, updated_at: new Date() })
      .where(
        and(
          eq(reports.id, req.params.id),
          or(eq(reports.status, 'PENDING'), eq(reports.status, 'REVIEWED'))
        )
      )
      .returning()
    if (!report) throw new AppError(409, 'REPORT_NOT_ASSIGNABLE', 'Report is missing or no longer assignable')
    res.json({ report })
  }
)

const transitions: Record<(typeof reportStatusEnum.enumValues)[number], readonly (typeof reportStatusEnum.enumValues)[number][]> = {
  PENDING: ['REVIEWED', 'WARNING_SENT', 'SUSPENDED', 'REMOVED'],
  REVIEWED: ['WARNING_SENT', 'SUSPENDED', 'REMOVED'],
  WARNING_SENT: ['SUSPENDED', 'REMOVED'],
  SUSPENDED: ['REMOVED'],
  REMOVED: [],
}

const resolveSchema = z.object({
  status: z.enum(['REVIEWED', 'WARNING_SENT', 'SUSPENDED', 'REMOVED']),
  note: z.string().min(3).max(1000),
}).strict()

platformGovernanceAdminRouter.post(
  '/reports/:id/resolve',
  requireAuth,
  requireAdminPermission('report:resolve'),
  async (req, res) => {
    const parsed = resolveSchema.safeParse(req.body)
    if (!parsed.success) throw new AppError(400, 'INVALID_REPORT_ACTION', 'Invalid moderation action')
    const report = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(reports)
        .where(eq(reports.id, req.params.id))
        .for('update')
        .limit(1)
      if (!current) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found')
      if (!transitions[current.status].includes(parsed.data.status)) {
        throw new AppError(409, 'REPORT_TRANSITION_INVALID', `Cannot move report from ${current.status} to ${parsed.data.status}`)
      }
      const [updated] = await tx
        .update(reports)
        .set({
          status: parsed.data.status,
          assigned_to_user_id: req.auth!.id,
          admin_note: parsed.data.note,
          updated_at: new Date(),
          resolved_at: new Date(),
        })
        .where(and(eq(reports.id, current.id), eq(reports.status, current.status)))
        .returning()
      if (!updated) throw new AppError(409, 'REPORT_RESOLUTION_RACE', 'Report resolution lost its race')

      if (updated.status === 'SUSPENDED' || updated.status === 'REMOVED') {
        await tx
          .update(agents)
          .set({ status: updated.status, updated_at: new Date() })
          .where(eq(agents.id, updated.agent_id))
      }
      await tx.insert(moderationActions).values({
        report_id: updated.id,
        actor_user_id: req.auth!.id,
        action: 'report.resolve',
        previous_status: current.status,
        next_status: updated.status,
        note: parsed.data.note,
        metadata: {},
      })
      await tx.insert(adminAuditLogs).values({
        actor_user_id: req.auth!.id,
        action: 'report.resolve',
        target_type: 'report',
        target_id: updated.id,
        request_id: req.requestId,
        ip_address: req.ip,
        metadata: { previous_status: current.status, status: updated.status },
      })
      await tx.insert(userNotifications).values({
        user_id: updated.user_id,
        type: 'report.resolved',
        title: 'Your report was reviewed',
        body: `Report ${updated.id} is now ${updated.status.replaceAll('_', ' ').toLowerCase()}.`,
        metadata: { report_id: updated.id, agent_id: updated.agent_id, status: updated.status },
      })
      const [owner] = await tx
        .select({ id: builders.id, user_id: builders.user_id })
        .from(builders)
        .innerJoin(agents, eq(agents.builder_id, builders.id))
        .where(eq(agents.id, updated.agent_id))
        .limit(1)
      if (owner) {
        await tx.insert(userNotifications).values({
          user_id: owner.user_id,
          type: 'report.resolved',
          title: 'Moderation decision recorded',
          body: `A report for your agent is now ${updated.status.replaceAll('_', ' ').toLowerCase()}.`,
          metadata: { report_id: updated.id, agent_id: updated.agent_id, status: updated.status },
        })
        await enqueueBuilderWebhook(tx, {
          builderId: owner.id,
          eventType: 'report.resolved',
          aggregateType: 'report',
          aggregateId: updated.id,
          dedupeKey: `report.resolved:${updated.id}:${updated.status}`,
          payload: { report_id: updated.id, agent_id: updated.agent_id, status: updated.status },
        })
      }
      return updated
    })
    res.json({ report })
  }
)

const privacyQuery = pageQuery.extend({
  status: z.enum(privacyRequestStatusEnum.enumValues).optional(),
})

platformGovernanceAdminRouter.get(
  '/privacy/requests',
  requireAuth,
  requireAdminPermission('privacy:operate'),
  async (req, res) => {
    const parsed = privacyQuery.safeParse(req.query)
    if (!parsed.success) throw new AppError(400, 'INVALID_QUERY', 'Invalid privacy queue query')
    const scope = cursorScope({ resource: 'privacy-admin', status: parsed.data.status ?? null })
    const boundary = parsed.data.cursor ? decodeCursor(parsed.data.cursor, scope) : undefined
    const conditions = []
    if (parsed.data.status) conditions.push(eq(privacyRequests.status, parsed.data.status))
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
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(privacyRequests.created_at), desc(privacyRequests.id))
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

const privacyActionSchema = z.object({
  action: z.enum(['START', 'COMPLETE', 'REJECT']),
  reason: z.string().min(3).max(1000).optional(),
}).strict()

platformGovernanceAdminRouter.post(
  '/privacy/requests/:id/process',
  requireAuth,
  requireAdminPermission('privacy:operate'),
  async (req, res) => {
    const parsed = privacyActionSchema.safeParse(req.body)
    if (!parsed.success || (parsed.data.action === 'REJECT' && !parsed.data.reason)) {
      throw new AppError(400, 'INVALID_PRIVACY_ACTION', 'Invalid privacy processing action')
    }
    const request = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(privacyRequests)
        .where(eq(privacyRequests.id, req.params.id))
        .for('update')
        .limit(1)
      if (!current) throw new AppError(404, 'PRIVACY_REQUEST_NOT_FOUND', 'Privacy request not found')
      if (!['PENDING', 'PROCESSING'].includes(current.status)) {
        throw new AppError(409, 'PRIVACY_REQUEST_TERMINAL', 'Privacy request is already terminal')
      }
      const nextStatus = parsed.data.action === 'START'
        ? 'PROCESSING' as const
        : parsed.data.action === 'COMPLETE'
          ? 'COMPLETED' as const
          : 'REJECTED' as const
      if (parsed.data.action === 'COMPLETE' && current.type === 'DELETE') {
        await anonymizeUserData(tx, current.user_id)
      }
      const resultManifest = parsed.data.action === 'COMPLETE'
        ? current.type === 'EXPORT'
          ? { ready: true, generated_on_download: true, bounded_records: 10_000 }
          : { anonymized: true, policy: PRIVACY_RETENTION_POLICY }
        : null
      const [updated] = await tx
        .update(privacyRequests)
        .set({
          status: nextStatus,
          result_manifest: resultManifest,
          rejection_reason: parsed.data.action === 'REJECT' ? parsed.data.reason : null,
          processed_at: parsed.data.action === 'START' ? null : new Date(),
          processed_by_user_id: req.auth!.id,
          updated_at: new Date(),
        })
        .where(and(eq(privacyRequests.id, current.id), eq(privacyRequests.status, current.status)))
        .returning()
      if (!updated) throw new AppError(409, 'PRIVACY_PROCESSING_RACE', 'Privacy processing lost its race')
      await tx.insert(adminAuditLogs).values({
        actor_user_id: req.auth!.id,
        action: `privacy.${parsed.data.action.toLowerCase()}`,
        target_type: 'privacy_request',
        target_id: updated.id,
        request_id: req.requestId,
        ip_address: req.ip,
        metadata: { type: updated.type, status: updated.status },
      })
      await tx.insert(userNotifications).values({
        user_id: updated.user_id,
        type: 'privacy.request.updated',
        title: 'Privacy request updated',
        body: `Your ${updated.type.toLowerCase()} request is now ${updated.status.toLowerCase()}.`,
        metadata: { request_id: updated.id, type: updated.type, status: updated.status },
      })
      return updated
    })
    res.json({ request })
  }
)

platformGovernanceAdminRouter.get(
  '/telemetry/fields',
  requireAuth,
  requireAdminPermission('telemetry:manage'),
  async (_req, res) => {
    const fields = await db
      .select()
      .from(telemetryFieldRegistry)
      .orderBy(telemetryFieldRegistry.field_name)
      .limit(500)
    res.json({ fields })
  }
)

const telemetrySchema = z.object({
  classification: z.enum(telemetryClassificationEnum.enumValues),
  purpose: z.string().min(3).max(500),
  owner: z.string().min(2).max(100),
  retention_days: z.number().int().min(0).max(3650),
  enabled: z.boolean(),
}).strict()

platformGovernanceAdminRouter.put(
  '/telemetry/fields/:name',
  requireAuth,
  requireAdminPermission('telemetry:manage'),
  async (req, res) => {
    const parsed = telemetrySchema.safeParse(req.body)
    if (!parsed.success) throw new AppError(400, 'INVALID_TELEMETRY_POLICY', 'Invalid telemetry field policy')
    if (parsed.data.classification === 'PROHIBITED' && parsed.data.enabled) {
      throw new AppError(409, 'PROHIBITED_TELEMETRY_ENABLED', 'Prohibited telemetry fields cannot be enabled')
    }
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(req.params.name)) {
      throw new AppError(400, 'INVALID_TELEMETRY_FIELD', 'Telemetry field name is invalid')
    }
    const field = await db.transaction(async (tx) => {
      const [updated] = await tx
        .insert(telemetryFieldRegistry)
        .values({ field_name: req.params.name, ...parsed.data })
        .onConflictDoUpdate({
          target: telemetryFieldRegistry.field_name,
          set: { ...parsed.data, updated_at: new Date() },
        })
        .returning()
      await tx.insert(adminAuditLogs).values({
        actor_user_id: req.auth!.id,
        action: 'telemetry.policy.upsert',
        target_type: 'telemetry_field',
        target_id: updated.field_name,
        request_id: req.requestId,
        ip_address: req.ip,
        metadata: { classification: updated.classification, enabled: updated.enabled },
      })
      return updated
    })
    res.json({ field })
  }
)
