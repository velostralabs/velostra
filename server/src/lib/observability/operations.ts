import { getAddress } from 'viem'
import type { QueryResult } from 'pg'
import { pool } from '../../db/client.js'
import {
  getVelostraEscrowAddress,
  getVelostraPublicClient,
  velostraChainId,
  velostraEscrowAbi,
} from '../gateway/onchain.js'
import {
  getRemoteSettlementSignerAddress,
  settlementSignerMode,
} from '../gateway/signer.js'
import { ensureRedisConnected } from '../redis.js'
import { reportReconciliationDrift } from '../../jobs/reconcile.js'
import { heartbeatAgeSeconds } from './heartbeats.js'

export interface DependencyCheck {
  ok: boolean
  latencyMs: number
  error?: string
}

export interface OperationalSnapshot {
  capturedAt: string
  dependencies: Record<string, DependencyCheck>
  chain: {
    latestBlock?: bigint
    safeHeadBlock?: bigint
    cursorBlock?: bigint
    lagBlocks?: bigint
    pendingEvents?: number
    solvent?: boolean
  }
  outbox: {
    byStatus: Record<string, number>
    oldestRecoverableAgeSeconds?: number
  }
  webhooks: {
    byStatus: Record<string, number>
    oldestPendingAgeSeconds?: number
  }
  drift: {
    available: boolean
    exceedsThreshold: boolean
    values: Record<string, string>
  }
  signer: {
    address?: string
    balanceWei?: bigint
  }
  worker: { ageSeconds?: number }
  webhookWorker: { ageSeconds?: number }
  backup: { ageSeconds?: number }
}

async function checked<T>(
  operation: () => Promise<T>
): Promise<{ check: DependencyCheck; value?: T }> {
  const started = performance.now()
  try {
    const value = await operation()
    return {
      check: { ok: true, latencyMs: Math.round(performance.now() - started) },
      value,
    }
  } catch (error) {
    return {
      check: {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.name : 'UnknownError',
      },
    }
  }
}

export async function executeOperationalReadsInSequence(
  operations: readonly (() => Promise<void>)[]
): Promise<void> {
  for (const operation of operations) await operation()
}

export async function collectOperationalSnapshot(): Promise<OperationalSnapshot> {
  const dependencies: Record<string, DependencyCheck> = {}
  const snapshot: OperationalSnapshot = {
    capturedAt: new Date().toISOString(),
    dependencies,
    chain: {},
    outbox: { byStatus: {} },
    webhooks: { byStatus: {} },
    drift: { available: false, exceedsThreshold: true, values: {} },
    signer: {},
    worker: {},
    webhookWorker: {},
    backup: {},
  }

  const postgres = await checked(async () => {
    await pool.query('select 1')
  })
  dependencies.postgres = postgres.check

  const redis = await checked(async () => {
    const client = await ensureRedisConnected()
    if ((await client.ping()) !== 'PONG') throw new Error('RedisPingError')
  })
  dependencies.redis = redis.check

  const client = getVelostraPublicClient()
  const rpc = await checked(async () => {
    const [chainId, latestBlock] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ])
    if (chainId !== velostraChainId) throw new Error('RpcChainMismatch')
    return latestBlock
  })
  dependencies.rpc = rpc.check
  snapshot.chain.latestBlock = rpc.value

  const contract = await checked(async () => {
    const address = getVelostraEscrowAddress()
    const code = await client.getBytecode({ address })
    if (!code || code === '0x') throw new Error('EscrowCodeMissing')
    return client.readContract({
      address,
      abi: velostraEscrowAbi,
      functionName: 'isSolvent',
    })
  })
  dependencies.contract = contract.check
  snapshot.chain.solvent = contract.value

  const state = await checked(async () => {
    const address = getVelostraEscrowAddress()
    let outboxRows!: QueryResult<{ status: string; count: number }>
    let oldestRow!: QueryResult<{ age_seconds: string | null }>
    let cursorRow!: QueryResult<{ last_processed_block: string }>
    let pendingRow!: QueryResult<{ count: number }>
    let webhookRows!: QueryResult<{ status: string; count: number }>
    let oldestWebhookRow!: QueryResult<{ age_seconds: string | null }>
    let workerAge: number | undefined
    let webhookWorkerAge: number | undefined
    let backupAge: number | undefined

    // Production pools are intentionally small. Keep this fan-out sequential so one
    // observability sweep cannot consume every connection or time out its own reads.
    await executeOperationalReadsInSequence([
      async () => {
        outboxRows = await pool.query<{ status: string; count: number }>(
          'select status, count(*)::int as count from settlement_attempts group by status'
        )
      },
      async () => {
        oldestRow = await pool.query<{ age_seconds: string | null }>(
          `select extract(epoch from (now() - min(updated_at)))::text as age_seconds
           from settlement_attempts
           where status in ('PREPARED','READY','SUBMITTED','AMBIGUOUS','CONFIRMED')`
        )
      },
      async () => {
        cursorRow = await pool.query<{ last_processed_block: string }>(
          `select last_processed_block::text
           from chain_sync_state
           where chain_id = $1 and lower(contract_address) = lower($2)
           limit 1`,
          [velostraChainId, address]
        )
      },
      async () => {
        pendingRow = await pool.query<{ count: number }>(
          'select count(*)::int as count from chain_events where reconciled = false'
        )
      },
      async () => {
        webhookRows = await pool.query<{ status: string; count: number }>(
          'select status, count(*)::int as count from webhook_deliveries group by status'
        )
      },
      async () => {
        oldestWebhookRow = await pool.query<{ age_seconds: string | null }>(
          `select extract(epoch from (now() - min(created_at)))::text as age_seconds
             from webhook_deliveries
            where status in ('PENDING','RETRYING')`
        )
      },
      async () => { workerAge = await heartbeatAgeSeconds('reconciliation-worker') },
      async () => { webhookWorkerAge = await heartbeatAgeSeconds('webhook-worker') },
      async () => { backupAge = await heartbeatAgeSeconds('backup') },
    ])
    return {
      outboxRows,
      oldestRow,
      cursorRow,
      pendingRow,
      webhookRows,
      oldestWebhookRow,
      workerAge,
      webhookWorkerAge,
      backupAge,
    }
  })
  dependencies.operational_state = state.check
  if (state.value) {
    snapshot.outbox.byStatus = Object.fromEntries(
      state.value.outboxRows.rows.map((row) => [row.status, Number(row.count)])
    )
    const oldest = state.value.oldestRow.rows[0]?.age_seconds
    snapshot.outbox.oldestRecoverableAgeSeconds =
      oldest === null || oldest === undefined ? undefined : Number(oldest)
    const cursor = state.value.cursorRow.rows[0]?.last_processed_block
    snapshot.chain.cursorBlock = cursor === undefined ? undefined : BigInt(cursor)
    snapshot.chain.pendingEvents = Number(state.value.pendingRow.rows[0]?.count ?? 0)
    snapshot.webhooks.byStatus = Object.fromEntries(
      state.value.webhookRows.rows.map((row) => [row.status, Number(row.count)])
    )
    const oldestWebhook = state.value.oldestWebhookRow.rows[0]?.age_seconds
    snapshot.webhooks.oldestPendingAgeSeconds =
      oldestWebhook === null || oldestWebhook === undefined ? undefined : Number(oldestWebhook)
    snapshot.worker.ageSeconds = state.value.workerAge
    snapshot.webhookWorker.ageSeconds = state.value.webhookWorkerAge
    snapshot.backup.ageSeconds = state.value.backupAge
  }

  const confirmations = BigInt(process.env.RECONCILE_CONFIRMATIONS ?? '12')
  if (snapshot.chain.latestBlock !== undefined) {
    snapshot.chain.safeHeadBlock =
      snapshot.chain.latestBlock > confirmations
        ? snapshot.chain.latestBlock - confirmations
        : 0n
    if (snapshot.chain.cursorBlock !== undefined) {
      snapshot.chain.lagBlocks =
        snapshot.chain.safeHeadBlock > snapshot.chain.cursorBlock
          ? snapshot.chain.safeHeadBlock - snapshot.chain.cursorBlock
          : 0n
    }
  }

  const drift = await checked(() => reportReconciliationDrift({ log: false }))
  dependencies.drift = drift.check
  if (drift.value) {
    snapshot.drift = {
      available: true,
      exceedsThreshold: drift.value.exceedsThreshold,
      values: drift.value.drift,
    }
  }

  const signer = await checked(async () => {
    if (settlementSignerMode() !== 'remote') return undefined
    const address = getRemoteSettlementSignerAddress()
    return {
      address: getAddress(address),
      balanceWei: await client.getBalance({ address }),
    }
  })
  dependencies.signer = signer.check
  if (signer.value) snapshot.signer = signer.value

  return snapshot
}

export function readinessFromSnapshot(snapshot: OperationalSnapshot | undefined): {
  ready: boolean
  checks: Record<string, boolean>
  capturedAt?: string
} {
  if (!snapshot) return { ready: false, checks: { snapshot: false } }
  const workerMaxAge = Number(process.env.READINESS_WORKER_MAX_AGE_MS ?? 90_000) / 1_000
  const webhookWorkerMaxAge = Number(process.env.READINESS_WEBHOOK_WORKER_MAX_AGE_MS ?? 90_000) / 1_000
  const requireWorker =
    process.env.READINESS_REQUIRE_WORKER === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.READINESS_REQUIRE_WORKER !== 'false')
  const requireWebhookWorker =
    process.env.READINESS_REQUIRE_WEBHOOK_WORKER === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.READINESS_REQUIRE_WEBHOOK_WORKER !== 'false')
  const checks: Record<string, boolean> = {
    postgres: snapshot.dependencies.postgres?.ok === true,
    redis: snapshot.dependencies.redis?.ok === true,
    rpc: snapshot.dependencies.rpc?.ok === true,
    contract: snapshot.dependencies.contract?.ok === true,
    operational_state: snapshot.dependencies.operational_state?.ok === true,
    solvent: snapshot.chain.solvent === true,
  }
  if (requireWorker) {
    checks.worker =
      snapshot.worker.ageSeconds !== undefined &&
      snapshot.worker.ageSeconds <= workerMaxAge
  }
  if (requireWebhookWorker) {
    checks.webhook_worker =
      snapshot.webhookWorker.ageSeconds !== undefined &&
      snapshot.webhookWorker.ageSeconds <= webhookWorkerMaxAge
  }
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    capturedAt: snapshot.capturedAt,
  }
}
