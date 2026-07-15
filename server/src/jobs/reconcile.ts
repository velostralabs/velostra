import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { asc, and, eq, inArray, sql } from 'drizzle-orm'
import { decodeEventLog, getAddress, type Address, type Hash, type Log } from 'viem'
import { db, pool } from '../db/client.js'
import { assertProductionConfiguration } from '../lib/config.js'
import {
  agentCalls,
  agents,
  builderEarnings,
  builders,
  chainEvents,
  chainSyncState,
  creditBalances,
  earningsClaims,
  transactions,
  settlementAttempts,
  users,
} from '../db/schema.js'
import {
  broadcastBuilderCredit,
  getVelostraEscrowAddress,
  getVelostraPublicClient,
  tokenUnitsToMoney,
  velostraChainId,
  velostraEscrowAbi,
} from '../lib/gateway/onchain.js'
import { money, moneyToMinor, subtractMoney, type Money } from '../lib/money.js'
import {
  failUnsettledCall,
  finalizeSettlement,
  markSettlementAmbiguous,
  markSettlementConfirmed,
  markSettlementSubmitted,
} from '../lib/gateway/settlement.js'

const intervalMs = positiveIntegerEnv('RECONCILE_INTERVAL_MS', 30_000)
const maxBlockRange = BigInt(positiveIntegerEnv('RECONCILE_MAX_BLOCK_RANGE', 2_000))
const confirmations = BigInt(nonNegativeIntegerEnv('RECONCILE_CONFIRMATIONS', 12))
const rpcRetries = positiveIntegerEnv('RECONCILE_RPC_RETRIES', 3)
const rpcRetryBaseMs = positiveIntegerEnv('RECONCILE_RPC_RETRY_BASE_MS', 1_000)
const driftThreshold = money(process.env.RECONCILE_DRIFT_THRESHOLD ?? '0.000001')
if (moneyToMinor(driftThreshold) < 0n) {
  throw new Error('RECONCILE_DRIFT_THRESHOLD must be non-negative')
}
const deploymentBlock = bigintEnv('VELOSTRA_DEPLOYMENT_BLOCK', 0n)

type ChainEventRow = typeof chainEvents.$inferSelect
type EventType = ChainEventRow['event_type']

interface ReconcileOptions {
  fromBlock?: bigint
  toBlock?: bigint
}

interface ParsedChainEvent {
  eventType: EventType
  txHash: Hash
  logIndex: number
  blockNumber: bigint
  actorAddress: Address
  correlationId: Hash | null
  amount: Money
  secondaryAmount: Money | null
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value <= 0) throw new Error(name + ' must be a positive integer')
  return value
}

function nonNegativeIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 0) throw new Error(name + ' must be a non-negative integer')
  return value
}

function bigintEnv(name: string, fallback: bigint): bigint {
  try {
    return BigInt(process.env[name] ?? fallback)
  } catch {
    throw new Error(name + ' must be an integer block number')
  }
}

function stateId(address: Address): string {
  return 'escrow:' + velostraChainId + ':' + address.toLowerCase()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRpcRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= rpcRetries; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < rpcRetries) {
        const waitMs = Math.min(30_000, rpcRetryBaseMs * 2 ** (attempt - 1))
        console.warn(
          '[reconcile] RPC ' + label + ' failed (attempt ' + attempt + '/' +
            rpcRetries + '); retrying in ' + waitMs + 'ms'
        )
        await sleep(waitMs)
      }
    }
  }
  throw lastError
}

function shouldSplitRpcRange(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (/429|rate.?limit|too many requests/.test(message)) return false
  return /block range|response size|too many results|query returned|timeout|timed out|limit exceeded/.test(
    message
  )
}

async function fetchLogsAdaptive(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  const client = getVelostraPublicClient()
  const address = getVelostraEscrowAddress()
  try {
    return await withRpcRetry('getLogs ' + fromBlock + '-' + toBlock, () =>
      client.getLogs({ address, fromBlock, toBlock })
    )
  } catch (error) {
    if (fromBlock >= toBlock || !shouldSplitRpcRange(error)) throw error
    const middle = (fromBlock + toBlock) / 2n
    console.warn(
      '[reconcile] splitting rejected RPC range ' + fromBlock + '-' + toBlock + ' at ' + middle
    )
    return [
      ...(await fetchLogsAdaptive(fromBlock, middle)),
      ...(await fetchLogsAdaptive(middle + 1n, toBlock)),
    ]
  }
}

function parseLog(
  log: Log
): ParsedChainEvent | null {
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null

  let decoded: ReturnType<typeof decodeEventLog>
  try {
    decoded = decodeEventLog({
      abi: velostraEscrowAbi,
      data: log.data,
      topics: log.topics,
      strict: true,
    })
  } catch {
    return null
  }

  const args = decoded.args as unknown as Record<string, unknown>
  const common = {
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
  }

  switch (decoded.eventName) {
    case 'Deposit':
      return {
        ...common,
        eventType: 'DEPOSIT',
        actorAddress: getAddress(String(args.user)),
        correlationId: null,
        amount: tokenUnitsToMoney(args.amount as bigint),
        secondaryAmount: null,
      }
    case 'EarningsCredited':
      return {
        ...common,
        eventType: 'EARNINGS_CREDITED',
        actorAddress: getAddress(String(args.builder)),
        correlationId: String(args.callId) as Hash,
        amount: tokenUnitsToMoney(args.amount as bigint),
        secondaryAmount: tokenUnitsToMoney(args.platformCut as bigint),
      }
    case 'Claimed':
      return {
        ...common,
        eventType: 'CLAIMED',
        actorAddress: getAddress(String(args.builder)),
        correlationId: null,
        amount: tokenUnitsToMoney(args.amount as bigint),
        secondaryAmount: null,
      }
    case 'PlatformRevenueWithdrawn':
      return {
        ...common,
        eventType: 'PLATFORM_REVENUE_WITHDRAWN',
        actorAddress: getAddress(String(args.to)),
        correlationId: null,
        amount: tokenUnitsToMoney(args.amount as bigint),
        secondaryAmount: null,
      }
    default:
      return null
  }
}

async function markPendingError(id: string, message: string): Promise<void> {
  await db.update(chainEvents).set({ reconciliation_error: message }).where(eq(chainEvents.id, id))
}

async function reconcileEarningsEvent(event: ChainEventRow): Promise<boolean> {
  if (!event.correlation_id) {
    await markPendingError(event.id, 'EarningsCredited event is missing its bytes32 callId')
    return false
  }

  const [call] = await db
    .select({
      id: agentCalls.id,
      builder_id: agents.builder_id,
      builder_wallet: builders.wallet_address,
    })
    .from(agentCalls)
    .innerJoin(agents, eq(agents.id, agentCalls.agent_id))
    .innerJoin(builders, eq(builders.id, agents.builder_id))
    .where(eq(agentCalls.onchain_call_id, event.correlation_id))
    .limit(1)

  if (!call) {
    await markPendingError(event.id, 'No agent call matches onchain callId ' + event.correlation_id)
    return false
  }
  if (call.builder_wallet.toLowerCase() !== event.actor_address.toLowerCase()) {
    await markPendingError(event.id, 'Earnings builder does not match correlated call ' + call.id)
    return false
  }

  const [attempt] = await db
    .select({ id: settlementAttempts.id })
    .from(settlementAttempts)
    .where(eq(settlementAttempts.agent_call_id, call.id))
    .limit(1)
  if (!attempt) {
    await markPendingError(
      event.id,
      'Durable settlement attempt is missing for correlated call ' + call.id
    )
    return false
  }

  try {
    await finalizeSettlement({
      callId: call.id,
      txHash: event.tx_hash as Hash,
      blockNumber: event.block_number,
      logIndex: event.log_index,
      confirmedAt: event.block_timestamp,
      builderAmount: event.amount,
      platformAmount: event.secondary_amount ?? money(0),
      authoritativeEvent: true,
    })
    await db
      .update(chainEvents)
      .set({ reconciled: true, reconciliation_error: null, reconciled_at: new Date() })
      .where(eq(chainEvents.id, event.id))
    return true
  } catch (error) {
    await markPendingError(event.id, error instanceof Error ? error.message : String(error))
    throw error
  }
}
async function reconcileStoredEvent(txHash: string, logIndex: number): Promise<boolean> {
  const [stored] = await db
    .select()
    .from(chainEvents)
    .where(and(eq(chainEvents.tx_hash, txHash), eq(chainEvents.log_index, logIndex)))
    .limit(1)
  if (!stored || stored.reconciled) return true
  if (stored.event_type === 'EARNINGS_CREDITED') {
    return reconcileEarningsEvent(stored)
  }
  try {
    return await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(chainEvents)
        .where(and(eq(chainEvents.tx_hash, txHash), eq(chainEvents.log_index, logIndex)))
        .for('update')
        .limit(1)
      if (!event || event.reconciled) return true

      const markReconciled = async () => {
        await tx
          .update(chainEvents)
          .set({ reconciled: true, reconciliation_error: null, reconciled_at: new Date() })
          .where(eq(chainEvents.id, event.id))
      }
      const markUnmatched = async (message: string) => {
        await tx
          .update(chainEvents)
          .set({ reconciliation_error: message })
          .where(eq(chainEvents.id, event.id))
      }

      if (event.event_type === 'DEPOSIT') {
        const [existing] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.tx_hash, event.tx_hash))
          .limit(1)
        if (existing) {
          await markReconciled()
          return true
        }

        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            sql`lower(${users.wallet_address}) = ${event.actor_address.toLowerCase()}`
          )
          .limit(1)
        if (!user) {
          await markUnmatched('No user matches deposit wallet ' + event.actor_address)
          return false
        }

        await tx
          .insert(creditBalances)
          .values({ user_id: user.id, balance_usd: money(0) })
          .onConflictDoNothing({ target: creditBalances.user_id })
        const [balance] = await tx
          .select({ id: creditBalances.id })
          .from(creditBalances)
          .where(eq(creditBalances.user_id, user.id))
          .for('update')
          .limit(1)
        if (!balance) throw new Error('Unable to create credit balance for deposit')

        const [inserted] = await tx
          .insert(transactions)
          .values({
            credit_balance_id: balance.id,
            type: 'TOPUP',
            amount: event.amount,
            currency: 'USDG',
            tx_hash: event.tx_hash,
            wallet_address: event.actor_address,
            chain_id: velostraChainId,
            contract_address: getVelostraEscrowAddress(),
            event_name: 'Deposit',
            block_number: event.block_number,
            log_index: event.log_index,
            status: 'CONFIRMED',
            created_at: event.block_timestamp,
            confirmed_at: event.block_timestamp,
          })
          .onConflictDoNothing({ target: transactions.tx_hash })
          .returning({ id: transactions.id })

        if (inserted) {
          await tx
            .update(creditBalances)
            .set({
              balance_usd:
                sql`${creditBalances.balance_usd} + ${event.amount}`,
              updated_at: new Date(),
            })
            .where(eq(creditBalances.id, balance.id))
        }
        await markReconciled()
        return true
      }

      if (event.event_type === 'CLAIMED') {
        const [existing] = await tx
          .select({ id: earningsClaims.id })
          .from(earningsClaims)
          .where(eq(earningsClaims.tx_hash, event.tx_hash))
          .limit(1)
        if (existing) {
          await markReconciled()
          return true
        }

        const [builder] = await tx
          .select({ id: builders.id })
          .from(builders)
          .where(
            sql`lower(${builders.wallet_address}) = ${event.actor_address.toLowerCase()}`
          )
          .limit(1)
        if (!builder) {
          await markUnmatched('No builder matches claim wallet ' + event.actor_address)
          return false
        }

        await tx
          .insert(builderEarnings)
          .values({ builder_id: builder.id })
          .onConflictDoNothing({ target: builderEarnings.builder_id })
        await tx
          .select({ id: builderEarnings.id })
          .from(builderEarnings)
          .where(eq(builderEarnings.builder_id, builder.id))
          .for('update')
          .limit(1)

        const [inserted] = await tx
          .insert(earningsClaims)
          .values({
            builder_id: builder.id,
            amount: event.amount,
            status: 'COMPLETED',
            tx_hash: event.tx_hash,
            wallet_address: event.actor_address,
            chain_id: velostraChainId,
            contract_address: getVelostraEscrowAddress(),
            block_number: event.block_number,
            log_index: event.log_index,
            created_at: event.block_timestamp,
            completed_at: event.block_timestamp,
          })
          .onConflictDoNothing({ target: earningsClaims.tx_hash })
          .returning({ id: earningsClaims.id })

        if (inserted) {
          await tx
            .update(builderEarnings)
            .set({
              available:
                sql`greatest(${builderEarnings.available} - ${event.amount}, 0)`,
              total_claimed:
                sql`${builderEarnings.total_claimed} + ${event.amount}`,
              updated_at: new Date(),
            })
            .where(eq(builderEarnings.builder_id, builder.id))
        }
        await markReconciled()
        return true
      }

      const [existing] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.tx_hash, event.tx_hash))
        .limit(1)
      if (!existing) {
        await tx
          .insert(transactions)
          .values({
            type: 'PLATFORM_WITHDRAWAL',
            amount: event.amount,
            currency: 'USDG',
            tx_hash: event.tx_hash,
            wallet_address: event.actor_address,
            chain_id: velostraChainId,
            contract_address: getVelostraEscrowAddress(),
            event_name: 'PlatformRevenueWithdrawn',
            block_number: event.block_number,
            log_index: event.log_index,
            status: 'CONFIRMED',
            created_at: event.block_timestamp,
            confirmed_at: event.block_timestamp,
          })
          .onConflictDoNothing({ target: transactions.tx_hash })
      }
      await markReconciled()
      return true
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[reconcile] failed event ' + txHash + ':' + logIndex, error)
    try {
      const [event] = await db
        .select({ id: chainEvents.id })
        .from(chainEvents)
        .where(and(eq(chainEvents.tx_hash, txHash), eq(chainEvents.log_index, logIndex)))
        .limit(1)
      if (event) await markPendingError(event.id, message)
    } catch {
      // A database outage leaves the event pending; the next run retries it.
    }
    return false
  }
}

async function retryPendingEvents(limit = 1_000): Promise<number> {
  const pending = await db
    .select({ tx_hash: chainEvents.tx_hash, log_index: chainEvents.log_index })
    .from(chainEvents)
    .where(eq(chainEvents.reconciled, false))
    .orderBy(asc(chainEvents.block_number), asc(chainEvents.log_index))
    .limit(limit)

  let healed = 0
  for (const event of pending) {
    if (await reconcileStoredEvent(event.tx_hash, event.log_index)) healed += 1
  }
  return healed
}

const outboxGraceMs = positiveIntegerEnv('RECONCILE_OUTBOX_GRACE_MS', 120_000)

export async function recoverSettlementAttempts(limit = 500): Promise<number> {
  const attempts = await db
    .select()
    .from(settlementAttempts)
    .where(
      inArray(settlementAttempts.status, [
        'PREPARED',
        'READY',
        'SUBMITTED',
        'AMBIGUOUS',
        'CONFIRMED',
      ])
    )
    .orderBy(asc(settlementAttempts.updated_at))
    .limit(limit)

  let recovered = 0
  const staleBefore = Date.now() - outboxGraceMs

  for (const attempt of attempts) {
    if (attempt.status === 'PREPARED') {
      if (attempt.updated_at.getTime() <= staleBefore) {
        if (
          await failUnsettledCall(
            attempt.agent_call_id,
            new Error('Upstream completion was not durably recorded before timeout')
          )
        ) {
          recovered += 1
        }
      }
      continue
    }

    if (attempt.status === 'CONFIRMED' && attempt.tx_hash) {
      await finalizeSettlement({
        callId: attempt.agent_call_id,
        txHash: attempt.tx_hash as Hash,
        blockNumber: attempt.block_number ?? undefined,
        confirmedAt: attempt.confirmed_at ?? new Date(),
      })
      recovered += 1
      continue
    }

    if (!attempt.tx_hash) {
      if (attempt.updated_at.getTime() > staleBefore) continue
      try {
        const hash = await broadcastBuilderCredit(
          getAddress(attempt.builder_address),
          attempt.gross_amount,
          attempt.onchain_call_id as Hash
        )
        await markSettlementSubmitted(attempt.agent_call_id, hash, true)
        recovered += 1
      } catch (error) {
        await markSettlementAmbiguous(attempt.agent_call_id, error)
        console.warn('[reconcile] outbox rebroadcast remains ambiguous', {
          attemptId: attempt.id,
          callId: attempt.agent_call_id,
          error,
        })
      }
      continue
    }

    let receipt
    try {
      receipt = await getVelostraPublicClient().getTransactionReceipt({
        hash: attempt.tx_hash as Hash,
      })
    } catch (error) {
      await markSettlementAmbiguous(
        attempt.agent_call_id,
        error instanceof Error ? error : new Error(String(error)),
        attempt.tx_hash as Hash
      )
      if (attempt.updated_at.getTime() <= staleBefore) {
        console.warn('[reconcile] stale settlement transaction still has no receipt', {
          attemptId: attempt.id,
          callId: attempt.agent_call_id,
          txHash: attempt.tx_hash,
        })
      }
      continue
    }

    if (receipt.status !== 'success') {
      if (attempt.attempt_count > 1 || attempt.last_error === 'RECOVERY_REBROADCAST') {
        await markSettlementAmbiguous(
          attempt.agent_call_id,
          new Error('Recovery rebroadcast reverted; waiting for correlated event'),
          attempt.tx_hash as Hash
        )
      } else if (await failUnsettledCall(attempt.agent_call_id, new Error('Settlement reverted onchain'))) {
        recovered += 1
      }
      continue
    }

    await markSettlementConfirmed(
      attempt.agent_call_id,
      attempt.tx_hash as Hash,
      receipt.blockNumber
    )
    await finalizeSettlement({
      callId: attempt.agent_call_id,
      txHash: attempt.tx_hash as Hash,
      blockNumber: receipt.blockNumber,
      confirmedAt: new Date(),
    })
    recovered += 1
  }

  return recovered
}
async function ingestRange(
  syncId: string,
  fromBlock: bigint,
  toBlock: bigint,
  advanceCursor: boolean
): Promise<number> {
  const rawLogs = await fetchLogsAdaptive(fromBlock, toBlock)
  const events = rawLogs
    .map(parseLog)
    .filter((event): event is ParsedChainEvent => event !== null)
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1
    )

  const blockTimestamps = new Map<bigint, Date>()
  for (const event of events) {
    let timestamp = blockTimestamps.get(event.blockNumber)
    if (!timestamp) {
      const block = await withRpcRetry('getBlock ' + event.blockNumber, () =>
        getVelostraPublicClient().getBlock({ blockNumber: event.blockNumber })
      )
      timestamp = new Date(Number(block.timestamp) * 1_000)
      blockTimestamps.set(event.blockNumber, timestamp)
    }

    await db
      .insert(chainEvents)
      .values({
        sync_state_id: syncId,
        event_type: event.eventType,
        tx_hash: event.txHash,
        log_index: event.logIndex,
        block_number: event.blockNumber,
        block_timestamp: timestamp,
        actor_address: event.actorAddress,
        correlation_id: event.correlationId,
        amount: event.amount,
        secondary_amount: event.secondaryAmount,
      })
      .onConflictDoNothing({ target: [chainEvents.tx_hash, chainEvents.log_index] })

    await reconcileStoredEvent(event.txHash, event.logIndex)
  }

  if (advanceCursor) {
    await db
      .update(chainSyncState)
      .set({
        last_processed_block:
          sql`greatest(${chainSyncState.last_processed_block}, ${toBlock})`,
        updated_at: new Date(),
      })
      .where(eq(chainSyncState.id, syncId))
  }

  return events.length
}

async function sumChainEvents(
  syncId: string,
  eventType: EventType,
  includeSecondary = false
): Promise<Money> {
  const expression = includeSecondary
    ? sql<string>`coalesce(sum(${chainEvents.amount} + coalesce(${chainEvents.secondary_amount}, 0)), 0)`
    : sql<string>`coalesce(sum(${chainEvents.amount}), 0)`
  const [row] = await db
    .select({ total: expression })
    .from(chainEvents)
    .where(and(eq(chainEvents.sync_state_id, syncId), eq(chainEvents.event_type, eventType)))
  return money(row?.total ?? '0')
}

async function sumTransactions(
  address: Address,
  type: 'TOPUP' | 'AGENT_CALL' | 'PLATFORM_WITHDRAWAL'
): Promise<Money> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.chain_id, velostraChainId),
        eq(transactions.contract_address, address),
        eq(transactions.type, type),
        eq(transactions.status, 'CONFIRMED')
      )
    )
  return money(row?.total ?? '0')
}

async function sumClaims(address: Address): Promise<Money> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${earningsClaims.amount}), 0)` })
    .from(earningsClaims)
    .where(
      and(
        eq(earningsClaims.chain_id, velostraChainId),
        eq(earningsClaims.contract_address, address),
        eq(earningsClaims.status, 'COMPLETED')
      )
    )
  return money(row?.total ?? '0')
}

export async function reportReconciliationDrift() {
  const address = getVelostraEscrowAddress()
  const syncId = stateId(address)
  const totals = {
    deposits: {
      onchain: await sumChainEvents(syncId, 'DEPOSIT'),
      postgres: await sumTransactions(address, 'TOPUP'),
    },
    claims: {
      onchain: await sumChainEvents(syncId, 'CLAIMED'),
      postgres: await sumClaims(address),
    },
    earnings: {
      onchain: await sumChainEvents(syncId, 'EARNINGS_CREDITED', true),
      postgres: await sumTransactions(address, 'AGENT_CALL'),
    },
    platformWithdrawals: {
      onchain: await sumChainEvents(syncId, 'PLATFORM_REVENUE_WITHDRAWN'),
      postgres: await sumTransactions(address, 'PLATFORM_WITHDRAWAL'),
    },
  }
  const drift = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [
      key,
      subtractMoney(value.onchain, value.postgres),
    ])
  ) as Record<string, Money>
  const thresholdMinor = moneyToMinor(driftThreshold)
  const exceedsThreshold = Object.values(drift).some((value) => {
    const units = moneyToMinor(value)
    return (units < 0n ? -units : units) > thresholdMinor
  })
  const log = exceedsThreshold ? console.warn : console.info
  log(
    '[reconcile] ' + (exceedsThreshold ? 'DRIFT WARNING ' : 'drift clean ') +
      JSON.stringify({ threshold: driftThreshold, totals, drift })
  )
  return { totals, drift, exceedsThreshold }
}

export async function runReconciliation(options: ReconcileOptions = {}) {
  const address = getVelostraEscrowAddress()
  const syncId = stateId(address)
  const initialLastProcessed = deploymentBlock > 0n ? deploymentBlock - 1n : -1n

  await db
    .insert(chainSyncState)
    .values({
      id: syncId,
      chain_id: velostraChainId,
      contract_address: address,
      last_processed_block: initialLastProcessed,
    })
    .onConflictDoNothing({ target: chainSyncState.id })

  const [state] = await db
    .select()
    .from(chainSyncState)
    .where(eq(chainSyncState.id, syncId))
    .limit(1)
  if (!state) throw new Error('Unable to initialize chain sync state')

  const latestBlock = await withRpcRetry('getBlockNumber', () =>
    getVelostraPublicClient().getBlockNumber()
  )
  const safeHead = latestBlock > confirmations ? latestBlock - confirmations : 0n
  let fromBlock = options.fromBlock ?? state.last_processed_block + 1n
  if (fromBlock < deploymentBlock) fromBlock = deploymentBlock
  const requestedTo = options.toBlock ?? safeHead
  const toBlock = requestedTo < safeHead ? requestedTo : safeHead

  const retriedBeforeScan = await retryPendingEvents()
  let scannedEvents = 0
  let ranges = 0

  let cursorAdvanceEnabled = fromBlock === state.last_processed_block + 1n
  for (let cursor = fromBlock; cursor <= toBlock; cursor += maxBlockRange) {
    const rangeEnd =
      cursor + maxBlockRange - 1n < toBlock ? cursor + maxBlockRange - 1n : toBlock
    scannedEvents += await ingestRange(syncId, cursor, rangeEnd, cursorAdvanceEnabled)
    ranges += 1
    console.info(
      '[reconcile] processed blocks ' + cursor + '-' + rangeEnd +
        (cursorAdvanceEnabled ? ' (cursor advanced)' : ' (retroactive cursor preserved)')
    )
  }

  const retriedAfterScan = await retryPendingEvents()
  const recoveredOutbox = await recoverSettlementAttempts()
  const drift = await reportReconciliationDrift()
  const result = {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    safeHead: safeHead.toString(),
    ranges,
    scannedEvents,
    retriedPending: retriedBeforeScan + retriedAfterScan,
    recoveredOutbox,
    drift,
  }
  console.info('[reconcile] run complete ' + JSON.stringify(result))
  return result
}

function parseBlockArgument(name: string): bigint | undefined {
  const prefix = '--' + name + '='
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return undefined
  try {
    return BigInt(raw)
  } catch {
    throw new Error(prefix + ' expects an integer')
  }
}

async function main(): Promise<void> {
  assertProductionConfiguration()
  const watch = process.argv.includes('--watch')
  const options = {
    fromBlock: parseBlockArgument('from-block'),
    toBlock: parseBlockArgument('to-block'),
  }

  if (!watch) {
    await runReconciliation(options)
    await pool.end()
    return
  }

  let stopping = false
  const stop = () => {
    stopping = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  let nextOptions: ReconcileOptions = options
  while (!stopping) {
    try {
      await runReconciliation(nextOptions)
      nextOptions = {}
    } catch (error) {
      console.error('[reconcile] worker iteration failed', error)
    }
    if (!stopping) await sleep(intervalMs)
  }
  await pool.end()
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  main().catch(async (error) => {
    console.error('[reconcile] fatal', error)
    await pool.end().catch(() => undefined)
    process.exitCode = 1
  })
}
