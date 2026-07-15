import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const slos = JSON.parse(await fs.readFile(path.join(root, 'config', 'phase2-slos.json'), 'utf8'))

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(name, fallback, maximum) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`)
  }
  return value
}

function percentile(values, quantile) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

if (required('PHASE2_DRILL_APPROVED') !== 'isolated-staging-only') {
  throw new Error('PHASE2_DRILL_APPROVED must equal isolated-staging-only')
}

const baseUrl = new URL(required('PHASE2_BASE_URL'))
if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password) {
  throw new Error('PHASE2_BASE_URL must be credential-free HTTPS staging')
}
const expectedEnvironment = required('PHASE2_EXPECTED_ENVIRONMENT')
if (expectedEnvironment === 'production' || /mainnet/i.test(expectedEnvironment)) {
  throw new Error('Phase 2 load runner refuses production/mainnet environments')
}

const sessionCookie = required('PHASE2_SESSION_COOKIE')
const agentSlug = required('PHASE2_AGENT_SLUG')
const requests = positiveInteger('PHASE2_LOAD_REQUESTS', 100, 10_000)
const concurrency = positiveInteger('PHASE2_LOAD_CONCURRENCY', 10, 50)

const healthResponse = await fetch(new URL('/health', baseUrl))
const health = await healthResponse.json()
if (!healthResponse.ok || health.environment !== expectedEnvironment) {
  throw new Error(
    `Environment attestation failed: expected ${expectedEnvironment}, received ${health.environment}`
  )
}
if (!health.release || health.release === 'development') {
  throw new Error('Staging load requires an immutable VELOSTRA_RELEASE')
}

let nextRequest = 0
const observations = []
async function worker() {
  while (nextRequest < requests) {
    const index = nextRequest
    nextRequest += 1
    const startedAt = performance.now()
    let status = 0
    let code = 'NETWORK_ERROR'
    try {
      const response = await fetch(new URL(`/api/agents/${encodeURIComponent(agentSlug)}/run`, baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sessionCookie,
        },
        body: JSON.stringify({ input: `phase2-load-${Date.now()}-${index}` }),
      })
      status = response.status
      const body = await response.json().catch(() => ({}))
      code = body.code ?? (response.ok ? 'OK' : 'HTTP_ERROR')
    } catch (error) {
      code = error instanceof Error ? error.name : 'NETWORK_ERROR'
    }
    observations.push({
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      status,
      code,
    })
  }
}

const startedAt = new Date()
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()))
const completedAt = new Date()
const successful = observations.filter((item) => item.status >= 200 && item.status < 300)
const intentionalRateLimits = observations.filter((item) => item.status === 429)
const errors = observations.filter(
  (item) => !(item.status >= 200 && item.status < 300) && item.status !== 429
)
const durations = successful.map((item) => item.durationMs)
const errorRate = errors.length / observations.length
const result = {
  schemaVersion: 1,
  kind: 'phase2-paid-call-load',
  environment: health.environment,
  release: health.release,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  configuration: { requests, concurrency },
  measurements: {
    successful: successful.length,
    intentionalRateLimits: intentionalRateLimits.length,
    errors: errors.length,
    errorRate,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
  },
  errorSummary: Object.fromEntries(
    [...new Set(errors.map((item) => item.code))].sort().map((code) => [
      code,
      errors.filter((item) => item.code === code).length,
    ])
  ),
}
result.passed =
  result.measurements.successful > 0 &&
  result.measurements.p95Ms <= slos.objectives.paidCallP95Ms &&
  result.measurements.errorRate <= slos.objectives.paidCallErrorRateMax

const outputDirectory = path.join(root, 'artifacts', 'phase2')
await fs.mkdir(outputDirectory, { recursive: true })
const outputPath = path.join(
  outputDirectory,
  `load-${health.release.replace(/[^a-zA-Z0-9_.-]/g, '_')}-${Date.now()}.json`
)
await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ ...result, outputPath: path.relative(root, outputPath) }, null, 2))
if (!result.passed) process.exitCode = 1
