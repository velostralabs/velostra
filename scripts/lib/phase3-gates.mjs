import { sealManifest } from './phase3-release.mjs'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const RECOVERABLE_OUTBOX = [
  'PREPARED',
  'READY',
  'SUBMITTED',
  'AMBIGUOUS',
  'CONFIRMED',
]

function integer(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function bigint(value) {
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

function bigintLte(actual, expected) {
  const actualValue = bigint(actual)
  const expectedValue = bigint(expected)
  return actualValue !== undefined && expectedValue !== undefined && actualValue <= expectedValue
}

function address(value) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function result(kind, release, checks, extra = {}) {
  const failures = checks.filter((entry) => !entry.passed)
  return {
    schemaVersion: 1,
    kind,
    release,
    evaluatedAt: extra.evaluatedAt ?? new Date().toISOString(),
    passed: failures.length === 0,
    checks,
    failures: failures.map((entry) => entry.name),
    ...extra,
  }
}

function checker() {
  const checks = []
  return {
    checks,
    check(name, condition, actual, expected) {
      checks.push({
        name,
        passed: Boolean(condition),
        ...(actual !== undefined ? { actual } : {}),
        ...(expected !== undefined ? { expected } : {}),
      })
    },
  }
}

export function evaluateReadiness({
  manifest,
  policy,
  snapshot,
  evaluatedAt,
}) {
  const { checks, check } = checker()
  check('snapshot_kind', snapshot?.kind === 'velostra-phase3-operational-snapshot')
  check('release_identity', snapshot?.release === manifest?.release)
  check('environment_identity', snapshot?.environment === manifest?.environment)
  check('deployed_manifest', manifest?.stage === 'deployed')
  check(
    'manifest_identity',
    snapshot?.sourceManifestSha256 === manifest?.integrity?.manifestSha256
  )
  check(
    'snapshot_timestamp',
    !Number.isNaN(Date.parse(snapshot?.capturedAt ?? ''))
  )

  for (const dependency of [
    'postgres',
    'redis',
    'primaryRpc',
    'fallbackRpc',
    'signer',
    'contract',
    'operationalState',
  ]) {
    check(
      'dependency_' + dependency,
      snapshot?.dependencies?.[dependency]?.ok === true
    )
  }

  const confirmations = integer(manifest?.chain?.confirmations)
  const latestBlock = bigint(snapshot?.chain?.latestBlock)
  const safeHead = bigint(snapshot?.chain?.safeHeadBlock)
  const cursor = bigint(snapshot?.chain?.cursorBlock)
  const lag = bigint(snapshot?.chain?.lagBlocks)
  const expectedSafeHead =
    latestBlock !== undefined && confirmations !== undefined
      ? latestBlock > BigInt(confirmations)
        ? latestBlock - BigInt(confirmations)
        : 0n
      : undefined
  check('chain_id', snapshot?.chain?.chainId === manifest?.chain?.id)
  check('rpc_chain_agreement', snapshot?.chain?.rpcAgreement === true)
  check(
    'safe_head_formula',
    safeHead !== undefined &&
      expectedSafeHead !== undefined &&
      safeHead === expectedSafeHead
  )
  check(
    'cursor_at_safe_head',
    cursor !== undefined && safeHead !== undefined && cursor >= safeHead
  )
  check(
    'cursor_lag',
    lag !== undefined &&
      lag <= BigInt(policy?.thresholds?.maxCursorLagBlocks ?? -1),
    lag?.toString(),
    String(policy?.thresholds?.maxCursorLagBlocks)
  )
  check(
    'pending_chain_events',
    snapshot?.chain?.pendingEvents <=
      policy?.thresholds?.maxPendingChainEvents,
    snapshot?.chain?.pendingEvents,
    policy?.thresholds?.maxPendingChainEvents
  )

  const expectedContract = manifest?.contract
  const expectedConstructor = expectedContract?.constructor
  check(
    'contract_address',
    address(snapshot?.contract?.address) === address(expectedContract?.address)
  )
  check(
    'deployment_verification',
    snapshot?.contract?.deploymentVerified === true
  )
  check(
    'deployment_block',
    snapshot?.contract?.deploymentBlock === expectedContract?.deploymentBlock
  )
  check(
    'settlement_token',
    address(snapshot?.contract?.settlementToken) ===
      address(expectedConstructor?.settlementToken)
  )
  check(
    'platform_fee',
    snapshot?.contract?.platformFeeBps === expectedConstructor?.platformFeeBps
  )
  check('contract_unpaused', snapshot?.contract?.paused === false)
  check('contract_solvent', snapshot?.contract?.solvent === true)
  check(
    'successor_unset',
    snapshot?.contract?.successorEscrow === null ||
      address(snapshot?.contract?.successorEscrow) === ZERO_ADDRESS
  )
  for (const role of ['admin', 'settler', 'treasury', 'pauseGuardian']) {
    check(
      'role_' + role,
      address(snapshot?.contract?.roles?.[role]) ===
        address(expectedConstructor?.roles?.[role])
    )
  }

  check(
    'database_journal',
    snapshot?.database?.journalSha256 ===
      manifest?.repository?.drizzleJournal?.sha256
  )
  check(
    'database_migrations',
    snapshot?.database?.appliedMigrations ===
      manifest?.repository?.migrations?.length
  )
  check('managed_pitr', snapshot?.database?.managedPitrVerified === true)
  check('images_verified', snapshot?.images?.verified === true)
  check('paid_writes_disabled', snapshot?.paidWritesDisabled === true)

  check(
    'signer_identity',
    address(snapshot?.signer?.address) ===
      address(expectedConstructor?.roles?.settler)
  )
  const signerBalance = bigint(snapshot?.signer?.balanceWei)
  const signerMinimum = bigint(policy?.thresholds?.minSignerBalanceWei)
  check(
    'signer_balance',
    signerBalance !== undefined &&
      signerMinimum !== undefined &&
      signerBalance >= signerMinimum,
    signerBalance?.toString(),
    signerMinimum?.toString()
  )
  check(
    'worker_heartbeat',
    typeof snapshot?.worker?.ageSeconds === 'number' &&
      snapshot.worker.ageSeconds <= policy?.thresholds?.maxWorkerAgeSeconds,
    snapshot?.worker?.ageSeconds,
    policy?.thresholds?.maxWorkerAgeSeconds
  )
  check(
    'backup_heartbeat',
    typeof snapshot?.backup?.ageSeconds === 'number' &&
      snapshot.backup.ageSeconds <= policy?.thresholds?.maxBackupAgeSeconds,
    snapshot?.backup?.ageSeconds,
    policy?.thresholds?.maxBackupAgeSeconds
  )

  for (const status of RECOVERABLE_OUTBOX) {
    check(
      'outbox_' + status.toLowerCase(),
      Number(snapshot?.outbox?.byStatus?.[status] ?? 0) === 0
    )
  }
  check(
    'outbox_age',
    snapshot?.outbox?.oldestRecoverableAgeSeconds === null ||
      snapshot?.outbox?.oldestRecoverableAgeSeconds === undefined ||
      snapshot.outbox.oldestRecoverableAgeSeconds <=
        policy?.thresholds?.maxRecoverableOutboxAgeSeconds
  )
  const driftValue = bigint(snapshot?.drift?.unexplainedMinor)
  const driftLimit = bigint(policy?.thresholds?.maxUnexplainedDriftMinor)
  check(
    'financial_drift',
    snapshot?.drift?.exceedsThreshold === false &&
      driftValue !== undefined &&
      driftLimit !== undefined &&
      driftValue === driftLimit
  )
  check(
    'critical_alerts',
    snapshot?.alerts?.unacknowledgedCritical <=
      policy?.thresholds?.maxUnacknowledgedCriticalAlerts
  )
  check(
    'operator_alert_delivery',
    snapshot?.alerts?.operatorDeliveryVerified === true
  )

  const output = result(
    'velostra-phase3-readiness-decision',
    manifest?.release,
    checks,
    {
      evaluatedAt,
      decision: 'NO-GO',
      paidWritesAllowed: false,
      safeHeadBlock: safeHead?.toString(),
      cursorBlock: cursor?.toString(),
    }
  )
  if (output.passed) {
    output.decision = 'GO'
    output.paidWritesAllowed = true
  }
  return output
}

export function evaluateCatchup({
  release,
  evidence,
  maxBlockRange,
  catchUpSloMs,
  evaluatedAt,
}) {
  const { checks, check } = checker()
  check('evidence_kind', evidence?.kind === 'velostra-phase3-catchup-evidence')
  check('release_identity', evidence?.release === release)
  check('one_hour_outage', evidence?.outageDurationMs >= 60 * 60 * 1_000)
  check(
    'catchup_slo',
    evidence?.catchUpDurationMs >= 0 &&
      evidence?.catchUpDurationMs <= catchUpSloMs,
    evidence?.catchUpDurationMs,
    catchUpSloMs
  )
  check(
    'configured_range',
    positiveRange(maxBlockRange) &&
      evidence?.maxBlockRange === maxBlockRange
  )

  const startCursor = bigint(evidence?.startCursorBlock)
  const safeHead = bigint(evidence?.safeHeadBlock)
  const finalCursor = bigint(evidence?.finalCursorBlock)
  const ranges = evidence?.queriedRanges ?? []
  let expectedFrom =
    startCursor === undefined ? undefined : startCursor + 1n
  let contiguous = Array.isArray(ranges) && ranges.length > 0
  let bounded = contiguous
  for (const range of ranges) {
    const from = bigint(range?.fromBlock)
    const to = bigint(range?.toBlock)
    if (
      from === undefined ||
      to === undefined ||
      expectedFrom === undefined ||
      from !== expectedFrom ||
      to < from
    ) {
      contiguous = false
      bounded = false
      continue
    }
    if (to - from + 1n > BigInt(maxBlockRange)) bounded = false
    expectedFrom = to + 1n
  }
  check('ranges_contiguous', contiguous)
  check('ranges_bounded', bounded)
  check(
    'ranges_reach_safe_head',
    expectedFrom !== undefined &&
      safeHead !== undefined &&
      expectedFrom - 1n === safeHead
  )
  check(
    'final_cursor',
    finalCursor !== undefined &&
      safeHead !== undefined &&
      finalCursor >= safeHead
  )
  check(
    'cursor_checkpoints',
    Array.isArray(evidence?.cursorCheckpoints) &&
      evidence.cursorCheckpoints.length === ranges.length &&
      bigint(evidence.cursorCheckpoints.at(-1)) === finalCursor
  )
  check('restart_resume', evidence?.restart?.resumedFromCheckpoint === true)
  check('restart_observed', evidence?.restart?.workerRestarted === true)
  check('exponential_backoff', evidence?.rpc?.exponentialBackoff === true)
  check('range_split', evidence?.rpc?.adaptiveRangeSplit === true)
  check('fallback_verified', evidence?.rpc?.fallbackVerified === true)
  check('skipped_ranges', evidence?.skippedRanges === 0)
  check('duplicate_debits', evidence?.duplicateDebits === 0)
  check('duplicate_credits', evidence?.duplicateCredits === 0)
  check('unexplained_drift', bigint(evidence?.unexplainedDriftMinor) === 0n)

  return result('velostra-phase3-catchup-decision', release, checks, {
    evaluatedAt,
    decision: checks.every((entry) => entry.passed) ? 'PASS' : 'FAIL',
  })
}

function positiveRange(value) {
  return Number.isInteger(value) && value > 0
}

export function buildCanaryStopPlan(policy, failures) {
  return {
    stopRequired: failures.length > 0,
    reasons: failures,
    actions: failures.length > 0 ? policy.stopActions : [],
    rollback: {
      strategy: policy.rollback.strategy,
      destructiveDatabaseRollbackAllowed: false,
      preserveClaims: true,
      preserveReconciliation: true,
    },
  }
}

export function evaluateCanary({
  manifest,
  policy,
  summary,
  evaluatedAt,
}) {
  const { checks, check } = checker()
  check('summary_kind', summary?.kind === 'velostra-phase3-canary-summary')
  check('deployed_manifest', manifest?.stage === 'deployed')
  check('policy_enabled', policy?.enabled === true)
  check('release_identity', summary?.release === manifest?.release)
  check(
    'manifest_identity',
    summary?.sourceManifestSha256 === manifest?.integrity?.manifestSha256
  )
  check(
    'policy_identity',
    summary?.policySha256 === manifest?.policies?.canary?.sha256
  )

  const startedAt = Date.parse(summary?.startedAt ?? '')
  const endedAt = Date.parse(summary?.endedAt ?? '')
  const duration = endedAt - startedAt
  check(
    'duration',
    Number.isFinite(duration) &&
      duration >= 0 &&
      duration <= policy?.limits?.durationSeconds * 1_000
  )
  check(
    'call_count',
    positiveRange(summary?.calls?.total) &&
      summary.calls.total <= policy?.limits?.maxCalls
  )
  check(
    'call_accounting',
    summary?.calls?.successful + summary?.calls?.failed ===
      summary?.calls?.total
  )
  const totalCalls = summary?.calls?.total ?? 0
  const errorRate = totalCalls > 0 ? summary.calls.failed / totalCalls : 1
  check(
    'error_rate',
    errorRate <= policy?.thresholds?.maxErrorRate,
    errorRate,
    policy?.thresholds?.maxErrorRate
  )
  check('allowlist_violations', summary?.allowlistViolations === 0)
  check(
    'max_per_call',
    bigintLte(summary?.exposure?.maxGrossPerCallMinor, policy?.limits?.maxGrossPerCallMinor)
  )
  check(
    'max_per_wallet',
    bigintLte(summary?.exposure?.maxGrossPerWalletMinor, policy?.limits?.maxGrossPerWalletMinor)
  )
  check(
    'max_total',
    bigintLte(summary?.exposure?.grossTotalMinor, policy?.limits?.maxGrossTotalMinor)
  )
  for (const flow of policy?.requiredFlow ?? []) {
    check(
      'flow_' + flow,
      Number(summary?.flowCounts?.[flow] ?? 0) > 0
    )
  }
  check('duplicate_debits', summary?.financial?.duplicateDebits === 0)
  check('duplicate_credits', summary?.financial?.duplicateCredits === 0)
  check(
    'financial_drift',
    bigint(summary?.financial?.unexplainedDriftMinor) === 0n
  )
  check('contract_solvent', summary?.finalState?.contractSolvent === true)
  check(
    'cursor_lag',
    bigintLte(summary?.finalState?.cursorLagBlocks, policy?.thresholds?.maxCursorLagBlocks)
  )
  check(
    'stale_outbox',
    summary?.finalState?.staleRecoverableOutboxRows === 0
  )
  check(
    'pending_events',
    summary?.finalState?.pendingChainEvents <=
      policy?.thresholds?.maxPendingChainEvents
  )
  check(
    'critical_alerts',
    summary?.finalState?.unacknowledgedCriticalAlerts <=
      policy?.thresholds?.maxUnacknowledgedCriticalAlerts
  )
  check('unexpected_role_changes', summary?.finalState?.unexpectedRoleChanges === 0)
  check('unexpected_fee_changes', summary?.finalState?.unexpectedFeeChanges === 0)

  const output = result('velostra-phase3-canary-decision', manifest?.release, checks, {
    evaluatedAt,
    decision: 'STOP',
    expansionAuthorized: false,
    operatorApprovalRequired: true,
  })
  output.stopPlan = buildCanaryStopPlan(policy, output.failures)
  if (output.passed) output.decision = 'PASS_AWAITING_OPERATOR'
  return output
}

export function sealGateArtifact(value) {
  return sealManifest(value)
}