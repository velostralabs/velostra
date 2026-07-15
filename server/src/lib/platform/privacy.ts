import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import {
  agentCalls,
  agentRevisions,
  agents,
  builders,
  creditBalances,
  earningsClaims,
  privacyRequests,
  reports,
  reviews,
  transactions,
  users,
} from '../../db/schema.js'
import { omitAgentSecret } from '../gateway/secrets.js'

const EXPORT_LIMIT = 10_000
type PlatformTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const PRIVACY_RETENTION_POLICY = {
  version: 1,
  erasable: [
    'display_name',
    'email',
    'avatar_url',
    'builder biography and social links',
    'agent call input/output',
    'review comments',
    'report descriptions and evidence',
  ],
  retained: [
    'wallet address used for authentication and onchain reconciliation',
    'financial ledger and settlement amounts',
    'transaction hashes and chain evidence',
    'security, moderation, and administrative audit records',
  ],
  reason: 'Financial and audit records remain only for reconciliation, fraud prevention, and legal accountability.',
} as const

export async function buildUserExport(userId: string) {
  const [profile] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const [builder] = await db.select().from(builders).where(eq(builders.user_id, userId)).limit(1)
  const [balance] = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.user_id, userId))
    .limit(1)
  const [builderAgents, calls, userReports, userReviews, requests, ledger, claims] = await Promise.all([
    builder
      ? db.select().from(agents).where(eq(agents.builder_id, builder.id)).orderBy(desc(agents.created_at)).limit(EXPORT_LIMIT)
      : Promise.resolve([]),
    db.select().from(agentCalls).where(eq(agentCalls.user_id, userId)).orderBy(desc(agentCalls.created_at)).limit(EXPORT_LIMIT),
    db.select().from(reports).where(eq(reports.user_id, userId)).orderBy(desc(reports.created_at)).limit(EXPORT_LIMIT),
    db.select().from(reviews).where(eq(reviews.user_id, userId)).orderBy(desc(reviews.created_at)).limit(EXPORT_LIMIT),
    db.select().from(privacyRequests).where(eq(privacyRequests.user_id, userId)).orderBy(desc(privacyRequests.created_at)).limit(EXPORT_LIMIT),
    balance
      ? db.select().from(transactions).where(eq(transactions.credit_balance_id, balance.id)).orderBy(desc(transactions.created_at)).limit(EXPORT_LIMIT)
      : Promise.resolve([]),
    builder
      ? db.select().from(earningsClaims).where(eq(earningsClaims.builder_id, builder.id)).orderBy(desc(earningsClaims.created_at)).limit(EXPORT_LIMIT)
      : Promise.resolve([]),
  ])
  const revisions = builderAgents.length === 0
    ? []
    : await db
      .select()
      .from(agentRevisions)
      .where(inArray(agentRevisions.agent_id, builderAgents.map((agent) => agent.id)))
      .limit(EXPORT_LIMIT)

  return {
    generated_at: new Date().toISOString(),
    policy: PRIVACY_RETENTION_POLICY,
    profile: profile ?? null,
    builder: builder ?? null,
    balance: balance ?? null,
    agents: builderAgents.map(omitAgentSecret),
    agent_revisions: revisions,
    calls,
    transactions: ledger.map((row) => ({ ...row, block_number: row.block_number?.toString() ?? null })),
    claims: claims.map((row) => ({ ...row, block_number: row.block_number?.toString() ?? null })),
    reports: userReports,
    reviews: userReviews,
    privacy_requests: requests,
    bounded_at: EXPORT_LIMIT,
  }
}

export async function anonymizeUserData(tx: PlatformTransaction, userId: string): Promise<void> {
  const [builder] = await tx
    .select({ id: builders.id })
    .from(builders)
    .where(eq(builders.user_id, userId))
    .limit(1)
  await tx
    .update(users)
    .set({ display_name: null, avatar_url: null, email: null, updated_at: new Date() })
    .where(eq(users.id, userId))
  await tx
    .update(agentCalls)
    .set({ input: '[redacted by completed privacy deletion request]', output: null, error_message: null })
    .where(eq(agentCalls.user_id, userId))
  await tx
    .update(reviews)
    .set({ comment: null })
    .where(eq(reviews.user_id, userId))
  await tx
    .update(reports)
    .set({ description: '[redacted by privacy request]', evidence: {}, updated_at: new Date() })
    .where(eq(reports.user_id, userId))
  if (builder) {
    await tx
      .update(builders)
      .set({
        display_name: `Deleted builder ${builder.id.slice(-6)}`,
        bio: null,
        website_url: null,
        twitter_url: null,
        github_url: null,
        updated_at: new Date(),
      })
      .where(eq(builders.id, builder.id))
  }
}
