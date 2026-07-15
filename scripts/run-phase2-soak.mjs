import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const slos = JSON.parse(await fs.readFile(path.join(root, 'config', 'phase2-slos.json'), 'utf8'))
const dayMs = 24 * 60 * 60 * 1000

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function numeric(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function metricValues(text, name) {
  return text
    .split('\n')
    .filter((line) => line.startsWith(name + ' ') || line.startsWith(name + '{'))
    .map((line) => Number(line.trim().split(/\s+/).at(-1)))
    .filter(Number.isFinite)
}

function metricValue(text, name) {
  return metricValues(text, name)[0]
}

async function readJson(evidencePath) {
  return JSON.parse(await fs.readFile(path.resolve(evidencePath), 'utf8'))
}

async function observedFetch(url, init = {}) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  } catch {
    return undefined
  }
}

if (required('PHASE2_SOAK_APPROVED') !== 'isolated-staging-72h') {
  throw new Error('PHASE2_SOAK_APPROVED must equal isolated-staging-72h')
}
const baseUrl = new URL(required('PHASE2_BASE_URL'))
if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
  throw new Error('PHASE2_BASE_URL must be credential-free HTTPS staging')
}
const expectedEnvironment = required('PHASE2_EXPECTED_ENVIRONMENT')
if (expectedEnvironment === 'production' || /mainnet/i.test(expectedEnvironment)) {
  throw new Error('Phase 2 soak refuses production/mainnet environments')
}
const metricsToken = required('PHASE2_METRICS_TOKEN')
const sessionCookie = required('PHASE2_SESSION_COOKIE')
const agentSlug = required('PHASE2_AGENT_SLUG')
const restartEvidencePath = required('PHASE2_WORKER_RESTART_EVIDENCE_PATH')
const findingsEvidencePath = required('PHASE2_FINDINGS_EVIDENCE_PATH')
const durationHours = numeric('PHASE2_SOAK_DURATION_HOURS', 72, 72, 168)
const intervalSeconds = numeric('PHASE2_SOAK_INTERVAL_SECONDS', 300, 30, 1800)
const durationMs = durationHours * 60 * 60 * 1000

const healthResponse = await fetch(new URL('/health', baseUrl), {
  signal: AbortSignal.timeout(15_000),
})
const health = await healthResponse.json()
if (!healthResponse.ok || health.environment !== expectedEnvironment) {
  throw new Error('Soak environment attestation failed')
}
if (!/^[a-f0-9]{40}$/i.test(health.release ?? '')) {
  throw new Error('Soak requires VELOSTRA_RELEASE to be a full frozen commit SHA')
}

const startedAt = new Date()
const deadline = startedAt.getTime() + durationMs
const outputDirectory = path.join(
  root,
  'artifacts',
  'phase2',
  `soak-${health.release}-${startedAt.toISOString().replace(/[:.]/g, '-')}`
)
await fs.mkdir(outputDirectory, { recursive: true })
const checkpointsPath = path.join(outputDirectory, 'checkpoints.jsonl')
const summaryPath = path.join(outputDirectory, 'summary.json')

let stopping = false
let wake
function stop() {
  stopping = true
  wake?.()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    wake = () => {
      clearTimeout(timer)
      resolve()
    }
  }).finally(() => { wake = undefined })
}

let samples = 0
let syntheticPaidCalls = 0
let dailyReconciliations = 0
let nextDailyAt = dayMs
let driftViolations = 0
let staleOutboxViolations = 0
let readinessViolations = 0
let syntheticViolations = 0
let maxCursorLagBlocks = 0
let maxOutboxAgeSeconds = 0

while (!stopping) {
  const capturedAt = new Date()
  const elapsedMs = capturedAt.getTime() - startedAt.getTime()
  const finalSample = capturedAt.getTime() >= deadline
  const [readyResponse, metricsResponse, syntheticResponse] = await Promise.all([
    observedFetch(new URL('/ready', baseUrl)),
    observedFetch(new URL('/metrics', baseUrl), {
      headers: { authorization: `Bearer ${metricsToken}` },
    }),
    observedFetch(new URL(`/api/agents/${encodeURIComponent(agentSlug)}/run`, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ input: `phase2-soak-${capturedAt.toISOString()}` }),
    }),
  ])
  const readiness = await readyResponse?.json().catch(() => ({})) ?? {}
  const metrics = await metricsResponse?.text().catch(() => '') ?? ''
  const syntheticBody = await syntheticResponse?.json().catch(() => ({})) ?? {}

  const dependencyValues = metricValues(metrics, 'velostra_dependency_up')
  const drift = metricValue(metrics, 'velostra_reconciliation_drift')
  const solvent = metricValue(metrics, 'velostra_chain_solvent')
  const cursorLagBlocks = metricValue(metrics, 'velostra_reconciliation_lag_blocks')
  const pendingEvents = metricValue(metrics, 'velostra_chain_pending_events')
  const outboxAgeSeconds = metricValue(metrics, 'velostra_outbox_oldest_recoverable_age_seconds')
  const workerAgeSeconds = metricValue(metrics, 'velostra_worker_heartbeat_age_seconds')
  const cleanFinancialState = drift === 0 && solvent === 1 && pendingEvents === 0
  const ready =
    readyResponse?.ok === true &&
    readiness.environment === expectedEnvironment &&
    readiness.release === health.release &&
    dependencyValues.length > 0 &&
    dependencyValues.every((value) => value === 1)
  const outboxFresh =
    (outboxAgeSeconds ?? 0) * 1000 <= slos.objectives.recoverableOutboxAgeMs
  const workerFresh = workerAgeSeconds !== undefined && workerAgeSeconds <= 90
  const syntheticPassed = syntheticResponse?.ok === true && Boolean(syntheticBody.settlement_tx_hash)

  samples += 1
  if (syntheticPassed) syntheticPaidCalls += 1
  else syntheticViolations += 1
  if (!cleanFinancialState) driftViolations += 1
  if (!outboxFresh) staleOutboxViolations += 1
  if (!ready || !workerFresh || metricsResponse?.ok !== true) readinessViolations += 1
  maxCursorLagBlocks = Math.max(maxCursorLagBlocks, cursorLagBlocks ?? 0)
  maxOutboxAgeSeconds = Math.max(maxOutboxAgeSeconds, outboxAgeSeconds ?? 0)

  while (elapsedMs >= nextDailyAt) {
    if (cleanFinancialState && ready && outboxFresh && workerFresh) dailyReconciliations += 1
    nextDailyAt += dayMs
  }

  const checkpoint = {
    capturedAt: capturedAt.toISOString(),
    elapsedMs,
    ready,
    workerFresh,
    cleanFinancialState,
    outboxFresh,
    syntheticPassed,
    cursorLagBlocks,
    pendingEvents,
    outboxAgeSeconds,
    workerAgeSeconds,
  }
  await fs.appendFile(checkpointsPath, JSON.stringify(checkpoint) + '\n')
  await fs.writeFile(summaryPath, JSON.stringify({
    kind: 'phase2-soak-summary',
    environment: expectedEnvironment,
    release: health.release,
    startedAt: startedAt.toISOString(),
    completedAt: capturedAt.toISOString(),
    durationMs: elapsedMs,
    samples,
    dailyReconciliations,
    syntheticPaidCalls,
    driftViolations,
    staleOutboxViolations,
    readinessViolations,
    syntheticViolations,
    maxCursorLagBlocks,
    maxOutboxAgeSeconds,
    passed: false,
  }, null, 2) + '\n')

  if (finalSample) break
  await wait(Math.min(intervalSeconds * 1000, Math.max(1, deadline - Date.now())))
}

const completedAt = new Date()
const restartEvidence = await readJson(restartEvidencePath)
const findingsEvidence = await readJson(findingsEvidencePath)
const workerRestarts = (restartEvidence.restarts ?? []).filter((restart) => {
  const stoppedAt = Date.parse(restart.stoppedAt)
  const startedAgainAt = Date.parse(restart.startedAt)
  return Number.isFinite(stoppedAt) &&
    Number.isFinite(startedAgainAt) &&
    stoppedAt >= startedAt.getTime() &&
    startedAgainAt <= completedAt.getTime() &&
    restart.previousInstanceId !== restart.newInstanceId
}).length
const actualDurationMs = completedAt.getTime() - startedAt.getTime()
const summary = {
  kind: 'phase2-soak-summary',
  environment: expectedEnvironment,
  release: health.release,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationMs: actualDurationMs,
  samples,
  dailyReconciliations,
  syntheticPaidCalls,
  unexplainedDriftUsd: driftViolations === 0 ? 0 : null,
  staleRecoverableOutboxRows: staleOutboxViolations,
  unresolvedHighCriticalFindings: findingsEvidence.unresolvedHighCriticalFindings,
  unownedAlerts: findingsEvidence.unownedAlerts,
  workerRestarts,
  driftViolations,
  readinessViolations,
  syntheticViolations,
  maxCursorLagBlocks,
  maxOutboxAgeSeconds,
  interrupted: stopping,
}
summary.passed =
  !stopping &&
  actualDurationMs >= 72 * 60 * 60 * 1000 &&
  dailyReconciliations >= 3 &&
  syntheticPaidCalls > 0 &&
  driftViolations === 0 &&
  staleOutboxViolations === 0 &&
  readinessViolations === 0 &&
  syntheticViolations === 0 &&
  findingsEvidence.unresolvedHighCriticalFindings === 0 &&
  findingsEvidence.unownedAlerts === 0 &&
  workerRestarts >= 1
await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ ...summary, summaryPath: path.relative(root, summaryPath) }, null, 2))
if (!summary.passed) process.exitCode = 1
