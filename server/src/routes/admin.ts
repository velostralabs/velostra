import { Router } from 'express'
import { z } from 'zod'
import { asc, desc, eq, count, sum } from 'drizzle-orm'
import { db } from '../db/client.js'
import { agents, builders, users, reports, agentCalls, reportStatusEnum } from '../db/schema.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

export const adminRouter = Router()

adminRouter.use(requireAuth, requireAdmin)

// ─────────────────────────────────────────
// GET /api/admin/agents/pending
// ─────────────────────────────────────────

adminRouter.get('/agents/pending', async (_req, res) => {
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

  const list = rows.map((r) => ({
    ...r,
    builder: { display_name: r.builder_display_name, wallet_address: r.builder_wallet_address },
  }))

  res.json({ agents: list })
})

// ─────────────────────────────────────────
// POST /api/admin/agents/:id/decision
// ─────────────────────────────────────────

const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']) })

adminRouter.post('/agents/:id/decision', async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'decision must be APPROVE or REJECT' })

  const [agent] = await db
    .update(agents)
    .set({ status: parsed.data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' })
    .where(eq(agents.id, req.params.id))
    .returning()

  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  res.json({ agent })
})

// ─────────────────────────────────────────
// GET /api/admin/reports
// ─────────────────────────────────────────

adminRouter.get('/reports', async (req, res) => {
  const status = ((req.query.status as string) || 'PENDING') as (typeof reportStatusEnum.enumValues)[number]

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

  const list = rows.map((r) => ({
    ...r,
    agent: { name: r.agent_name, slug: r.agent_slug },
    user: { wallet_address: r.user_wallet },
  }))

  res.json({ reports: list })
})

const reportActionSchema = z.object({
  status: z.enum(['REVIEWED', 'WARNING_SENT', 'SUSPENDED', 'REMOVED']),
  admin_note: z.string().max(1000).optional(),
})

adminRouter.post('/reports/:id/resolve', async (req, res) => {
  const parsed = reportActionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid report action' })

  const [report] = await db
    .update(reports)
    .set({ status: parsed.data.status, admin_note: parsed.data.admin_note, resolved_at: new Date() })
    .where(eq(reports.id, req.params.id))
    .returning()

  if (!report) return res.status(404).json({ error: 'Report not found' })

  if (parsed.data.status === 'SUSPENDED' || parsed.data.status === 'REMOVED') {
    await db
      .update(agents)
      .set({ status: parsed.data.status === 'SUSPENDED' ? 'SUSPENDED' : 'REMOVED' })
      .where(eq(agents.id, report.agent_id))
  }

  res.json({ report })
})

// ─────────────────────────────────────────
// GET /api/admin/stats — platform overview
// ─────────────────────────────────────────

adminRouter.get('/stats', async (_req, res) => {
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
})
