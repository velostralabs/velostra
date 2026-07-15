import { Router, type Request } from 'express'
import { moneyToNumber } from '../lib/money.js'
import { z } from 'zod'
import { and, asc, count, desc, eq, isNull, sql, sum } from 'drizzle-orm'
import { getAddress, isAddress } from 'viem'
import { db } from '../db/client.js'
import {
  adminAuditLogs,
  adminRoleAssignments,
  adminRoleEnum,
  agents,
  builders,
  users,
  reports,
  agentCalls,
  reportStatusEnum,
} from '../db/schema.js'
import { requireAuth, requireAdminPermission } from '../middleware/auth.js'
import { AppError } from '../lib/errors.js'

export const adminRouter = Router()
const adminOnly = [requireAuth]

function auditValues(req: Request, event: {
  action: string
  targetType: string
  targetId?: string
  metadata?: Record<string, unknown>
}) {
  return {
    actor_user_id: req.auth!.id,
    action: event.action,
    target_type: event.targetType,
    target_id: event.targetId,
    request_id: req.requestId,
    ip_address: req.ip,
    metadata: event.metadata ?? {},
  }
}

adminRouter.get(
  '/agents/pending',
  ...adminOnly,
  requireAdminPermission('agent:read'),
  async (_req, res) => {
    const rows = await db
      .select({
        id: agents.id,
        name: agents.name,
        price_per_call: agents.price_per_call,
        category: agents.category,
        created_at: agents.created_at,
        builder_display_name: builders.display_name,
        builder_wallet_address: builders.wallet_address,
      })
      .from(agents)
      .innerJoin(builders, eq(agents.builder_id, builders.id))
      .where(eq(agents.status, 'PENDING'))
      .orderBy(asc(agents.created_at))

    res.json({
      agents: rows.map((row) => ({
        ...row,
        price_per_call: moneyToNumber(row.price_per_call),
        builder: {
          display_name: row.builder_display_name,
          wallet_address: row.builder_wallet_address,
        },
      })),
    })
  }
)

const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) })

adminRouter.post(
  '/agents/:id/decision',
  ...adminOnly,
  requireAdminPermission('agent:decide'),
  async (req, res) => {
    const parsed = decisionSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        error: 'decision must be APPROVE or REJECT',
        code: 'INVALID_AGENT_DECISION',
      })
    }

    const agent = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(agents)
        .set({
          status: parsed.data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          updated_at: new Date(),
        })
        .where(eq(agents.id, req.params.id))
        .returning()
      if (!updated) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found')

      await tx.insert(adminAuditLogs).values(auditValues(req, {
        action: 'agent.decision',
        targetType: 'agent',
        targetId: updated.id,
        metadata: { decision: parsed.data.decision },
      }))
      return updated
    })

    res.json({ agent })
  }
)

adminRouter.get(
  '/reports',
  ...adminOnly,
  requireAdminPermission('report:read'),
  async (req, res) => {
    const requested = (req.query.status as string) || 'PENDING'
    if (!(reportStatusEnum.enumValues as readonly string[]).includes(requested)) {
      return res.status(400).json({ error: 'Invalid report status', code: 'INVALID_REPORT_STATUS' })
    }
    const status = requested as (typeof reportStatusEnum.enumValues)[number]
    const rows = await db
      .select({
        id: reports.id,
        reason: reports.reason,
        description: reports.description,
        status: reports.status,
        created_at: reports.created_at,
        agent_name: agents.name,
        agent_slug: agents.slug,
        user_wallet: users.wallet_address,
      })
      .from(reports)
      .innerJoin(agents, eq(reports.agent_id, agents.id))
      .innerJoin(users, eq(reports.user_id, users.id))
      .where(eq(reports.status, status))
      .orderBy(desc(reports.created_at))

    res.json({
      reports: rows.map((row) => ({
        ...row,
        agent: { name: row.agent_name, slug: row.agent_slug },
        user: { wallet_address: row.user_wallet },
      })),
    })
  }
)

const reportActionSchema = z.object({
  status: z.enum(['REVIEWED', 'WARNING_SENT', 'SUSPENDED', 'REMOVED']),
  admin_note: z.string().max(1000).optional(),
})

adminRouter.post(
  '/reports/:id/resolve',
  ...adminOnly,
  requireAdminPermission('report:resolve'),
  async (req, res) => {
    const parsed = reportActionSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid report action', code: 'INVALID_REPORT_ACTION' })
    }

    const report = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(reports)
        .set({
          status: parsed.data.status,
          admin_note: parsed.data.admin_note,
          resolved_at: new Date(),
        })
        .where(eq(reports.id, req.params.id))
        .returning()
      if (!updated) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found')

      if (parsed.data.status === 'SUSPENDED' || parsed.data.status === 'REMOVED') {
        await tx
          .update(agents)
          .set({
            status: parsed.data.status === 'SUSPENDED' ? 'SUSPENDED' : 'REMOVED',
            updated_at: new Date(),
          })
          .where(eq(agents.id, updated.agent_id))
      }
      await tx.insert(adminAuditLogs).values(auditValues(req, {
        action: 'report.resolve',
        targetType: 'report',
        targetId: updated.id,
        metadata: { status: parsed.data.status },
      }))
      return updated
    })

    res.json({ report })
  }
)

adminRouter.get(
  '/stats',
  ...adminOnly,
  requireAdminPermission('stats:read'),
  async (_req, res) => {
    const [[userCount], [builderCount], [agentCount], [volume]] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(builders).where(eq(builders.status, 'ACTIVE')),
      db.select({ value: count() }).from(agents).where(eq(agents.status, 'APPROVED')),
      db.select({
        totalCharged: sum(agentCalls.price_charged),
        totalPlatform: sum(agentCalls.platform_earned),
        totalCalls: count(),
      }).from(agentCalls),
    ])

    res.json({
      total_users: userCount.value,
      active_builders: builderCount.value,
      live_agents: agentCount.value,
      total_volume: Number(volume?.totalCharged ?? 0),
      platform_revenue: Number(volume?.totalPlatform ?? 0),
      total_calls: volume?.totalCalls ?? 0,
    })
  }
)

adminRouter.get(
  '/roles',
  ...adminOnly,
  requireAdminPermission('rbac:manage'),
  async (_req, res) => {
    const assignments = await db
      .select({
        id: adminRoleAssignments.id,
        role: adminRoleAssignments.role,
        wallet_address: users.wallet_address,
        granted_at: adminRoleAssignments.granted_at,
        revoked_at: adminRoleAssignments.revoked_at,
      })
      .from(adminRoleAssignments)
      .innerJoin(users, eq(adminRoleAssignments.user_id, users.id))
      .orderBy(asc(users.wallet_address), asc(adminRoleAssignments.role))
    res.json({ assignments })
  }
)

const roleMutationSchema = z.object({
  wallet_address: z.string().refine(isAddress, 'Invalid EVM wallet address'),
  role: z.enum(adminRoleEnum.enumValues),
})

adminRouter.post(
  '/roles/grant',
  ...adminOnly,
  requireAdminPermission('rbac:manage'),
  async (req, res) => {
    const parsed = roleMutationSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid wallet_address and role are required', code: 'INVALID_ROLE_GRANT' })
    }
    const walletAddress = getAddress(parsed.data.wallet_address)
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.wallet_address}) = ${walletAddress.toLowerCase()}`)
      .limit(1)
    if (!target) throw new AppError(404, 'ADMIN_TARGET_NOT_FOUND', 'Target wallet must sign in before receiving a role')

    const assignment = await db.transaction(async (tx) => {
      const [updated] = await tx
        .insert(adminRoleAssignments)
        .values({
          user_id: target.id,
          role: parsed.data.role,
          granted_by: req.auth!.id,
        })
        .onConflictDoUpdate({
          target: [adminRoleAssignments.user_id, adminRoleAssignments.role],
          set: {
            granted_by: req.auth!.id,
            granted_at: new Date(),
            revoked_at: null,
          },
        })
        .returning()
      await tx.insert(adminAuditLogs).values(auditValues(req, {
        action: 'admin_role.grant',
        targetType: 'user',
        targetId: target.id,
        metadata: { role: parsed.data.role, wallet_address: walletAddress },
      }))
      return updated
    })
    res.json({ assignment })
  }
)

adminRouter.post(
  '/roles/revoke',
  ...adminOnly,
  requireAdminPermission('rbac:manage'),
  async (req, res) => {
    const parsed = roleMutationSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid wallet_address and role are required', code: 'INVALID_ROLE_REVOKE' })
    }
    const walletAddress = getAddress(parsed.data.wallet_address)
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.wallet_address}) = ${walletAddress.toLowerCase()}`)
      .limit(1)
    if (!target) throw new AppError(404, 'ADMIN_TARGET_NOT_FOUND', 'Target admin user was not found')

    const assignment = await db.transaction(async (tx) => {
      if (parsed.data.role === 'SUPER_ADMIN') {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('velostra:super-admin'))`)
        const [row] = await tx
          .select({ value: count() })
          .from(adminRoleAssignments)
          .where(
            and(
              eq(adminRoleAssignments.role, 'SUPER_ADMIN'),
              isNull(adminRoleAssignments.revoked_at)
            )
          )
        if ((row?.value ?? 0) <= 1) {
          throw new AppError(409, 'LAST_SUPER_ADMIN', 'The final active super admin cannot be revoked')
        }
      }

      const [updated] = await tx
        .update(adminRoleAssignments)
        .set({ revoked_at: new Date() })
        .where(
          and(
            eq(adminRoleAssignments.user_id, target.id),
            eq(adminRoleAssignments.role, parsed.data.role),
            isNull(adminRoleAssignments.revoked_at)
          )
        )
        .returning()
      if (!updated) throw new AppError(404, 'ADMIN_ROLE_NOT_FOUND', 'Active role assignment was not found')

      await tx.insert(adminAuditLogs).values(auditValues(req, {
        action: 'admin_role.revoke',
        targetType: 'user',
        targetId: target.id,
        metadata: { role: parsed.data.role, wallet_address: walletAddress },
      }))
      return updated
    })
    res.json({ assignment })
  }
)

adminRouter.get(
  '/audit-log',
  ...adminOnly,
  requireAdminPermission('audit:read'),
  async (req, res) => {
    const parsedLimit = Number(req.query.limit ?? 50)
    const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50
    const entries = await db
      .select()
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.created_at))
      .limit(limit)
    res.json({ audit_log: entries })
  }
)