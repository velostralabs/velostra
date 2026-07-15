const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const POSITIVE_MINOR = /^[1-9]\d*$/
const NON_NEGATIVE_MINOR = /^\d+$/

function validAddress(value) {
  return typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value)
}

export const REQUIRED_CANARY_FLOWS = [
  'deposit',
  'paid-call',
  'earnings-credit',
  'reconciliation',
  'builder-claim',
  'platform-revenue',
  'zero-drift',
]

export const REQUIRED_CANARY_STOP_ACTIONS = [
  'disable-paid-writes',
  'preserve-builder-claims',
  'keep-reconciliation-running',
  'page-incident-owner',
]

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

export function validateCanaryPolicy(
  policy,
  stage = 'preparation',
  expectedEnvironment
) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  check(policy?.schemaVersion === 1, 'canary policy schemaVersion must be 1')
  check(policy?.kind === 'velostra-phase3-canary-policy', 'canary policy kind is invalid')
  if (expectedEnvironment !== undefined) {
    check(
      policy?.environment === expectedEnvironment,
      'canary policy environment differs from release environment'
    )
  }
  if (stage === 'preparation') {
    check(policy?.enabled === false, 'preparation canary policy must be disabled')
  } else {
    check(policy?.enabled === true, 'authorized canary policy must be enabled')
  }

  const allowlists = {}
  for (const name of ['wallets', 'agents', 'builders']) {
    const entries = Array.isArray(policy?.allowlists?.[name])
      ? policy.allowlists[name]
      : []
    allowlists[name] = entries
    check(
      entries.length > 0 &&
        entries.every((entry) => typeof entry === 'string' && entry.length > 0),
      name + ' allowlist must not be empty'
    )
  }
  check(
    allowlists.wallets.every(validAddress),
    'wallet allowlist contains an invalid address'
  )
  check(
    allowlists.builders.every(validAddress),
    'builder allowlist contains an invalid address'
  )

  check(positiveInteger(policy?.limits?.durationSeconds), 'canary duration must be positive')
  check(positiveInteger(policy?.limits?.maxCalls), 'canary maxCalls must be positive')
  for (const name of [
    'maxGrossPerCallMinor',
    'maxGrossPerWalletMinor',
    'maxGrossTotalMinor',
  ]) {
    check(POSITIVE_MINOR.test(policy?.limits?.[name] ?? ''), name + ' must be positive')
  }
  if (
    POSITIVE_MINOR.test(policy?.limits?.maxGrossPerCallMinor ?? '') &&
    POSITIVE_MINOR.test(policy?.limits?.maxGrossPerWalletMinor ?? '') &&
    POSITIVE_MINOR.test(policy?.limits?.maxGrossTotalMinor ?? '')
  ) {
    const perCall = BigInt(policy.limits.maxGrossPerCallMinor)
    const perWallet = BigInt(policy.limits.maxGrossPerWalletMinor)
    const total = BigInt(policy.limits.maxGrossTotalMinor)
    check(perCall <= perWallet && perWallet <= total, 'canary gross limits are inconsistent')
  }

  const thresholds = policy?.thresholds ?? {}
  check(
    thresholds.maxUnexplainedDriftMinor === '0',
    'unexplained drift threshold must be zero'
  )
  check(
    nonNegativeInteger(thresholds.maxCursorLagBlocks),
    'cursor lag threshold is invalid'
  )
  for (const name of [
    'maxRecoverableOutboxAgeSeconds',
    'maxWorkerAgeSeconds',
    'maxBackupAgeSeconds',
  ]) {
    check(positiveInteger(thresholds[name]), name + ' must be a positive integer')
  }
  check(
    typeof thresholds.maxErrorRate === 'number' &&
      thresholds.maxErrorRate >= 0 &&
      thresholds.maxErrorRate <= 1,
    'error rate threshold is invalid'
  )
  check(
    NON_NEGATIVE_MINOR.test(thresholds.minSignerBalanceWei ?? ''),
    'minimum signer balance is invalid'
  )
  check(
    thresholds.maxUnacknowledgedCriticalAlerts === 0,
    'unacknowledged critical alert threshold must be zero'
  )
  check(
    thresholds.maxPendingChainEvents === 0,
    'pending chain event threshold must be zero'
  )

  const requiredFlow = Array.isArray(policy?.requiredFlow) ? policy.requiredFlow : []
  for (const flow of REQUIRED_CANARY_FLOWS) {
    check(requiredFlow.includes(flow), 'required canary flow is missing: ' + flow)
  }
  const stopActions = Array.isArray(policy?.stopActions) ? policy.stopActions : []
  for (const action of REQUIRED_CANARY_STOP_ACTIONS) {
    check(stopActions.includes(action), 'required stop action is missing: ' + action)
  }
  check(
    policy?.rollback?.destructiveDatabaseRollbackAllowed === false,
    'destructive database rollback must be forbidden'
  )
  check(
    policy?.rollback?.strategy === 'pause-new-risk-and-forward-repair',
    'rollback strategy must pause new risk and use forward repair'
  )
  check(policy?.rollback?.preserveClaims === true, 'rollback must preserve claims')
  check(
    policy?.rollback?.preserveReconciliation === true,
    'rollback must preserve reconciliation'
  )

  return { passed: failures.length === 0, failures }
}
