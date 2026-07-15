import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pool } from '../db/client.js'
import { moneyToMinor } from '../lib/money.js'
import { loadPhase3ReleaseBinding } from '../lib/phase3-canary.js'

interface Manifest {
  release: string
  stage: string
  environment: string
  integrity: { manifestSha256: string }
  policies: { canary: { sha256: string } }
  contract: { constructor: { platformFeeBps: number; roles: Record<string, string> } }
}
interface CanaryPolicy {
  kind: string
  environment: string
  enabled: boolean
  allowlists: { wallets: string[]; agents: string[]; builders: string[] }
  limits: { durationSeconds: number }
  thresholds: { maxRecoverableOutboxAgeSeconds: number }
}
interface FinalSnapshot {
  release: string
  sourceManifestSha256: string
  capturedAt: string
  chain: { lagBlocks: string; pendingEvents: number }
  contract: {
    solvent: boolean
    platformFeeBps: number
    roles: Record<string, string | null>
  }
  outbox: { oldestRecoverableAgeSeconds: number | null }
  drift: { unexplainedMinor: string }
  alerts: { unacknowledgedCritical: number }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.resolve(process.cwd(), file), 'utf8')) as T
}
function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}
function minor(value: string | null | undefined): string {
  return moneyToMinor(value ?? '0').toString()
}
function addressSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()))
}

export async function capturePhase3CanarySummary(): Promise<Record<string, unknown>> {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Phase 3 canary summary requires NODE_ENV=production')
  }
  const environment = required('VELOSTRA_ENVIRONMENT')
  const release = required('VELOSTRA_RELEASE')
  const manifest = loadPhase3ReleaseBinding('api', environment, release) as Manifest | null
  if (!manifest || manifest.stage !== 'deployed') {
    throw new Error('Phase 3 canary summary requires a bound deployed manifest')
  }

  const policyPath = path.resolve(process.cwd(), required('PHASE3_CANARY_POLICY_PATH'))
  const policyRaw = await fs.readFile(policyPath)
  const policy = JSON.parse(policyRaw.toString('utf8')) as CanaryPolicy
  if (
    policy.kind !== 'velostra-phase3-canary-policy' ||
    policy.enabled !== true ||
    policy.environment !== environment ||
    sha256(policyRaw) !== manifest.policies.canary.sha256 ||
    process.env.PHASE3_CANARY_POLICY_SHA256 !== manifest.policies.canary.sha256
  ) {
    throw new Error('Phase 3 canary policy is not bound to the deployed manifest')
  }

  const finalSnapshot = await readJson<FinalSnapshot>(
    required('PHASE3_FINAL_READINESS_SNAPSHOT')
  )
  if (
    finalSnapshot.release !== release ||
    finalSnapshot.sourceManifestSha256 !== manifest.integrity.manifestSha256
  ) {
    throw new Error('Final readiness snapshot belongs to another release')
  }

  const startedAt = new Date(required('PHASE3_CANARY_STARTED_AT'))
  const endedAt = new Date(finalSnapshot.capturedAt)
  if (
    !Number.isFinite(startedAt.valueOf()) ||
    !Number.isFinite(endedAt.valueOf()) ||
    endedAt < startedAt ||
    endedAt.valueOf() - startedAt.valueOf() > policy.limits.durationSeconds * 1000
  ) {
    throw new Error('Phase 3 canary observation window is invalid')
  }

  // Exposure remains cumulative for a release-policy pair even if the exact
  // manifest is reissued. Manifest rotation must never reset canary accounting.
  const identity = [release, manifest.policies.canary.sha256]
  const admissionSql = [
    "select count(*)::int as total,",
    "count(*) filter (where status = 'SETTLED')::int as successful,",
    "count(*) filter (where status <> 'SETTLED')::int as failed,",
    "coalesce(max(gross_amount), 0)::text as max_gross,",
    "coalesce(sum(gross_amount), 0)::text as gross_total",
    'from release_canary_admissions',
    'where release = $1 and policy_sha256 = $2',
  ].join(' ')
  const walletSql = [
    'select coalesce(max(wallet_total), 0)::text as maximum from (',
    'select sum(gross_amount) as wallet_total from release_canary_admissions',
    'where release = $1 and policy_sha256 = $2',
    'group by wallet_address) exposure',
  ].join(' ')
  const subjectSql = [
    'select wallet_address, agent_id, builder_address from release_canary_admissions',
    'where release = $1 and policy_sha256 = $2',
  ].join(' ')
  const flowSql = [
    'select event_type::text, count(*)::int as count from chain_events',
    'where block_timestamp >= $1 and block_timestamp <= $2 group by event_type',
  ].join(' ')
  const reconciliationSql = [
    'select count(*)::int as count from operational_heartbeats',
    "where service_name = 'reconciliation-worker' and release = $1",
    'and last_seen_at >= $2 and last_seen_at <= $3',
  ].join(' ')
  const duplicateSql = [
    'select count(*)::int as count from (select t.agent_call_id from transactions t',
    'join release_canary_admissions a on a.agent_call_id = t.agent_call_id',
    'where a.release = $1 and a.policy_sha256 = $2',
    "and t.type = 'AGENT_CALL' group by t.agent_call_id having count(*) > 1) duplicated",
  ].join(' ')

  const [admissions, walletExposure, subjects, chainFlows, reconciliation, duplicates] =
    await Promise.all([
      pool.query<{
        total: number
        successful: number
        failed: number
        max_gross: string
        gross_total: string
      }>(admissionSql, identity),
      pool.query<{ maximum: string }>(walletSql, identity),
      pool.query<{ wallet_address: string; agent_id: string; builder_address: string }>(
        subjectSql,
        identity
      ),
      pool.query<{ event_type: string; count: number }>(flowSql, [startedAt, endedAt]),
      pool.query<{ count: number }>(reconciliationSql, [release, startedAt, endedAt]),
      pool.query<{ count: number }>(duplicateSql, identity),
    ])

  const row = admissions.rows[0]
  const allowedWallets = addressSet(policy.allowlists.wallets)
  const allowedAgents = new Set(policy.allowlists.agents)
  const allowedBuilders = addressSet(policy.allowlists.builders)
  const allowlistViolations = subjects.rows.filter(
    (subject) =>
      !allowedWallets.has(subject.wallet_address.toLowerCase()) ||
      !allowedAgents.has(subject.agent_id) ||
      !allowedBuilders.has(subject.builder_address.toLowerCase())
  ).length
  const flow = Object.fromEntries(
    chainFlows.rows.map((entry) => [entry.event_type, entry.count])
  )
  const rolesMatch = Object.entries(manifest.contract.constructor.roles).every(
    ([role, expected]) =>
      finalSnapshot.contract.roles[role]?.toLowerCase() === expected.toLowerCase()
  )
  const feeMatches =
    finalSnapshot.contract.platformFeeBps === manifest.contract.constructor.platformFeeBps
  const outboxAge = finalSnapshot.outbox.oldestRecoverableAgeSeconds
  const staleOutbox =
    outboxAge !== null &&
    outboxAge > policy.thresholds.maxRecoverableOutboxAgeSeconds
      ? 1
      : 0
  const drift = BigInt(finalSnapshot.drift.unexplainedMinor)

  return {
    schemaVersion: 1,
    kind: 'velostra-phase3-canary-summary',
    release,
    sourceManifestSha256: manifest.integrity.manifestSha256,
    policySha256: manifest.policies.canary.sha256,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    calls: {
      total: row?.total ?? 0,
      successful: row?.successful ?? 0,
      failed: row?.failed ?? 0,
    },
    allowlistViolations,
    exposure: {
      maxGrossPerCallMinor: minor(row?.max_gross),
      maxGrossPerWalletMinor: minor(walletExposure.rows[0]?.maximum),
      grossTotalMinor: minor(row?.gross_total),
    },
    flowCounts: {
      deposit: flow.DEPOSIT ?? 0,
      'paid-call': row?.total ?? 0,
      'earnings-credit': flow.EARNINGS_CREDITED ?? 0,
      reconciliation: reconciliation.rows[0]?.count ?? 0,
      'builder-claim': flow.CLAIMED ?? 0,
      'platform-revenue': flow.PLATFORM_REVENUE_WITHDRAWN ?? 0,
      'zero-drift': drift === 0n ? 1 : 0,
    },
    financial: {
      duplicateDebits: duplicates.rows[0]?.count ?? 0,
      duplicateCredits: duplicates.rows[0]?.count ?? 0,
      unexplainedDriftMinor: drift.toString(),
    },
    finalState: {
      contractSolvent: finalSnapshot.contract.solvent,
      cursorLagBlocks: String(finalSnapshot.chain.lagBlocks),
      staleRecoverableOutboxRows: staleOutbox,
      pendingChainEvents: finalSnapshot.chain.pendingEvents,
      unacknowledgedCriticalAlerts: finalSnapshot.alerts.unacknowledgedCritical,
      unexpectedRoleChanges: rolesMatch ? 0 : 1,
      unexpectedFeeChanges: feeMatches ? 0 : 1,
    },
  }
}

async function main(): Promise<void> {
  const summary = await capturePhase3CanarySummary()
  const json = JSON.stringify(summary, null, 2) + '\n'
  const output = process.env.PHASE3_CANARY_SUMMARY_OUTPUT?.trim()
  if (output) {
    const resolved = path.resolve(process.cwd(), output)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, json)
  }
  process.stdout.write(json)
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(
        'Phase 3 canary summary failed:',
        error instanceof Error ? error.message : error
      )
      process.exitCode = 1
    })
    .finally(async () => {
      await pool.end().catch(() => undefined)
    })
}
