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
import {
  SYNTHETIC_AGENT_CATALOG,
  type SyntheticAgentProfile,
} from '../synthetic-agent/catalog.js'

const RELEASE_PROFILE = SYNTHETIC_AGENT_CATALOG[0]
const SLUG = RELEASE_PROFILE.slug
const PRICE = RELEASE_PROFILE.price
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

function endpointForProfile(baseEndpointUrl: string, profile: SyntheticAgentProfile): string {
  const endpoint = new URL(baseEndpointUrl)
  endpoint.pathname = profile.endpointPath
  return endpoint.toString()
}

async function ensureDemoAgent(input: {
  profile: SyntheticAgentProfile
  builderId: string
  userId: string
  baseEndpointUrl: string
}): Promise<void> {
  const { profile, builderId, userId, baseEndpointUrl } = input
  const endpointUrl = endpointForProfile(baseEndpointUrl, profile)
  const tier = priceTierFor(profile.price)
  const [existing] = await db.select().from(agents).where(eq(agents.slug, profile.slug)).limit(1)

  if (existing) {
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
      existing.builder_id !== builderId ||
      existing.endpoint_url !== endpointUrl ||
      existing.status !== 'APPROVED' ||
      existing.name !== profile.name ||
      existing.description !== profile.description ||
      existing.long_description !== profile.longDescription ||
      existing.category !== profile.category ||
      Number(existing.price_per_call) !== profile.price ||
      existing.price_tier !== tier ||
      existing.featured !== profile.featured ||
      !revision ||
      revision.status !== 'PUBLISHED' ||
      revision.name !== profile.name ||
      revision.description !== profile.description ||
      revision.long_description !== profile.longDescription ||
      revision.category !== profile.category ||
      revision.price_tier !== tier ||
      revision.endpoint_url !== endpointUrl ||
      Number(revision.price_per_call) !== profile.price
    ) {
      throw new Error(`existing demo agent does not match catalog policy: ${profile.slug}`)
    }
    await db
      .insert(agentTags)
      .values(profile.tags.map((tag) => ({ agent_id: existing.id, tag })))
      .onConflictDoNothing()
    return
  }

  await db.transaction(async (tx) => {
    const encryptedSecret = encryptAgentSecret(generateAgentSecret())
    const [agent] = await tx
      .insert(agents)
      .values({
        builder_id: builderId,
        name: profile.name,
        slug: profile.slug,
        description: profile.description,
        long_description: profile.longDescription,
        category: profile.category,
        endpoint_url: endpointUrl,
        secret_key_ciphertext: encryptedSecret,
        price_per_call: profile.price.toFixed(6),
        price_tier: tier,
        status: 'APPROVED',
        featured: profile.featured,
      })
      .returning({ id: agents.id })
    if (!agent) throw new Error(`demo agent creation failed: ${profile.slug}`)

    const [revision] = await tx
      .insert(agentRevisions)
      .values({
        agent_id: agent.id,
        revision_number: 1,
        status: 'PUBLISHED',
        name: profile.name,
        description: profile.description,
        long_description: profile.longDescription,
        category: profile.category,
        endpoint_url: endpointUrl,
        price_per_call: profile.price.toFixed(6),
        price_tier: tier,
        change_summary: 'Initial public testnet demo scenario',
        created_by_user_id: userId,
        published_at: new Date(),
      })
      .returning({ id: agentRevisions.id })
    if (!revision) throw new Error(`demo revision creation failed: ${profile.slug}`)

    await tx
      .update(agents)
      .set({ active_revision_id: revision.id, updated_at: new Date() })
      .where(eq(agents.id, agent.id))
    await tx
      .insert(agentTags)
      .values(profile.tags.map((tag) => ({ agent_id: agent.id, tag })))
      .onConflictDoNothing()
  })
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

  const [catalogBuilder] = await db
    .select({ id: builders.id, wallet_address: builders.wallet_address })
    .from(builders)
    .where(eq(builders.user_id, userId))
    .limit(1)
  if (!catalogBuilder || getAddress(catalogBuilder.wallet_address) !== builderWallet) {
    throw new Error('synthetic catalog builder does not match the staging wallet')
  }

  const [releaseAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.slug, RELEASE_PROFILE.slug))
    .limit(1)
  if (!releaseAgent) throw new Error('release-evidence agent is missing after provisioning')
  await db
    .insert(agentTags)
    .values(RELEASE_PROFILE.tags.map((tag) => ({ agent_id: releaseAgent.id, tag })))
    .onConflictDoNothing()

  for (const profile of SYNTHETIC_AGENT_CATALOG.slice(1)) {
    await ensureDemoAgent({
      profile,
      builderId: catalogBuilder.id,
      userId,
      baseEndpointUrl: endpointUrl,
    })
  }

  const redis = await ensureRedisConnected()
  await redis.set(monthKey(userId), String(FREE_TIER_LIMIT), 'EX', secondsUntilMonthEnd())
  console.info(`PASS staging demo catalog provisioned; agents=${SYNTHETIC_AGENT_CATALOG.length}; free-tier exhausted`)
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
