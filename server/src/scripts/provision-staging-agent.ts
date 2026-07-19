import 'dotenv/config'
import { and, eq } from 'drizzle-orm'
import { getAddress, isAddress } from 'viem'
import { db, pool } from '../db/client.js'
import {
  agentRevisions,
  agentTags,
  agents,
  builderEarnings,
  builders,
  creditBalances,
  users,
} from '../db/schema.js'
import { priceTierFor } from '../lib/constants.js'
import { closeRedis, ensureRedisConnected } from '../lib/redis.js'
import { encryptAgentSecret, generateAgentSecret } from '../lib/gateway/secrets.js'

const SLUG = 'phase2-synthetic-agent'
const PRICE = 1.2
const FREE_TIER_LIMIT = 10

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function assertPolicy(): { builderWallet: string; endpointUrl: string } {
  if (process.env.VELOSTRA_ENVIRONMENT !== 'staging') throw new Error('staging-only seed')
  if (process.env.ROBINHOOD_CHAIN_ID !== '46630') throw new Error('testnet-only seed')
  if (process.env.PHASE2_SYNTHETIC_AGENT_APPROVAL !== 'isolated-staging-agent-approved') {
    throw new Error('synthetic-agent approval sentinel is required')
  }
  if (process.env.AGENT_SECRET_ENCRYPTION_KEY_ID !== 'staging-primary') {
    throw new Error('staging agent key id is required')
  }
  const rawWallet = required('SYNTHETIC_AGENT_BUILDER_WALLET')
  if (!isAddress(rawWallet)) throw new Error('synthetic builder wallet is invalid')
  const builderWallet = getAddress(rawWallet)
  if (builderWallet === '0x0000000000000000000000000000000000000000') {
    throw new Error('synthetic builder wallet must be non-zero')
  }
  const endpoint = new URL(required('SYNTHETIC_AGENT_ENDPOINT_URL'))
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/execute'
  ) {
    throw new Error('synthetic endpoint must be credential-free HTTPS /execute')
  }
  return { builderWallet, endpointUrl: endpoint.toString() }
}

function monthKey(userId: string): string {
  const now = new Date()
  return `freetier:${userId}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function secondsUntilMonthEnd(): number {
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return Math.max(1, Math.floor((end.getTime() - now.getTime()) / 1000))
}

async function main(): Promise<void> {
  const { builderWallet, endpointUrl } = assertPolicy()
  const [existing] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1)
  let userId: string

  if (existing) {
    const [builder] = await db.select().from(builders).where(eq(builders.id, existing.builder_id)).limit(1)
    const [revision] = existing.active_revision_id
      ? await db
          .select()
          .from(agentRevisions)
          .where(
            and(
              eq(agentRevisions.id, existing.active_revision_id),
              eq(agentRevisions.agent_id, existing.id)
            )
          )
          .limit(1)
      : []
    if (
      !builder ||
      builder.status !== 'ACTIVE' ||
      getAddress(builder.wallet_address) !== builderWallet ||
      existing.endpoint_url !== endpointUrl ||
      existing.status !== 'APPROVED' ||
      Number(existing.price_per_call) !== PRICE ||
      !revision ||
      revision.status !== 'PUBLISHED' ||
      revision.endpoint_url !== endpointUrl ||
      Number(revision.price_per_call) !== PRICE
    ) {
      throw new Error('existing synthetic agent does not match the staging policy')
    }
    userId = builder.user_id
  } else {
    const [existingUser] = await db.select().from(users).where(eq(users.wallet_address, builderWallet)).limit(1)
    const created = await db.transaction(async (tx) => {
      const user = existingUser
        ? existingUser
        : (
            await tx
              .insert(users)
              .values({ wallet_address: builderWallet, display_name: 'Velostra Staging Synthetic' })
              .returning({ id: users.id })
          )[0]
      if (!user) throw new Error('synthetic user creation failed')

      const [balance] = await tx.select().from(creditBalances).where(eq(creditBalances.user_id, user.id)).limit(1)
      if (!balance) await tx.insert(creditBalances).values({ user_id: user.id })

      const [builder] = await tx
        .insert(builders)
        .values({
          user_id: user.id,
          wallet_address: builderWallet,
          display_name: 'Velostra Staging Synthetic',
          bio: 'Deterministic staging-only synthetic agent for release evidence.',
          status: 'ACTIVE',
          verified: false,
        })
        .onConflictDoNothing({ target: builders.user_id })
        .returning({ id: builders.id, user_id: builders.user_id, wallet_address: builders.wallet_address })
      const resolvedBuilder = builder ?? (await tx.select({ id: builders.id, user_id: builders.user_id, wallet_address: builders.wallet_address }).from(builders).where(eq(builders.user_id, user.id)).limit(1))[0]
      if (!resolvedBuilder) throw new Error('synthetic builder creation failed')
      if (getAddress(resolvedBuilder.wallet_address) !== builderWallet) {
        throw new Error('existing builder wallet does not match the synthetic staging wallet')
      }

      const [earnings] = await tx
        .insert(builderEarnings)
        .values({ builder_id: resolvedBuilder.id })
        .onConflictDoNothing({ target: builderEarnings.builder_id })
        .returning({ id: builderEarnings.id })
      void earnings

      const encryptedSecret = encryptAgentSecret(generateAgentSecret())
      const [agent] = await tx
        .insert(agents)
        .values({
          builder_id: resolvedBuilder.id,
          name: 'Velostra Staging Synthetic',
          slug: SLUG,
          description: 'Deterministic synthetic execution for isolated staging verification.',
          long_description: 'A non-production, non-persistent endpoint used only for Velostra release evidence.',
          category: 'DATA_ANALYSIS',
          endpoint_url: endpointUrl,
          secret_key_ciphertext: encryptedSecret,
          price_per_call: PRICE.toFixed(6),
          price_tier: priceTierFor(PRICE),
          status: 'APPROVED',
          featured: false,
        })
        .returning({ id: agents.id })
      if (!agent) throw new Error('synthetic agent creation failed')

      const [revision] = await tx
        .insert(agentRevisions)
        .values({
          agent_id: agent.id,
          revision_number: 1,
          status: 'PUBLISHED',
          name: 'Velostra Staging Synthetic',
          description: 'Deterministic synthetic execution for isolated staging verification.',
          long_description: 'A non-production, non-persistent endpoint used only for Velostra release evidence.',
          category: 'DATA_ANALYSIS',
          endpoint_url: endpointUrl,
          price_per_call: PRICE.toFixed(6),
          price_tier: priceTierFor(PRICE),
          created_by_user_id: user.id,
          published_at: new Date(),
        })
        .returning({ id: agentRevisions.id })
      if (!revision) throw new Error('synthetic agent revision creation failed')

      await tx
        .update(agents)
        .set({ active_revision_id: revision.id, updated_at: new Date() })
        .where(eq(agents.id, agent.id))
      await tx.insert(agentTags).values([
        { agent_id: agent.id, tag: 'staging' },
        { agent_id: agent.id, tag: 'synthetic' },
        { agent_id: agent.id, tag: 'deterministic' },
      ])
      return user.id
    })
    userId = created
  }

  const redis = await ensureRedisConnected()
  await redis.set(monthKey(userId), String(FREE_TIER_LIMIT), 'EX', secondsUntilMonthEnd())
  console.info(`PASS staging synthetic agent provisioned; slug=${SLUG}; free-tier exhausted`)
}

main()
  .catch(() => {
    console.error('[synthetic-seed] failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await closeRedis()
    await pool.end()
  })
