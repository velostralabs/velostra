import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const validator = path.join(repositoryRoot, 'scripts', 'validate-phase2-evidence.mjs')
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'velostra-phase2-evidence-'))
const release = 'a'.repeat(40)
const environment = 'staging-isolated'

async function artifact(name, value, extension = 'json') {
  const relativePath = `${name}.${extension}`
  const bytes = Buffer.from(
    extension === 'json' ? JSON.stringify(value, null, 2) + '\n' : String(value)
  )
  await fs.writeFile(path.join(fixtureRoot, relativePath), bytes)
  return {
    path: relativePath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
}

function runValidator() {
  return spawnSync(process.execPath, [validator, '--manifest=manifest.json'], {
    cwd: repositoryRoot,
    env: { ...process.env, PHASE2_EVIDENCE_ROOT: fixtureRoot },
    encoding: 'utf8',
  })
}

try {
  const artifacts = {
    soak: await artifact('soak', {
      kind: 'phase2-soak-summary', environment, release,
      durationMs: 72 * 60 * 60 * 1000,
      dailyReconciliations: 3,
      syntheticPaidCalls: 100,
      unexplainedDriftUsd: 0,
      staleRecoverableOutboxRows: 0,
      unresolvedHighCriticalFindings: 0,
      unownedAlerts: 0,
      workerRestarts: 1,
      passed: true,
    }),
    load: await artifact('load', {
      kind: 'phase2-paid-call-load', environment, release,
      measurements: { p95Ms: 1000, errorRate: 0 },
      passed: true,
    }),
    outage: await artifact('outage', {
      kind: 'phase2-one-hour-outage',
      outageDurationMs: 60 * 60 * 1000,
      catchUpDurationMs: 10_000,
      skippedChainRanges: 0,
      duplicateDebits: 0,
      duplicateCredits: 0,
      unexplainedDriftUsd: 0,
      passed: true,
    }),
    restore: await artifact('restore', {
      kind: 'postgres-restore-integrity',
      managedPitr: true,
      durationMs: 30_000,
      rpoMs: 30_000,
      passed: true,
    }),
    wallet: await artifact('wallet', {
      kind: 'phase2-real-wallet',
      realMetaMask: true,
      injectedWallet: true,
      scenarios: [
        'connect', 'reject', 'reconnect', 'wrong-chain', 'auth', 'deposit', 'paid-call',
        'ambiguous-recovery', 'earnings', 'claim', 'session-expiry',
      ],
      passed: true,
    }),
    alerts: await artifact('alerts', {
      kind: 'phase2-alert-delivery',
      operatorAcknowledged: true,
      scenarios: [
        'worker_stale', 'financial_drift', 'signer_low_balance', 'rpc_failure',
        'database_pressure', 'backup_failure',
      ],
      passed: true,
    }),
    workerRestarts: await artifact('worker-restarts', {
      kind: 'phase2-worker-restarts',
      restarts: [{
        stoppedAt: '2026-07-15T01:00:00Z',
        startedAt: '2026-07-15T01:00:10Z',
        previousInstanceId: 'worker-a',
        newInstanceId: 'worker-b',
      }],
      passed: true,
    }),
    findings: await artifact('findings', {
      kind: 'phase2-findings',
      unresolvedHighCriticalFindings: 0,
      unownedAlerts: 0,
      passed: true,
    }),
    configuration: await artifact('configuration', { environment, release, passed: true }),
    dashboards: await artifact('dashboards', { environment, release, passed: true }),
    dependencyDisposition: await artifact('dependency', 'Reviewed dependency disposition\n', 'md'),
  }
  const manifest = {
    schemaVersion: 1,
    environment,
    release,
    frozenCommit: release,
    generatedAt: '2026-07-15T04:00:00Z',
    artifacts,
    operatorSignoff: {
      name: 'Velostra Release Manager',
      role: 'Release operator',
      approvedAt: '2026-07-15T04:05:00Z',
      decision: 'approve',
    },
  }
  await fs.writeFile(path.join(fixtureRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const valid = runValidator()
  assert.equal(valid.status, 0, valid.error?.stack || valid.stderr || valid.stdout)
  assert.match(valid.stdout, /"passed": true/)

  const restorePath = path.join(fixtureRoot, artifacts.restore.path)
  const restoreEvidence = JSON.parse(await fs.readFile(restorePath, 'utf8'))
  restoreEvidence.rpoMs = -1
  let restoreBytes = Buffer.from(JSON.stringify(restoreEvidence, null, 2) + '\n')
  await fs.writeFile(restorePath, restoreBytes)
  manifest.artifacts.restore.sha256 = crypto.createHash('sha256').update(restoreBytes).digest('hex')
  await fs.writeFile(path.join(fixtureRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const negativeRpo = runValidator()
  assert.notEqual(negativeRpo.status, 0)
  assert.match(negativeRpo.stderr, /restore RPO cannot be negative/)

  restoreEvidence.rpoMs = 0
  restoreBytes = Buffer.from(JSON.stringify(restoreEvidence, null, 2) + '\n')
  await fs.writeFile(restorePath, restoreBytes)
  manifest.artifacts.restore.sha256 = crypto.createHash('sha256').update(restoreBytes).digest('hex')
  await fs.writeFile(path.join(fixtureRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))

  await fs.appendFile(path.join(fixtureRoot, artifacts.load.path), 'tamper')
  const tampered = runValidator()
  assert.notEqual(tampered.status, 0)
  assert.match(tampered.stderr, /load artifact hash mismatch/)
  console.log('PHASE 2 EVIDENCE VERIFIED: complete packet passes; negative RPO and tampering fail closed')
} finally {
  const relativeToTemp = path.relative(os.tmpdir(), fixtureRoot)
  if (relativeToTemp.startsWith('velostra-phase2-evidence-') && !relativeToTemp.includes('..')) {
    await fs.rm(fixtureRoot, { recursive: true, force: true })
  }
}
