import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { db, pool } from '../src/db/client.js'
import {
  agentCalls,
  agents,
  builders,
  releaseCanaryAdmissions,
  users,
} from '../src/db/schema.js'
import { persistPhase3CanaryAdmission } from '../src/lib/phase3-canary-db.js'
import type { Phase3CanaryAdmission } from '../src/lib/phase3-canary.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point to a migrated disposable Postgres database')
}

const suffix = Date.now().toString(36)
const builderUserId = 'p3-builder-user-' + suffix
const callerUserId = 'p3-caller-user-' + suffix
const builderId = 'p3-builder-' + suffix
const agentId = 'p3-agent-' + suffix
const firstCallId = 'p3-call-a-' + suffix
const secondCallId = 'p3-call-b-' + suffix
const rollbackCallId = 'p3-call-rollback-' + suffix
const rotatedManifestCallId = 'p3-call-rotated-manifest-' + suffix
const wallet = '0x6000000000000000000000000000000000000006'
const builderWallet = '0x7000000000000000000000000000000000000007'

const policy = {
  schemaVersion: 1,
  kind: 'velostra-phase3-canary-policy',
  environment: 'phase3-db-test',
  enabled: true,
  allowlists: {
    wallets: [wallet],
    agents: [agentId],
    builders: [builderWallet],
  },
  limits: {
    durationSeconds: 3600,
    maxCalls: 1,
    maxGrossPerCallMinor: '500000',
    maxGrossPerWalletMinor: '500000',
    maxGrossTotalMinor: '500000',
  },
  requiredFlow: ['paid-call', 'zero-drift'],
  stopActions: [
    'disable-paid-writes',
    'preserve-builder-claims',
    'keep-reconciliation-running',
  ],
  rollback: {
    destructiveDatabaseRollbackAllowed: false,
    strategy: 'pause-new-risk-and-forward-repair',
    preserveClaims: true,
    preserveReconciliation: true,
  },
}

function admission(): Phase3CanaryAdmission {
  return {
    mode: 'canary',
    release: 'a'.repeat(40),
    manifestSha256: 'b'.repeat(64),
    policySha256: 'c'.repeat(64),
    walletAddress: wallet,
    agentId,
    builderAddress: builderWallet,
    grossMinor: 500000n,
    policy,
  }
}

try {
  await db.insert(users).values([
    {
      id: builderUserId,
      wallet_address: '0x7100000000000000000000000000000000000007',
    },
    {
      id: callerUserId,
      wallet_address: wallet,
    },
  ])
  await db.insert(builders).values({
    id: builderId,
    user_id: builderUserId,
    wallet_address: builderWallet,
    display_name: 'Phase 3 Canary Test Builder',
  })
  await db.insert(agents).values({
    id: agentId,
    builder_id: builderId,
    name: 'Phase 3 Canary Test Agent',
    slug: agentId,
    description: 'Tests transaction-serialized Phase 3 admission.',
    category: 'PRODUCTIVITY',
    endpoint_url: 'https://agent.invalid/run',
    secret_key_ciphertext: 'test-secret',
    price_per_call: '0.500000',
    status: 'APPROVED',
  })
  await db.insert(agentCalls).values([
    {
      id: firstCallId,
      agent_id: agentId,
      user_id: callerUserId,
      input: 'first concurrent canary call',
      status: 'PROCESSING',
      is_free_tier: false,
    },
    {
      id: secondCallId,
      agent_id: agentId,
      user_id: callerUserId,
      input: 'second concurrent canary call',
      status: 'PROCESSING',
      is_free_tier: false,
    },
    {
      id: rollbackCallId,
      agent_id: agentId,
      user_id: callerUserId,
      input: 'rolled back canary call',
      status: 'PROCESSING',
      is_free_tier: false,
    },
    {
      id: rotatedManifestCallId,
      agent_id: agentId,
      user_id: callerUserId,
      input: 'manifest rotation must not reset canary capacity',
      status: 'PROCESSING',
      is_free_tier: false,
    },
  ])

  const outcomes = await Promise.allSettled([
    db.transaction((tx) => persistPhase3CanaryAdmission(tx, firstCallId, admission())),
    db.transaction((tx) => persistPhase3CanaryAdmission(tx, secondCallId, admission())),
  ])
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1)
  const [rows] = await Promise.all([
    db
      .select()
      .from(releaseCanaryAdmissions)
      .where(eq(releaseCanaryAdmissions.release, 'a'.repeat(40))),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].gross_amount, '0.500000')
  console.log('PASS: concurrent database transactions admit only one call at the exact cap')

  const rotatedManifestAdmission = admission()
  rotatedManifestAdmission.manifestSha256 = 'd'.repeat(64)
  await assert.rejects(
    db.transaction((tx) =>
      persistPhase3CanaryAdmission(tx, rotatedManifestCallId, rotatedManifestAdmission)
    ),
    /canary call cap has been reached/
  )
  console.log('PASS: reissuing a manifest cannot reset release-policy canary capacity')

  const rollbackAdmission = admission()
  rollbackAdmission.policy = {
    ...policy,
    limits: {
      ...policy.limits,
      maxCalls: 2,
      maxGrossPerWalletMinor: '1000000',
      maxGrossTotalMinor: '1000000',
    },
  }
  await assert.rejects(
    db.transaction(async (tx) => {
      await persistPhase3CanaryAdmission(tx, rollbackCallId, rollbackAdmission)
      throw new Error('simulate reservation failure after admission')
    }),
    /simulate reservation failure/
  )
  const rollbackRows = await db
    .select()
    .from(releaseCanaryAdmissions)
    .where(eq(releaseCanaryAdmissions.agent_call_id, rollbackCallId))
  assert.equal(rollbackRows.length, 0)
  console.log('PASS: a later paid-call transaction failure rolls back canary admission atomically')
} finally {
  await db.delete(users).where(eq(users.id, builderUserId))
  await db.delete(users).where(eq(users.id, callerUserId))
  await pool.end()
}

console.log('PHASE 3 CANARY ADMISSION CONCURRENCY VERIFIED')
