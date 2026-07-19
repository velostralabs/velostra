import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createPublicClient, http } from 'viem'

const APPROVAL = 'isolated-staging-one-hour-outage-approved'
const CHAIN_ID = 46630
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifactsRoot = path.resolve(repositoryRoot, 'artifacts')
const mode = process.argv[2]

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function outputPath() {
  const resolved = path.resolve(repositoryRoot, required('OUTAGE_EVIDENCE_OUTPUT'))
  const relative = path.relative(artifactsRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Outage evidence must stay under artifacts')
  }
  return resolved
}

function statePath() {
  return path.resolve(
    artifactsRoot,
    'staging/evidence/private/one-hour-outage.state.json'
  )
}

function assertGuards() {
  if (required('VELOSTRA_DRILL_APPROVAL') !== APPROVAL) {
    throw new Error('Explicit isolated-staging outage approval is required')
  }
  if (
    required('VELOSTRA_ENVIRONMENT') !== 'staging' ||
    required('ROBINHOOD_CHAIN_ID') !== String(CHAIN_ID) ||
    required('PHASE3_PAID_WRITES_MODE') !== 'disabled'
  ) {
    throw new Error('Outage evidence is locked to write-disabled chain-46630 staging')
  }
}

async function atomicWrite(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = target + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temporary, target)
}

const { Pool } = pg
const databaseUrl = required('DATABASE_URL')
const rpcUrl = required('ROBINHOOD_RPC_URL')
const escrowAddress = required('VELOSTRA_ESCROW_ADDRESS')
const confirmations = BigInt(process.env.RECONCILE_CONFIRMATIONS ?? '12')
const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 10_000,
  ssl: databaseUrl.includes('localhost') ? undefined : { rejectUnauthorized: true },
})
const client = createPublicClient({
  transport: http(rpcUrl, {
    timeout: Number(process.env.ROBINHOOD_RPC_TIMEOUT_MS ?? 10_000),
    retryCount: 2,
  }),
})

async function chainPosition() {
  const [chainId, latestBlock, cursorResult] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    pool.query(
      `select last_processed_block::text
         from chain_sync_state
        where chain_id = $1 and lower(contract_address) = lower($2)
        limit 1`,
      [CHAIN_ID, escrowAddress]
    ),
  ])
  if (chainId !== CHAIN_ID) throw new Error('Outage RPC chain mismatch')
  const cursor = BigInt(cursorResult.rows[0]?.last_processed_block ?? '-1')
  const safeHead = latestBlock > confirmations ? latestBlock - confirmations : 0n
  return {
    latestBlock: latestBlock.toString(),
    safeHead: safeHead.toString(),
    cursor: cursor.toString(),
  }
}

async function databaseState() {
  const [duplicates, pending, recoverable] = await Promise.all([
    pool.query(
      `select
         (select count(*)::int from (
            select tx_hash from transactions
             where tx_hash is not null
             group by tx_hash having count(*) > 1
          ) t) as transaction_duplicates,
         (select count(*)::int from (
            select tx_hash from earnings_claims
             where tx_hash is not null
             group by tx_hash having count(*) > 1
          ) c) as claim_duplicates`
    ),
    pool.query('select count(*)::int as count from chain_events where reconciled = false'),
    pool.query(
      `select count(*)::int as count
         from settlement_attempts
        where status in ('PREPARED','READY','SUBMITTED','AMBIGUOUS','CONFIRMED')`
    ),
  ])
  return {
    duplicateTransactions: Number(duplicates.rows[0]?.transaction_duplicates ?? 0),
    duplicateClaims: Number(duplicates.rows[0]?.claim_duplicates ?? 0),
    pendingChainEvents: Number(pending.rows[0]?.count ?? 0),
    recoverableOutboxRows: Number(recoverable.rows[0]?.count ?? 0),
  }
}

async function readState() {
  return JSON.parse(await fs.readFile(statePath(), 'utf8'))
}

async function main() {
  assertGuards()
  if (!['--before', '--mark-end', '--verify'].includes(mode)) {
    throw new Error('Usage: capture-staging-outage.mjs --before|--mark-end|--verify')
  }

  if (mode === '--before') {
    const state = {
      schemaVersion: 1,
      kind: 'velostra-staging-one-hour-outage-state',
      environment: 'staging',
      chainId: CHAIN_ID,
      release: required('VELOSTRA_RELEASE'),
      startedAt: new Date().toISOString(),
      before: {
        chain: await chainPosition(),
        database: await databaseState(),
      },
    }
    await atomicWrite(statePath(), state)
    console.info('OUTAGE_BASELINE_CAPTURED')
    return
  }

  const state = await readState()
  if (
    state.kind !== 'velostra-staging-one-hour-outage-state' ||
    state.environment !== 'staging' ||
    state.chainId !== CHAIN_ID ||
    state.release !== required('VELOSTRA_RELEASE')
  ) {
    throw new Error('Outage state is not bound to the active staging release')
  }

  if (mode === '--mark-end') {
    if (state.outageEndedAt) throw new Error('Outage end was already marked')
    state.outageEndedAt = new Date().toISOString()
    state.outageTarget = await chainPosition()
    state.outageDurationMs =
      new Date(state.outageEndedAt).getTime() - new Date(state.startedAt).getTime()
    if (state.outageDurationMs < 3_600_000) {
      throw new Error('Managed outage duration is below one hour')
    }
    await atomicWrite(statePath(), state)
    console.info('OUTAGE_TARGET_CAPTURED')
    return
  }

  if (!state.outageEndedAt || !state.outageTarget) {
    throw new Error('Outage target has not been captured')
  }
  const catchUpStartedAt = new Date().toISOString()
  const afterChain = await chainPosition()
  const afterDatabase = await databaseState()
  const { reportReconciliationDrift } = await import('../dist/jobs/reconcile.js')
  const runtimeDatabase = await import('../dist/db/client.js')
  let drift
  try {
    drift = await reportReconciliationDrift({ log: false })
  } finally {
    await runtimeDatabase.pool.end().catch(() => undefined)
  }
  const verifiedAt = new Date().toISOString()
  const targetSafeHead = BigInt(state.outageTarget.safeHead)
  const finalCursor = BigInt(afterChain.cursor)
  const passed =
    state.outageDurationMs >= 3_600_000 &&
    finalCursor >= targetSafeHead &&
    afterDatabase.duplicateTransactions === 0 &&
    afterDatabase.duplicateClaims === 0 &&
    afterDatabase.pendingChainEvents === 0 &&
    afterDatabase.recoverableOutboxRows === 0 &&
    drift.exceedsThreshold === false
  const evidence = {
    schemaVersion: 1,
    kind: 'phase2-one-hour-outage',
    environment: 'staging',
    chainId: CHAIN_ID,
    release: state.release,
    startedAt: state.startedAt,
    outageEndedAt: state.outageEndedAt,
    verifiedAt,
    outageDurationMs: state.outageDurationMs,
    catchUpDurationMs:
      new Date(verifiedAt).getTime() - new Date(catchUpStartedAt).getTime(),
    cursorBefore: state.before.chain.cursor,
    targetSafeHead: state.outageTarget.safeHead,
    cursorAfter: afterChain.cursor,
    skippedChainRanges: finalCursor >= targetSafeHead ? 0 : 1,
    duplicateDebits: afterDatabase.duplicateTransactions,
    duplicateCredits: afterDatabase.duplicateClaims,
    pendingChainEvents: afterDatabase.pendingChainEvents,
    recoverableOutboxRows: afterDatabase.recoverableOutboxRows,
    unexplainedDriftUsd: drift.exceedsThreshold ? 1 : 0,
    passed,
  }
  await atomicWrite(outputPath(), evidence)
  if (!passed) throw new Error('Managed one-hour outage evidence did not pass')
  console.info('ONE_HOUR_OUTAGE_EVIDENCE_PASSED')
}

main()
  .catch((error) => {
    console.error('ONE_HOUR_OUTAGE_EVIDENCE_FAILED', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => undefined)
  })
