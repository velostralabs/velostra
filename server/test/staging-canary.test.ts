import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {
  assertPhase3RuntimeConfiguration,
  Phase3AdmissionError,
  phase3PaidWriteMode,
  resolvePhase3PaidCallAdmission,
} from '../src/lib/phase3-canary.js'

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

const managed = [
  'VELOSTRA_ENVIRONMENT',
  'VELOSTRA_RELEASE',
  'PHASE2_STAGING_CANARY_APPROVAL',
  'PHASE3_MAINNET_STARTUP_APPROVAL',
  'PHASE3_RELEASE_MANIFEST',
  'PHASE3_RELEASE_MANIFEST_B64',
  'PHASE3_RELEASE_MANIFEST_SHA256',
  'PHASE3_PAID_WRITES_MODE',
  'PHASE3_CANARY_POLICY_PATH',
  'PHASE3_CANARY_POLICY_B64',
  'PHASE3_CANARY_POLICY_SHA256',
  'PHASE3_CANARY_STARTED_AT',
] as const
const original = new Map(managed.map((key) => [key, process.env[key]]))

try {
  const release = 'b'.repeat(40)
  const wallet = '0x6000000000000000000000000000000000000006'
  const builder = '0x7000000000000000000000000000000000000007'
  const agent = 'phase2-synthetic-agent-id'
  const hashed = (value: string): string => 'sha256:' + sha256(value)
  const policy = {
    schemaVersion: 1,
    kind: 'velostra-phase3-canary-policy',
    environment: 'staging',
    enabled: true,
    allowlists: {
      wallets: [hashed(wallet.toLowerCase())],
      agents: [hashed(agent)],
      builders: [hashed(builder.toLowerCase())],
    },
    limits: {
      durationSeconds: 3600,
      maxCalls: 1,
      maxGrossPerCallMinor: '1200000',
      maxGrossPerWalletMinor: '1200000',
      maxGrossTotalMinor: '1200000',
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
      canary: { path: 'env:PHASE3_CANARY_POLICY_B64', sha256: policySha256 },
    },
  }
  const manifestSha256 = sha256(canonicalJson(manifestBody))
  const manifestRaw = Buffer.from(JSON.stringify({
    ...manifestBody,
    integrity: { algorithm: 'sha256', manifestSha256 },
  }, null, 2) + '\n')

  Object.assign(process.env, {
    VELOSTRA_ENVIRONMENT: 'staging',
    VELOSTRA_RELEASE: release,
    PHASE2_STAGING_CANARY_APPROVAL: 'isolated-staging-paid-canary',
    PHASE3_PAID_WRITES_MODE: 'canary',
    PHASE3_RELEASE_MANIFEST_B64: manifestRaw.toString('base64'),
    PHASE3_RELEASE_MANIFEST_SHA256: manifestSha256,
    PHASE3_CANARY_POLICY_B64: policyRaw.toString('base64'),
    PHASE3_CANARY_POLICY_SHA256: policySha256,
    PHASE3_CANARY_STARTED_AT: new Date().toISOString(),
  })

  assert.doesNotThrow(() => assertPhase3RuntimeConfiguration('api', 'staging', release))
  const admission = resolvePhase3PaidCallAdmission({
    walletAddress: wallet,
    agentId: agent,
    builderAddress: builder,
    gross: '1.200000',
  })
  assert.equal(admission.mode, 'canary')

  assert.throws(
    () => resolvePhase3PaidCallAdmission({
      walletAddress: '0x8000000000000000000000000000000000000008',
      agentId: agent,
      builderAddress: builder,
      gross: '1.200000',
    }),
    (error) => error instanceof Phase3AdmissionError &&
      error.code === 'PHASE3_CANARY_SUBJECT_NOT_ALLOWED'
  )
  assert.throws(
    () => resolvePhase3PaidCallAdmission({
      walletAddress: wallet,
      agentId: agent,
      builderAddress: builder,
      gross: '1.200001',
    }),
    (error) => error instanceof Phase3AdmissionError &&
      error.code === 'PHASE3_CANARY_PER_CALL_CAP'
  )
  console.log('PASS: staging canary admits only the hashed subjects and exact bounded value')

  delete process.env.PHASE3_PAID_WRITES_MODE
  assert.equal(phase3PaidWriteMode('staging'), 'disabled')
  process.env.PHASE3_PAID_WRITES_MODE = 'canary'
  delete process.env.PHASE2_STAGING_CANARY_APPROVAL
  assert.throws(
    () => assertPhase3RuntimeConfiguration('api', 'staging', release),
    /isolated approval sentinel/
  )
  console.log('PASS: managed staging defaults disabled and requires a distinct approval')

  process.env.VELOSTRA_ENVIRONMENT = 'robinhood-mainnet'
  process.env.PHASE3_MAINNET_STARTUP_APPROVAL = 'explicitly-approved'
  assert.throws(
    () => assertPhase3RuntimeConfiguration('api', 'robinhood-mainnet', release),
    /staging-only/
  )
  console.log('PASS: base64 staging bindings cannot weaken the mainnet file-bound policy')
} finally {
  for (const key of managed) {
    const value = original.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

console.log('STAGING PAID CANARY GUARDRAILS VERIFIED')
