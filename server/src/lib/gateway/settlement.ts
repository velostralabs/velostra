import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { Hash } from 'viem'
import { db } from '../../db/client.js'
import {
  agentCalls,
  agents,
  builderEarnings,
  creditBalances,
  settlementAttempts,
  transactions,
} from '../../db/schema.js'
import { compareMoney } from '../money.js'

export interface FinalizeSettlementInput {
  callId: string
  txHash: Hash
  blockNumber?: bigint
  logIndex?: number
  confirmedAt?: Date
  builderAmount?: string
  platformAmount?: string
  authoritativeEvent?: boolean
}

export async function finalizeSettlement(input: FinalizeSettlementInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(settlementAttempts)
      .where(eq(settlementAttempts.agent_call_id, input.callId))
      .for('update')
      .limit(1)
    if (!attempt) throw new Error('Settlement attempt is missing for call ' + input.callId)
    if (attempt.status === 'FAILED') throw new Error('Cannot finalize failed settlement ' + attempt.id)
    const hashMismatch =
      attempt.tx_hash && attempt.tx_hash.toLowerCase() !== input.txHash.toLowerCase()
    if (hashMismatch && !input.authoritativeEvent) {
      throw new Error('Settlement transaction hash does not match durable attempt')
    }
    if (
      (input.builderAmount && compareMoney(input.builderAmount, attempt.builder_amount) !== 0) ||
      (input.platformAmount && compareMoney(input.platformAmount, attempt.platform_amount) !== 0)
    ) {
      throw new Error('Onchain settlement amounts do not match durable attempt')
    }
    if (hashMismatch) {
      console.warn('[settlement] authoritative correlated event replaced an ambiguous tx hash', {
        callId: input.callId,
        previousTxHash: attempt.tx_hash,
        confirmedTxHash: input.txHash,
      })
    }

    const [call] = await tx
      .select({
        id: agentCalls.id,
        agent_id: agentCalls.agent_id,
        user_id: agentCalls.user_id,
        status: agentCalls.status,
      })
      .from(agentCalls)
      .where(eq(agentCalls.id, input.callId))
      .limit(1)
    if (!call) throw new Error('Agent call is missing for settlement ' + attempt.id)

    const [callAgent] = await tx
      .select({ builder_id: agents.builder_id })
      .from(agents)
      .where(eq(agents.id, call.agent_id))
      .limit(1)
    if (!callAgent) throw new Error('Agent is missing for settlement ' + attempt.id)

    const confirmedAt = input.confirmedAt ?? new Date()
    const [won] = await tx
      .update(agentCalls)
      .set({
        status: 'SUCCESS',
        price_charged: attempt.gross_amount,
        builder_earned: attempt.builder_amount,
        platform_earned: attempt.platform_amount,
        error_message: null,
        completed_at: confirmedAt,
      })
      .where(and(eq(agentCalls.id, input.callId), eq(agentCalls.status, 'PROCESSING')))
      .returning({ id: agentCalls.id })

    if (!won) {
      const [current] = await tx
        .select({ status: agentCalls.status })
        .from(agentCalls)
        .where(eq(agentCalls.id, input.callId))
        .limit(1)
      if (current?.status !== 'SUCCESS') {
        throw new Error('Settlement call cannot transition from ' + (current?.status ?? 'missing'))
      }
      console.info('[settlement] conditional finalization already owned; guarded no-op', {
        callId: input.callId,
        txHash: input.txHash,
      })
      await tx
        .update(settlementAttempts)
        .set({
          status: 'APPLIED',
          tx_hash: input.txHash,
          block_number: input.blockNumber ?? attempt.block_number,
          confirmed_at: attempt.confirmed_at ?? confirmedAt,
          applied_at: attempt.applied_at ?? confirmedAt,
          last_error: null,
          updated_at: new Date(),
        })
        .where(eq(settlementAttempts.id, attempt.id))
      return false
    }

    const [ledgerRow] = await tx
      .insert(transactions)
      .values({
        agent_call_id: call.id,
        type: 'AGENT_CALL',
        amount: attempt.gross_amount,
        currency: 'USDG',
        tx_hash: input.txHash,
        wallet_address: attempt.builder_address,
        chain_id: attempt.chain_id,
        contract_address: attempt.contract_address,
        event_name: 'EarningsCredited',
        block_number: input.blockNumber,
        log_index: input.logIndex,
        status: 'CONFIRMED',
        confirmed_at: confirmedAt,
      })
      .onConflictDoNothing({ target: transactions.tx_hash })
      .returning({ id: transactions.id })

    if (!ledgerRow) {
      const [existing] = await tx
        .select({ agent_call_id: transactions.agent_call_id })
        .from(transactions)
        .where(eq(transactions.tx_hash, input.txHash))
        .limit(1)
      if (!existing || existing.agent_call_id !== call.id) {
        throw new Error('Settlement transaction hash is already owned by another ledger entry')
      }
    }

    const [debited] = await tx
      .update(creditBalances)
      .set({
        balance_usd: sql`${creditBalances.balance_usd} - ${attempt.gross_amount}`,
        reserved_usd: sql`${creditBalances.reserved_usd} - ${attempt.gross_amount}`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(creditBalances.user_id, call.user_id),
          gte(creditBalances.reserved_usd, attempt.gross_amount),
          gte(creditBalances.balance_usd, attempt.gross_amount)
        )
      )
      .returning({ id: creditBalances.id })
    if (!debited) throw new Error('Reserved user credit is missing for settlement ' + attempt.id)

    const [credited] = await tx
      .update(builderEarnings)
      .set({
        available: sql`${builderEarnings.available} + ${attempt.builder_amount}`,
        total_earned: sql`${builderEarnings.total_earned} + ${attempt.builder_amount}`,
        updated_at: new Date(),
      })
      .where(eq(builderEarnings.builder_id, callAgent.builder_id))
      .returning({ id: builderEarnings.id })
    if (!credited) throw new Error('Builder earnings record is missing for settlement ' + attempt.id)

    await tx
      .update(agents)
      .set({
        total_calls: sql`${agents.total_calls} + 1`,
        total_revenue: sql`${agents.total_revenue} + ${attempt.gross_amount}`,
        updated_at: new Date(),
      })
      .where(eq(agents.id, call.agent_id))

    await tx
      .update(settlementAttempts)
      .set({
        status: 'APPLIED',
        tx_hash: input.txHash,
        block_number: input.blockNumber ?? attempt.block_number,
        confirmed_at: attempt.confirmed_at ?? confirmedAt,
        applied_at: confirmedAt,
        last_error: null,
        updated_at: new Date(),
      })
      .where(eq(settlementAttempts.id, attempt.id))

    return true
  })
}

export async function markSettlementReady(callId: string): Promise<void> {
  const [updated] = await db
    .update(settlementAttempts)
    .set({ status: 'READY', last_error: null, updated_at: new Date() })
    .where(
      and(
        eq(settlementAttempts.agent_call_id, callId),
        eq(settlementAttempts.status, 'PREPARED')
      )
    )
    .returning({ id: settlementAttempts.id })
  if (!updated) throw new Error('Settlement attempt was not PREPARED after upstream completion')
}
export async function markSettlementSubmitted(
  callId: string,
  txHash: Hash,
  recoveryBroadcast = false
): Promise<void> {
  const [updated] = await db
    .update(settlementAttempts)
    .set({
      status: 'SUBMITTED',
      tx_hash: txHash,
      submitted_at: new Date(),
      attempt_count: sql`${settlementAttempts.attempt_count} + 1`,
      last_error: recoveryBroadcast ? 'RECOVERY_REBROADCAST' : null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(settlementAttempts.agent_call_id, callId),
        inArray(settlementAttempts.status, ['READY', 'AMBIGUOUS']),
        isNull(settlementAttempts.tx_hash)
      )
    )
    .returning({ id: settlementAttempts.id })
  if (!updated) throw new Error('Settlement attempt was not PREPARED for broadcast persistence')
}

export async function markSettlementConfirmed(
  callId: string,
  txHash: Hash,
  blockNumber: bigint
): Promise<void> {
  await db
    .update(settlementAttempts)
    .set({
      status: 'CONFIRMED',
      tx_hash: txHash,
      block_number: blockNumber,
      confirmed_at: new Date(),
      last_error: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(settlementAttempts.agent_call_id, callId),
        eq(settlementAttempts.tx_hash, txHash)
      )
    )
}

export async function markSettlementAmbiguous(
  callId: string,
  error: unknown,
  txHash?: Hash
): Promise<void> {
  await db
    .update(settlementAttempts)
    .set({
      status: 'AMBIGUOUS',
      ...(txHash ? { tx_hash: txHash, submitted_at: new Date() } : {}),
      ...(!txHash ? { attempt_count: sql`${settlementAttempts.attempt_count} + 1` } : {}),
      last_error: error instanceof Error ? error.message : String(error),
      updated_at: new Date(),
    })
    .where(eq(settlementAttempts.agent_call_id, callId))
}

export async function failUnsettledCall(callId: string, error: unknown): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(settlementAttempts)
      .where(eq(settlementAttempts.agent_call_id, callId))
      .for('update')
      .limit(1)

    const [failed] = await tx
      .update(agentCalls)
      .set({
        status: 'FAILED',
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date(),
      })
      .where(and(eq(agentCalls.id, callId), eq(agentCalls.status, 'PROCESSING')))
      .returning({ user_id: agentCalls.user_id })

    if (!failed) return false

    if (attempt) {
      const [released] = await tx
        .update(creditBalances)
        .set({
          reserved_usd: sql`${creditBalances.reserved_usd} - ${attempt.gross_amount}`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(creditBalances.user_id, failed.user_id),
            gte(creditBalances.reserved_usd, attempt.gross_amount)
          )
        )
        .returning({ id: creditBalances.id })
      if (!released) throw new Error('Unable to release settlement reservation ' + attempt.id)

      await tx
        .update(settlementAttempts)
        .set({
          status: 'FAILED',
          last_error: error instanceof Error ? error.message : String(error),
          updated_at: new Date(),
        })
        .where(eq(settlementAttempts.id, attempt.id))
    }
    return true
  })
}
