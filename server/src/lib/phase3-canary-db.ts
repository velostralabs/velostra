import { and, count, eq, sql, sum } from 'drizzle-orm'
import { db } from '../db/client.js'
import { releaseCanaryAdmissions } from '../db/schema.js'
import {
  assertPhase3CanaryCapacity,
  moneyToMinor,
  type Phase3CanaryAdmission,
} from './phase3-canary.js'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function persistPhase3CanaryAdmission(
  tx: DatabaseTransaction,
  callId: string,
  admission: Phase3CanaryAdmission
): Promise<void> {
  const lockKey =
    'velostra-phase3-canary:' + admission.release + ':' + admission.policySha256

  // A transaction-scoped advisory lock serializes the read-check-insert sequence.
  // Concurrent requests therefore cannot both observe capacity below the same cap.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`)

  // Capacity belongs to the release-policy pair. Reissuing an otherwise valid
  // manifest must not reset accumulated exposure.
  const identity = and(
    eq(releaseCanaryAdmissions.release, admission.release),
    eq(releaseCanaryAdmissions.policy_sha256, admission.policySha256)
  )
  const [totalUsage] = await tx
    .select({
      callCount: count(),
      grossTotal: sum(releaseCanaryAdmissions.gross_amount),
    })
    .from(releaseCanaryAdmissions)
    .where(identity)
  const [walletUsage] = await tx
    .select({ grossTotal: sum(releaseCanaryAdmissions.gross_amount) })
    .from(releaseCanaryAdmissions)
    .where(
      and(
        identity,
        eq(releaseCanaryAdmissions.wallet_address, admission.walletAddress)
      )
    )

  assertPhase3CanaryCapacity(admission, {
    callCount: totalUsage?.callCount ?? 0,
    grossTotalMinor: moneyToMinor(totalUsage?.grossTotal ?? '0'),
    grossWalletMinor: moneyToMinor(walletUsage?.grossTotal ?? '0'),
  })

  await tx.insert(releaseCanaryAdmissions).values({
    agent_call_id: callId,
    release: admission.release,
    manifest_sha256: admission.manifestSha256,
    policy_sha256: admission.policySha256,
    wallet_address: admission.walletAddress,
    agent_id: admission.agentId,
    builder_address: admission.builderAddress,
    gross_amount: String(admission.grossMinor / 1_000_000n) + '.' +
      String(admission.grossMinor % 1_000_000n).padStart(6, '0'),
    status: 'ADMITTED',
  })
}
