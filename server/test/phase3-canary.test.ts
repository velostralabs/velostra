import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertPhase3CanaryCapacity,
  assertPhase3RuntimeConfiguration,
  moneyToMinor,
  Phase3AdmissionError,
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
  'PHASE3_MAINNET_STARTUP_APPROVAL',
  'PHASE3_RELEASE_MANIFEST',
  'PHASE3_RELEASE_MANIFEST_SHA256',
  'PHASE3_PAID_WRITES_MODE',
  'PHASE3_CANARY_POLICY_PATH',
  'PHASE3_CANARY_POLICY_SHA256',
  'PHASE3_CANARY_STARTED_AT',
  'PHASE3_CANARY_EXIT_APPROVAL',
  'PHASE3_CANARY_EXIT_EVIDENCE',
  'PHASE3_CANARY_EXIT_EVIDENCE_SHA256',
] as const
const original = new Map(managed.map((key) => [key, process.env[key]]))
const directory = mkdtempSync(path.join(tmpdir(), 'velostra-phase3-canary-'))

try {
  const release = 'a'.repeat(40)
  const environment = 'robinhood-mainnet'
  const wallet = '0x6000000000000000000000000000000000000006'
  const builder = '0x7000000000000000000000000000000000000007'
  const policy = {
    schemaVersion: 1,
    kind: 'velostra-phase3-canary-policy',
    environment,
    enabled: true,
    allowlists: {
      wallets: [wallet],
      agents: ['phase3-synthetic-agent'],
      builders: [builder],
    },
    limits: {
      durationSeconds: 3600,
      maxCalls: 2,
      maxGrossPerCallMinor: '1000000',
      maxGrossPerWalletMinor: '1500000',
      maxGrossTotalMinor: '2000000',
    },
    thresholds: {
      maxUnexplainedDriftMinor: '0',
      maxCursorLagBlocks: 12,
      maxRecoverableOutboxAgeSeconds: 120,
      maxErrorRate: 0.01,
      maxWorkerAgeSeconds: 90,
      maxBackupAgeSeconds: 90000,
      minSignerBalanceWei: '10000000000000000',
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
  const policyPath = path.join(directory, 'canary-policy.json')
  writeFileSync(policyPath, policyRaw)

  const manifestBody = {
    schemaVersion: 1,
    kind: 'velostra-phase3-release',
    stage: 'deployed',
    environment,
    release,
    chain: { id: 4663 },
    policies: {
      canary: { path: 'config/canary.json', sha256: policySha256 },
    },
  }
  const manifestSha256 = sha256(canonicalJson(manifestBody))
  const manifest = {
    ...manifestBody,
    integrity: { algorithm: 'sha256', manifestSha256 },
  }
  const manifestPath = path.join(directory, 'release-manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  Object.assign(process.env, {
    VELOSTRA_ENVIRONMENT: environment,
    VELOSTRA_RELEASE: release,
    PHASE3_MAINNET_STARTUP_APPROVAL: 'explicitly-approved',
    PHASE3_RELEASE_MANIFEST: manifestPath,
    PHASE3_RELEASE_MANIFEST_SHA256: manifestSha256,
    PHASE3_PAID_WRITES_MODE: 'disabled',
  })

  assert.doesNotThrow(() => assertPhase3RuntimeConfiguration('api', environment, release))
  assert.throws(
    () => resolvePhase3PaidCallAdmission({
      walletAddress: wallet,
      agentId: 'phase3-synthetic-agent',
      builderAddress: builder,
      gross: '0.500000',
    }),
    (error) => error instanceof Phase3AdmissionError &&
      error.code === 'PHASE3_PAID_WRITES_DISABLED' &&
      error.statusCode === 503
  )
  console.log('PASS: mainnet paid writes default to an explicit fail-closed mode')

  Object.assign(process.env, {
    PHASE3_PAID_WRITES_MODE: 'canary',
    PHASE3_CANARY_POLICY_PATH: policyPath,
    PHASE3_CANARY_POLICY_SHA256: policySha256,
    PHASE3_CANARY_STARTED_AT: new Date().toISOString(),
  })
  assert.doesNotThrow(() => assertPhase3RuntimeConfiguration('api', environment, release))
  const admission = resolvePhase3PaidCallAdmission({
    walletAddress: wallet.toUpperCase().replace('0X', '0x'),
    agentId: 'phase3-synthetic-agent',
    builderAddress: builder,
    gross: '0.500000',
  })
  assert.equal(admission.mode, 'canary')
  if (admission.mode !== 'canary') throw new Error('expected canary admission')
  assert.equal(admission.grossMinor, 500000n)
  assert.equal(moneyToMinor('17.000001'), 17000001n)
  console.log('PASS: immutable manifest and policy authorize only the intended canary subject')

  const incompletePolicy = {
    ...policy,
    requiredFlow: policy.requiredFlow.filter((flow) => flow !== 'platform-revenue'),
  }
  const incompletePolicyRaw = Buffer.from(JSON.stringify(incompletePolicy, null, 2) + '\n')
  const incompletePolicySha256 = sha256(incompletePolicyRaw)
  const incompletePolicyPath = path.join(directory, 'incomplete-canary-policy.json')
  writeFileSync(incompletePolicyPath, incompletePolicyRaw)
  const incompleteManifestBody = {
    ...manifestBody,
    policies: {
      canary: {
        path: 'config/incomplete-canary.json',
        sha256: incompletePolicySha256,
      },
    },
  }
  const incompleteManifestSha256 = sha256(canonicalJson(incompleteManifestBody))
  const incompleteManifestPath = path.join(directory, 'incomplete-release-manifest.json')
  writeFileSync(
    incompleteManifestPath,
    JSON.stringify({
      ...incompleteManifestBody,
      integrity: { algorithm: 'sha256', manifestSha256: incompleteManifestSha256 },
    }, null, 2) + '\n'
  )
  Object.assign(process.env, {
    PHASE3_RELEASE_MANIFEST: incompleteManifestPath,
    PHASE3_RELEASE_MANIFEST_SHA256: incompleteManifestSha256,
    PHASE3_CANARY_POLICY_PATH: incompletePolicyPath,
    PHASE3_CANARY_POLICY_SHA256: incompletePolicySha256,
  })
  assert.throws(
    () => assertPhase3RuntimeConfiguration('api', environment, release),
    /required flow is missing: platform-revenue/
  )
  Object.assign(process.env, {
    PHASE3_RELEASE_MANIFEST: manifestPath,
    PHASE3_RELEASE_MANIFEST_SHA256: manifestSha256,
    PHASE3_CANARY_POLICY_PATH: policyPath,
    PHASE3_CANARY_POLICY_SHA256: policySha256,
  })
  console.log('PASS: incomplete canary safety policy blocks startup')

  assert.throws(
    () => resolvePhase3PaidCallAdmission({
      walletAddress: '0x8000000000000000000000000000000000000008',
      agentId: 'phase3-synthetic-agent',
      builderAddress: builder,
      gross: '0.500000',
    }),
    (error) => error instanceof Phase3AdmissionError &&
      error.code === 'PHASE3_CANARY_SUBJECT_NOT_ALLOWED'
  )
  assert.throws(
    () => resolvePhase3PaidCallAdmission({
      walletAddress: wallet,
      agentId: 'phase3-synthetic-agent',
      builderAddress: builder,
      gross: '1.000001',
    }),
    (error) => error instanceof Phase3AdmissionError &&
      error.code === 'PHASE3_CANARY_PER_CALL_CAP'
  )

  assert.doesNotThrow(() => assertPhase3CanaryCapacity(admission, {
    callCount: 1,
    grossTotalMinor: 500000n,
    grossWalletMinor: 500000n,
  }))
  assert.throws(
    () => assertPhase3CanaryCapacity(admission, {
      callCount: 2,
      grossTotalMinor: 500000n,
      grossWalletMinor: 500000n,
    }),
    (error) => error instanceof Phase3AdmissionError &&
      error.code === 'PHASE3_CANARY_CALL_CAP'
  )
  assert.throws(
    () => assertPhase3CanaryCapacity(admission, {
      callCount: 1,
      grossTotalMinor: 500000n,
      grossWalletMinor: 1100000n,
    }),
    (error) => error instanceof Phase3AdmissionError &&
      error.code === 'PHASE3_CANARY_WALLET_CAP'
  )
  console.log('PASS: canary call and financial exposure caps fail closed')

  process.env.PHASE3_CANARY_STARTED_AT = new Date(
    Date.now() - policy.limits.durationSeconds * 1_000 - 1
  ).toISOString()
  const expectedErrorLogger = console.error
  console.error = () => undefined
  try {
    assert.throws(
      () => resolvePhase3PaidCallAdmission({
        walletAddress: wallet,
        agentId: 'phase3-synthetic-agent',
        builderAddress: builder,
        gross: '0.500000',
      }),
      (error) => error instanceof Phase3AdmissionError &&
        error.code === 'PHASE3_CANARY_CONFIGURATION_INVALID'
    )
  } finally {
    console.error = expectedErrorLogger
  }
  process.env.PHASE3_CANARY_STARTED_AT = new Date().toISOString()
  console.log('PASS: expired canary windows reject new paid calls')

  const exitEvidence = {
    kind: 'velostra-phase3-canary-decision',
    decision: 'PASS_AWAITING_OPERATOR',
    release,
    sourceManifestSha256: manifestSha256,
  }
  const exitRaw = Buffer.from(JSON.stringify(exitEvidence, null, 2) + '\n')
  const exitPath = path.join(directory, 'canary-exit.json')
  writeFileSync(exitPath, exitRaw)
  Object.assign(process.env, {
    PHASE3_PAID_WRITES_MODE: 'public',
    PHASE3_CANARY_EXIT_APPROVAL: 'explicitly-approved',
    PHASE3_CANARY_EXIT_EVIDENCE: exitPath,
    PHASE3_CANARY_EXIT_EVIDENCE_SHA256: sha256(exitRaw),
  })
  assert.doesNotThrow(() => assertPhase3RuntimeConfiguration('api', environment, release))
  console.log('PASS: public expansion requires release-bound canary evidence and operator approval')

  process.env.PHASE3_RELEASE_MANIFEST_SHA256 = 'b'.repeat(64)
  assert.throws(
    () => assertPhase3RuntimeConfiguration('api', environment, release),
    /manifest hash mismatch/
  )
  console.log('PASS: manifest tampering blocks startup')
} finally {
  for (const key of managed) {
    const value = original.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(directory, { recursive: true, force: true })
}

console.log('PHASE 3 RUNTIME CANARY GUARDRAILS VERIFIED')
