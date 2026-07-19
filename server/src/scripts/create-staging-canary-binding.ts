import 'dotenv/config'
import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, pool } from '../db/client.js'
import { agents, builders, users } from '../db/schema.js'

const SLUG = 'phase2-synthetic-agent'
const PRICE_MINOR = '1200000'
const DURATION_SECONDS = 3600
const FULL_COMMIT = /^[a-f0-9]{40}$/

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])])
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value), null, 2) + '\n'
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function subject(value: string): string {
  return 'sha256:' + sha256(value)
}

function assertStaging(): string {
  if (process.env.VELOSTRA_ENVIRONMENT !== 'staging') throw new Error('staging-only binding')
  if (process.env.ROBINHOOD_CHAIN_ID !== '46630') throw new Error('testnet-only binding')
  if (process.env.PHASE2_STAGING_CANARY_APPROVAL !== 'isolated-staging-paid-canary') {
    throw new Error('staging canary approval sentinel is required')
  }
  const release = required('VELOSTRA_RELEASE').toLowerCase()
  if (!FULL_COMMIT.test(release)) throw new Error('full immutable release is required')
  return release
}

async function main(): Promise<void> {
  const release = assertStaging()
  const [agent] = await db.select().from(agents).where(eq(agents.slug, SLUG)).limit(1)
  if (
    !agent ||
    agent.status !== 'APPROVED' ||
    !agent.active_revision_id ||
    Number(agent.price_per_call) !== 1.2
  ) {
    throw new Error('approved synthetic staging agent is unavailable')
  }
  const [builder] = await db.select().from(builders).where(eq(builders.id, agent.builder_id)).limit(1)
  if (!builder || builder.status !== 'ACTIVE') {
    throw new Error('synthetic staging builder is unavailable')
  }
  const [caller] = await db.select().from(users).where(eq(users.id, builder.user_id)).limit(1)
  if (!caller || caller.wallet_address.toLowerCase() !== builder.wallet_address.toLowerCase()) {
    throw new Error('dedicated staging wallet binding is inconsistent')
  }

  const policy = {
    schemaVersion: 1,
    kind: 'velostra-phase3-canary-policy',
    environment: 'staging',
    enabled: true,
    allowlists: {
      wallets: [subject(caller.wallet_address.toLowerCase())],
      agents: [subject(agent.id)],
      builders: [subject(builder.wallet_address.toLowerCase())],
    },
    limits: {
      durationSeconds: DURATION_SECONDS,
      maxCalls: 1,
      maxGrossPerCallMinor: PRICE_MINOR,
      maxGrossPerWalletMinor: PRICE_MINOR,
      maxGrossTotalMinor: PRICE_MINOR,
    },
    thresholds: {
      maxUnexplainedDriftMinor: '0',
      maxCursorLagBlocks: 24,
      maxRecoverableOutboxAgeSeconds: 900,
      maxErrorRate: 0,
      maxWorkerAgeSeconds: 1200,
      maxBackupAgeSeconds: 90000,
      minSignerBalanceWei: '1',
      maxUnacknowledgedCriticalAlerts: 0,
      maxPendingChainEvents: 0,
    },
    requiredFlow: [
      'deposit',
      'paid-call',
      'earnings-credit',
      'reconciliation',
      'builder-claim',
      'platform-revenue',
      'zero-drift',
    ],
    stopActions: [
      'disable-paid-writes',
      'preserve-builder-claims',
      'keep-reconciliation-running',
      'page-incident-owner',
    ],
    rollback: {
      destructiveDatabaseRollbackAllowed: false,
      strategy: 'pause-new-risk-and-forward-repair',
      preserveClaims: true,
      preserveReconciliation: true,
    },
  }
  const policyRaw = Buffer.from(JSON.stringify(policy, null, 2) + '\n')
  const policySha256 = sha256(policyRaw)
  const manifestBody = {
    schemaVersion: 1,
    kind: 'velostra-phase3-release',
    stage: 'deployed',
    environment: 'staging',
    release,
    chain: { id: 46630 },
    policies: {
      canary: {
        path: 'env:PHASE3_CANARY_POLICY_B64',
        sha256: policySha256,
      },
    },
  }
  const manifestSha256 = sha256(canonicalJson(manifestBody))
  const manifest = {
    ...manifestBody,
    integrity: {
      algorithm: 'sha256',
      manifestSha256,
    },
  }
  const manifestRaw = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')

  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: 'velostra-staging-canary-binding',
    release,
    chainId: 46630,
    durationSeconds: DURATION_SECONDS,
    maxCalls: 1,
    maxGrossMinor: PRICE_MINOR,
    policySha256,
    manifestSha256,
    policyB64: policyRaw.toString('base64'),
    manifestB64: manifestRaw.toString('base64'),
  }))
}

main()
  .catch(() => {
    console.error('[staging-canary-binding] failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
