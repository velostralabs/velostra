import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { asc, and, eq, sql } from 'drizzle-orm'
import { decodeEventLog, getAddress, type Address, type Hash, type Log } from 'viem'
import { db, pool } from '../db/client.js'
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
  users,
} from '../db/schema.js'
import {
  getVelostraEscrowAddress,
  getVelostraPublicClient,
  tokenUnitsToMoney,
  velostraChainId,
  velostraEscrowAbi,
} from '../lib/gateway/onchain.js'

const intervalMs = positiveIntegerEnv('RECONCILE_INTERVAL_MS', 30_000)
const maxBlockRange = BigInt(positiveIntegerEnv('RECONCILE_MAX_BLOCK_RANGE', 2_000))
const confirmations = BigInt(nonNegativeIntegerEnv('RECONCILE_CONFIRMATIONS', 12))
const rpcRetries = positiveIntegerEnv('RECONCILE_RPC_RETRIES', 3)
const rpcRetryBaseMs = positiveIntegerEnv('RECONCILE_RPC_RETRY_BASE_MS', 1_000)
const driftThreshold = nonNegativeNumberEnv('RECONCILE_DRIFT_THRESHOLD', 0.000001)
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
  amount: number
  secondaryAmount: number | null
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

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value < 0) throw new Error(name + ' must be a non-negative number')
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

async function reconcileStoredEvent(txHash: string, logIndex: number): Promise<boolean> {
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
          .values({ user_id: user.id, balance_usd: 0 })
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

      if (event.event_type === 'EARNINGS_CREDITED') {
        if (!event.correlation_id) {
          await markUnmatched('EarningsCredited event is missing its bytes32 callId')
          return false
        }

        const [call] = await tx
          .select({
            id: agentCalls.id,
            agent_id: agentCalls.agent_id,
            user_id: agentCalls.user_id,
          })
          .from(agentCalls)
          .where(eq(agentCalls.onchain_call_id, event.correlation_id))
          .limit(1)
        if (!call) {
          await markUnmatched(
            'No agent call matches onchain callId ' + event.correlation_id
          )
          return false
        }

        const [callAgent] = await tx
          .select({ builder_id: agents.builder_id })
          .from(agents)
          .where(eq(agents.id, call.agent_id))
          .limit(1)
        if (!callAgent) {
          await markUnmatched('Agent is missing for correlated call ' + call.id)
          return false
        }

        const [builder] = await tx
          .select({ id: builders.id, wallet_address: builders.wallet_address })
          .from(builders)
          .where(eq(builders.id, callAgent.builder_id))
          .limit(1)
        if (
          !builder ||
          builder.wallet_address.toLowerCase() !== event.actor_address.toLowerCase()
        ) {
          await markUnmatched(
            'Earnings builder does not match correlated call ' + call.id
          )
          return false
        }

        // Match the normal paid-call lock order. A live API transaction holds
        // this row before broadcasting; the worker waits for it to commit or
        // roll back instead of racing it into a double debit.
        const [balance] = await tx
          .select({ id: creditBalances.id })
          .from(creditBalances)
          .where(eq(creditBalances.user_id, call.user_id))
          .for('update')
          .limit(1)
        if (!balance) {
          await markUnmatched('Credit balance is missing for correlated call ' + call.id)
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

        const grossAmount = Number(
          (event.amount + (event.secondary_amount ?? 0)).toFixed(6)
        )

        // This conditional transition is the ownership claim shared with the
        // live request path. If another transaction already finalized the call,
        // this transaction must not touch any user/builder/agent ledger.
        const [wonFinalization] = await tx
          .update(agentCalls)
          .set({
            status: 'SUCCESS',
            price_charged: grossAmount,
            builder_earned: event.amount,
            platform_earned: event.secondary_amount ?? 0,
            error_message: null,
            completed_at: event.block_timestamp,
          })
          .where(
            and(
              eq(agentCalls.id, call.id),
              eq(agentCalls.status, 'PROCESSING')
            )
          )
          .returning({ id: agentCalls.id })

        if (!wonFinalization) {
          const [currentCall] = await tx
            .select({ status: agentCalls.status })
            .from(agentCalls)
            .where(eq(agentCalls.id, call.id))
            .limit(1)
          if (currentCall?.status === 'SUCCESS') {
            console.info('[reconcile] correlated call already finalized; no-op ' + call.id)
            await markReconciled()
            return true
          }
          await markUnmatched(
            'Correlated call is not PROCESSING: ' + call.id + ' status=' + (currentCall?.status ?? 'missing')
          )
          return false
        }

        const [existing] = await tx
          .select({ id: transactions.id, agent_call_id: transactions.agent_call_id })
          .from(transactions)
          .where(eq(transactions.tx_hash, event.tx_hash))
          .limit(1)

        if (existing) {
          if (existing.agent_call_id !== call.id) {
            await tx
              .update(transactions)
              .set({ agent_call_id: call.id })
              .where(eq(transactions.id, existing.id))
          }
        } else {
          const [inserted] = await tx
            .insert(transactions)
            .values({
              agent_call_id: call.id,
              type: 'AGENT_CALL',
              amount: grossAmount,
              currency: 'USDG',
              tx_hash: event.tx_hash,
              wallet_address: event.actor_address,
              chain_id: velostraChainId,
              contract_address: getVelostraEscrowAddress(),
              event_name: 'EarningsCredited',
              block_number: event.block_number,
              log_index: event.log_index,
              status: 'CONFIRMED',
              created_at: event.block_timestamp,
              confirmed_at: event.block_timestamp,
            })
            .onConflictDoNothing({ target: transactions.tx_hash })
            .returning({ id: transactions.id })

          if (inserted) {
            // The chain event is authoritative. A later call may have consumed
            // the previously locked credits after the failed transaction, so
            // preserve the debt even if this temporarily makes the balance
            // negative rather than silently undercharging the settled call.
            await tx
              .update(creditBalances)
              .set({
                balance_usd: sql`${creditBalances.balance_usd} - ${grossAmount}`,
                updated_at: new Date(),
              })
              .where(eq(creditBalances.id, balance.id))

            await tx
              .update(builderEarnings)
              .set({
                available: sql`${builderEarnings.available} + ${event.amount}`,
                total_earned: sql`${builderEarnings.total_earned} + ${event.amount}`,
                updated_at: new Date(),
              })
              .where(eq(builderEarnings.builder_id, builder.id))

            await tx
              .update(agents)
              .set({
                total_calls: sql`${agents.total_calls} + 1`,
                total_revenue: sql`${agents.total_revenue} + ${grossAmount}`,
                updated_at: new Date(),
              })
              .where(eq(agents.id, call.agent_id))
          }
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

async function ingestRange(syncId: string, fromBlock: bigint, toBlock: bigint): Promise<number> {
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

  await db
    .update(chainSyncState)
    .set({
      last_processed_block:
        sql`greatest(${chainSyncState.last_processed_block}, ${toBlock})`,
      updated_at: new Date(),
    })
    .where(eq(chainSyncState.id, syncId))

  return events.length
}

async function sumChainEvents(
  syncId: string,
  eventType: EventType,
  includeSecondary = false
): Promise<number> {
  const expression = includeSecondary
    ? sql<string>`coalesce(sum(${chainEvents.amount} + coalesce(${chainEvents.secondary_amount}, 0)), 0)`
    : sql<string>`coalesce(sum(${chainEvents.amount}), 0)`
  const [row] = await db
    .select({ total: expression })
    .from(chainEvents)
    .where(and(eq(chainEvents.sync_state_id, syncId), eq(chainEvents.event_type, eventType)))
  return Number(row?.total ?? 0)
}

async function sumTransactions(
  address: Address,
  type: 'TOPUP' | 'AGENT_CALL' | 'PLATFORM_WITHDRAWAL'
): Promise<number> {
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
  return Number(row?.total ?? 0)
}

async function sumClaims(address: Address): Promise<number> {
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
  return Number(row?.total ?? 0)
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
      Number((value.onchain - value.postgres).toFixed(6)),
    ])
  )
  const exceedsThreshold = Object.values(drift).some(
    (value) => Math.abs(value) > driftThreshold
  )
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

  for (let cursor = fromBlock; cursor <= toBlock; cursor += maxBlockRange) {
    const rangeEnd =
      cursor + maxBlockRange - 1n < toBlock ? cursor + maxBlockRange - 1n : toBlock
    scannedEvents += await ingestRange(syncId, cursor, rangeEnd)
    ranges += 1
    console.info('[reconcile] processed blocks ' + cursor + '-' + rangeEnd)
  }

  const retriedAfterScan = await retryPendingEvents()
  const drift = await reportReconciliationDrift()
  const result = {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    safeHead: safeHead.toString(),
    ranges,
    scannedEvents,
    retriedPending: retriedBeforeScan + retriedAfterScan,
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
