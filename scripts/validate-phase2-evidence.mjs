import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceRoot = path.resolve(process.env.PHASE2_EVIDENCE_ROOT ?? repositoryRoot)
const argument = process.argv.find((value) => value.startsWith('--manifest='))
const manifestPath = path.resolve(
  evidenceRoot,
  argument?.slice('--manifest='.length) ??
    process.env.PHASE2_EVIDENCE_MANIFEST ??
    'artifacts/phase2/evidence-manifest.json'
)
const slos = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'config', 'phase2-slos.json'), 'utf8'))
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

function safePath(relativePath) {
  const resolved = path.resolve(evidenceRoot, relativePath)
  const relative = path.relative(evidenceRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Evidence path escapes root: ${relativePath}`)
  }
  return resolved
}

async function readArtifact(manifest, name, json = true) {
  const entry = manifest.artifacts?.[name]
  if (!entry?.path || !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '')) {
    failures.push(`${name} artifact must provide path and SHA-256`)
    return undefined
  }
  try {
    const bytes = await fs.readFile(safePath(entry.path))
    const digest = crypto.createHash('sha256').update(bytes).digest('hex')
    check(digest === entry.sha256.toLowerCase(), `${name} artifact hash mismatch`)
    if (!json) return bytes
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    failures.push(`${name} artifact cannot be read: ${error instanceof Error ? error.message : error}`)
    return undefined
  }
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
check(manifest.schemaVersion === 1, 'manifest schemaVersion must be 1')
check(manifest.environment && manifest.environment !== 'production', 'environment must be isolated staging')
check(!/mainnet/i.test(manifest.environment ?? ''), 'environment must not be mainnet')
check(/^[a-f0-9]{40}$/i.test(manifest.frozenCommit ?? ''), 'frozenCommit must be a full commit SHA')
check(manifest.release === manifest.frozenCommit, 'release must equal the frozen commit SHA')

const soak = await readArtifact(manifest, 'soak')
if (soak) {
  check(soak.kind === 'phase2-soak-summary', 'soak artifact kind is invalid')
  check(soak.release === manifest.release, 'soak release differs from manifest')
  check(soak.environment === manifest.environment, 'soak environment differs from manifest')
  check(soak.durationMs >= 72 * 60 * 60 * 1000, 'soak duration is below 72 hours')
  check(soak.dailyReconciliations >= 3, 'soak needs at least three daily reconciliations')
  check(soak.syntheticPaidCalls > 0, 'soak contains no synthetic paid call')
  check(soak.unexplainedDriftUsd === 0, 'soak has unexplained financial drift')
  check(soak.staleRecoverableOutboxRows === 0, 'soak has stale recoverable outbox rows')
  check(soak.unresolvedHighCriticalFindings === 0, 'soak has unresolved High/Critical findings')
  check(soak.unownedAlerts === 0, 'soak has unowned alerts')
  check(soak.workerRestarts >= 1, 'soak has no verified worker restart')
  check(soak.passed === true, 'soak artifact is not passing')
}

const findings = await readArtifact(manifest, 'findings')
if (findings) {
  check(findings.kind === 'phase2-findings', 'findings artifact kind is invalid')
  check(findings.unresolvedHighCriticalFindings === 0, 'findings contain unresolved High/Critical items')
  check(findings.unownedAlerts === 0, 'findings contain unowned alerts')
  check(findings.passed === true, 'findings artifact is not passing')
  if (soak) {
    check(soak.unresolvedHighCriticalFindings === findings.unresolvedHighCriticalFindings, 'soak/findings High/Critical counts differ')
    check(soak.unownedAlerts === findings.unownedAlerts, 'soak/findings unowned alert counts differ')
  }
}

const load = await readArtifact(manifest, 'load')
if (load) {
  check(load.kind === 'phase2-paid-call-load', 'load artifact kind is invalid')
  check(load.release === manifest.release, 'load release differs from manifest')
  check(load.measurements?.p95Ms <= slos.objectives.paidCallP95Ms, 'paid-call p95 exceeds SLO')
  check(load.measurements?.errorRate <= slos.objectives.paidCallErrorRateMax, 'paid-call error rate exceeds SLO')
  check(load.passed === true, 'load artifact is not passing')
}

const outage = await readArtifact(manifest, 'outage')
if (outage) {
  check(outage.kind === 'phase2-one-hour-outage', 'outage artifact kind is invalid')
  check(outage.outageDurationMs >= 60 * 60 * 1000, 'outage drill is shorter than one hour')
  check(outage.catchUpDurationMs <= slos.objectives.oneHourLagCatchUpMs, 'catch-up exceeds SLO')
  check(outage.skippedChainRanges === 0, 'outage recovery skipped a chain range')
  check(outage.duplicateDebits === 0 && outage.duplicateCredits === 0, 'outage recovery duplicated money')
  check(outage.unexplainedDriftUsd === 0, 'outage recovery left drift')
  check(outage.passed === true, 'outage artifact is not passing')
}

const restore = await readArtifact(manifest, 'restore')
if (restore) {
  check(restore.kind === 'postgres-restore-integrity', 'restore artifact kind is invalid')
  check(restore.managedPitr === true, 'restore artifact is not a managed PITR drill')
  check(restore.durationMs >= 0, 'restore RTO cannot be negative')
  check(restore.durationMs <= slos.objectives.restoreRtoMs, 'restore RTO exceeds SLO')
  check(restore.rpoMs !== null && restore.rpoMs >= 0, 'restore RPO cannot be negative')
  check(restore.rpoMs !== null && restore.rpoMs <= slos.objectives.restoreRpoMs, 'restore RPO exceeds SLO')
  check(restore.passed === true, 'restore artifact is not passing')
}

const wallet = await readArtifact(manifest, 'wallet')
if (wallet) {
  const requiredScenarios = [
    'connect', 'reject', 'reconnect', 'wrong-chain', 'auth', 'deposit', 'paid-call',
    'ambiguous-recovery', 'earnings', 'claim', 'session-expiry',
  ]
  check(wallet.kind === 'phase2-real-wallet', 'wallet artifact kind is invalid')
  check(wallet.realMetaMask === true && wallet.injectedWallet === true, 'both wallet paths must pass')
  for (const scenario of requiredScenarios) {
    check(wallet.scenarios?.includes(scenario), `wallet scenario is missing: ${scenario}`)
  }
  check(wallet.passed === true, 'wallet artifact is not passing')
}

const alerts = await readArtifact(manifest, 'alerts')
if (alerts) {
  const requiredAlerts = [
    'worker_stale', 'financial_drift', 'signer_low_balance', 'rpc_failure',
    'database_pressure', 'backup_failure',
  ]
  check(alerts.kind === 'phase2-alert-delivery', 'alert artifact kind is invalid')
  check(alerts.operatorAcknowledged === true, 'alert delivery lacks operator acknowledgement')
  for (const scenario of requiredAlerts) {
    check(alerts.scenarios?.includes(scenario), `alert scenario is missing: ${scenario}`)
  }
  check(alerts.passed === true, 'alert artifact is not passing')
}

const restarts = await readArtifact(manifest, 'workerRestarts')
if (restarts) {
  check(restarts.kind === 'phase2-worker-restarts', 'worker restart artifact kind is invalid')
  check(Array.isArray(restarts.restarts) && restarts.restarts.length >= 1, 'worker restart evidence is empty')
  for (const restart of restarts.restarts ?? []) {
    check(Boolean(restart.stoppedAt && restart.startedAt), 'worker restart timestamps are missing')
    check(restart.previousInstanceId !== restart.newInstanceId, 'worker instance ID did not change')
  }
  check(restarts.passed === true, 'worker restart artifact is not passing')
}

for (const name of ['configuration', 'dashboards']) {
  const artifact = await readArtifact(manifest, name)
  if (artifact) {
    check(artifact.environment === manifest.environment, `${name} environment differs from manifest`)
    check(artifact.release === manifest.release, `${name} release differs from manifest`)
    check(artifact.passed === true, `${name} artifact is not passing`)
  }
}
await readArtifact(manifest, 'dependencyDisposition', false)

const signoff = manifest.operatorSignoff
check(signoff?.decision === 'approve', 'operator sign-off decision must be approve')
check(Boolean(signoff?.name && !/placeholder|todo/i.test(signoff.name)), 'operator sign-off name is missing')
check(Boolean(signoff?.role), 'operator sign-off role is missing')
check(!Number.isNaN(Date.parse(signoff?.approvedAt ?? '')), 'operator sign-off timestamp is invalid')

if (failures.length > 0) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    passed: true,
    environment: manifest.environment,
    release: manifest.release,
    artifactCount: Object.keys(manifest.artifacts).length,
    operator: signoff.name,
  }, null, 2))
}
