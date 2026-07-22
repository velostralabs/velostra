import {
  canonicalJson,
  fileEntry,
  gitHead,
  gitStatus,
  readJson,
  repositoryPath,
  sealManifest,
  validAddress,
} from './phase3-release.mjs'

export const MAINNET_READINESS_SCHEMA_VERSION = 1
export const MAINNET_READINESS_KIND = 'velostra-mainnet-readiness-packet'
export const MAINNET_CHAIN_ID = 4663

const SHA256 = /^[a-f0-9]{64}$/
const FULL_COMMIT = /^[a-f0-9]{40}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const FORBIDDEN_KEY = /(?:private.?key|mnemonic|password|credential|api.?key|secret|access.?token)/i

const LOCKFILE_PATHS = [
  'package-lock.json',
  'server/package-lock.json',
  'contracts/package-lock.json',
]
const RELEASE_TOOL_PATHS = [
  'scripts/lib/mainnet-readiness.mjs',
  'scripts/prepare-mainnet-readiness.mjs',
  'scripts/validate-mainnet-readiness.mjs',
  'config/mainnet-readiness-packet.schema.json',
]
const CONTRACT_PATHS = [
  'contracts/VelostraEscrow.sol',
  'contracts/build/VelostraEscrow.json',
]

const SAFE_PURPOSES = ['governance-admin', 'pause-guardian', 'treasury-fee']
const ISOLATED_RESOURCE_KEYS = [
  'cloudProject',
  'apiRuntime',
  'database',
  'redis',
  'signer',
  'scheduler',
  'secretNamespace',
  'serviceAccounts',
  'evidenceStore',
]
const TESTNET_READ_ONLY_CHECKS = ['https-readiness', 'catalog-read', 'chain-read']
const FORBIDDEN_PREPARATION_ACTIONS = [
  'change-testnet-runtime',
  'change-testnet-write-mode',
  'change-testnet-dns',
  'reuse-testnet-database',
  'reuse-testnet-redis',
  'reuse-testnet-signer',
  'broadcast-mainnet-transaction',
]

const REQUIRED_ROLES = {
  DEFAULT_ADMIN: 'governance-admin',
  FEE_MANAGER: 'treasury-fee',
  PAUSER: 'pause-guardian',
  TREASURY: 'treasury-fee',
  SETTLER: 'restricted-settler',
}
const DEPLOYMENT_SEQUENCE = [
  'freeze-reviewed-release',
  'backup-production-database',
  'apply-production-migrations-once',
  'deploy-and-verify-contract',
  'deploy-api-and-workers-with-paid-writes-disabled',
  'run-read-only-readiness-and-drift-checks',
  'request-separate-low-value-canary-approval',
]
const REQUIRED_READINESS = [
  'api-health',
  'database-migrations-current',
  'redis-connectivity',
  'rpc-chain-id',
  'contract-code-and-runtime-config',
  'reconciliation-cursor-and-drift',
  'telegram-alert-delivery',
  'public-frontend-read-only-smoke',
]
const CANARY_FLOWS = ['deposit', 'paid-call', 'builder-claim', 'reconciliation']
const CANARY_STOP_ACTIONS = [
  'disable-paid-writes',
  'pause-new-risk-if-required',
  'preserve-claims-and-reconciliation',
  'notify-incident-owner',
]

function check(condition, failures, message) {
  if (!condition) failures.push(message)
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function uniqueStrings(values) {
  return Array.isArray(values) &&
    values.every((value) => typeof value === 'string' && value.length >= 3) &&
    new Set(values).size === values.length
}

function validNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function validPositiveIntegerString(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
}

function forbiddenKeys(value, location = '$', failures = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => forbiddenKeys(entry, `${location}[${index}]`, failures))
    return failures
  }
  if (!value || typeof value !== 'object') return failures
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) failures.push(`packet contains forbidden credential field at ${location}.${key}`)
    forbiddenKeys(entry, `${location}.${key}`, failures)
  }
  return failures
}

function validateFileEntry(entry, failures, label) {
  check(typeof entry?.path === 'string' && entry.path.length > 0, failures, `${label} path is invalid`)
  check(SHA256.test(entry?.sha256), failures, `${label} sha256 is invalid`)
}

export function validateEnvironmentIsolationPlan(plan) {
  const failures = []
  check(plan?.schemaVersion === 1, failures, 'environment isolation plan schemaVersion must be 1')
  check(plan?.kind === 'velostra-mainnet-environment-isolation-plan', failures, 'environment isolation plan kind is invalid')
  check(plan?.mainnet?.environment === 'robinhood-mainnet', failures, 'isolated mainnet environment is invalid')
  check(plan?.mainnet?.chainId === MAINNET_CHAIN_ID, failures, 'isolated mainnet chainId must be 4663')
  check(plan?.mainnet?.region === 'us-east4', failures, 'mainnet runtime region must remain us-east4')
  check(plan?.mainnet?.paidWritesAtProvision === 'disabled', failures, 'mainnet paid writes must be disabled at provision')
  check(plan?.publicTestnet?.environment === 'robinhood-testnet', failures, 'public testnet environment is invalid')
  check(plan?.publicTestnet?.chainId === 46630, failures, 'public testnet chainId must remain 46630')
  check(plan?.publicTestnet?.publicPath === 'https://velostra.xyz/testnet', failures, 'public testnet path is invalid')
  check(plan?.publicTestnet?.mustRemainAvailable === true, failures, 'public testnet continuity must be required')
  check(plan?.publicTestnet?.mutationDuringPreparation === 'forbidden', failures, 'mainnet preparation must not mutate public testnet')
  check(sameJson(plan?.publicTestnet?.allowedChecks, TESTNET_READ_ONLY_CHECKS), failures, 'public testnet checks must remain read-only')
  for (const key of ISOLATED_RESOURCE_KEYS) {
    check(plan?.separateResourcesRequired?.[key] === true, failures, `mainnet ${key} must be isolated from testnet`)
  }
  check(sameJson(plan?.forbiddenPreparationActions, FORBIDDEN_PREPARATION_ACTIONS), failures, 'forbidden mainnet preparation actions are invalid')
  return { passed: failures.length === 0, failures }
}

export function validateAuthorityPlan(plan) {
  const failures = []
  check(plan?.schemaVersion === 1, failures, 'authority plan schemaVersion must be 1')
  check(plan?.kind === 'velostra-mainnet-authority-plan', failures, 'authority plan kind is invalid')
  check(plan?.environment === 'robinhood-mainnet', failures, 'authority plan environment is invalid')
  check(['pending', 'ready'].includes(plan?.status), failures, 'authority plan status is invalid')

  const safes = Array.isArray(plan?.safes) ? plan.safes : []
  check(safes.length === SAFE_PURPOSES.length, failures, 'authority plan must contain three safes')
  check(sameJson(safes.map((entry) => entry?.purpose), SAFE_PURPOSES), failures, 'authority safe purposes or order are invalid')
  for (const safe of safes) {
    check(safe?.threshold === 2, failures, `${safe?.purpose} threshold must be 2`)
    check(safe?.requiredOwners === 3, failures, `${safe?.purpose} requiredOwners must be 3`)
    check(Array.isArray(safe?.owners), failures, `${safe?.purpose} owners must be an array`)
    check(safe?.hardwareWalletsRequired === true, failures, `${safe?.purpose} must require hardware wallets`)
  }
  check(sameJson(plan?.roleAssignments, REQUIRED_ROLES), failures, 'authority role assignments are invalid')
  check(plan?.settler?.custody === 'hardware-backed-hsm', failures, 'settler custody must be hardware-backed-hsm')
  check(sameJson(plan?.settler?.transactionAllowlist, ['creditBuilderEarnings']), failures, 'settler transaction allowlist is invalid')
  check(plan?.settler?.valueTransferAllowed === false, failures, 'settler must not be allowed to transfer value')
  check(typeof plan?.settler?.rotationDrillPassed === 'boolean', failures, 'settler rotation drill state is invalid')
  check(typeof plan?.recovery?.runbookReviewed === 'boolean', failures, 'authority recovery runbook state is invalid')
  check(typeof plan?.recovery?.accessDrillPassed === 'boolean', failures, 'authority access drill state is invalid')

  let ready = plan?.status === 'ready'
  if (ready) {
    const allOwners = []
    for (const safe of safes) {
      check(validAddress(safe?.principal), failures, `${safe?.purpose} principal is invalid`)
      check(uniqueStrings(safe?.owners) && safe.owners.length === 3, failures, `${safe?.purpose} must have three distinct owners`)
      if (Array.isArray(safe?.owners)) allOwners.push(...safe.owners)
    }
    check(plan?.ownerSetsDisjoint === true, failures, 'authority owner sets must be declared disjoint')
    check(new Set(allOwners).size === allOwners.length, failures, 'authority owner sets are not actually disjoint')
    check(validAddress(plan?.settler?.principal), failures, 'settler principal is invalid')
    check(plan?.settler?.rotationDrillPassed === true, failures, 'settler rotation drill has not passed')
    check(plan?.recovery?.runbookReviewed === true, failures, 'authority recovery runbook is not reviewed')
    check(plan?.recovery?.accessDrillPassed === true, failures, 'authority recovery access drill has not passed')
    check(ISO_DATE.test(plan?.recovery?.lastDrillAt), failures, 'authority recovery lastDrillAt is invalid')
  } else {
    for (const safe of safes) {
      check(safe?.principal === null, failures, `${safe?.purpose} pending principal must be null`)
      check(Array.isArray(safe?.owners) && safe.owners.length === 0, failures, `${safe?.purpose} pending owners must be empty`)
    }
    check(plan?.ownerSetsDisjoint === false, failures, 'pending authority ownerSetsDisjoint must be false')
    check(plan?.settler?.principal === null, failures, 'pending settler principal must be null')
    check(plan?.recovery?.lastDrillAt === null, failures, 'pending recovery lastDrillAt must be null')
  }
  if (failures.length > 0) ready = false
  return { passed: failures.length === 0, ready, failures }
}

export function validateDeploymentPlan(plan) {
  const failures = []
  check(plan?.schemaVersion === 1, failures, 'deployment plan schemaVersion must be 1')
  check(plan?.kind === 'velostra-mainnet-deployment-plan', failures, 'deployment plan kind is invalid')
  check(plan?.environment === 'robinhood-mainnet', failures, 'deployment plan environment is invalid')
  check(plan?.chainId === MAINNET_CHAIN_ID, failures, 'deployment plan chainId must be 4663')
  check(plan?.mode === 'plan-only', failures, 'deployment plan must remain plan-only')
  check(plan?.mainnetBroadcast === false, failures, 'deployment plan must not authorize mainnet broadcast')
  check(plan?.paidWritesAtDeploy === 'disabled', failures, 'paid writes must be disabled at deployment')
  check(plan?.deployment?.contractAddress === null, failures, 'preparation contractAddress must be null')
  check(plan?.deployment?.deploymentBlock === null, failures, 'preparation deploymentBlock must be null')
  check(plan?.deployment?.transactionHash === null, failures, 'preparation transactionHash must be null')
  check(plan?.deployment?.explorerVerification === 'not-started', failures, 'explorer verification must be not-started')
  check(sameJson(plan?.sequence, DEPLOYMENT_SEQUENCE), failures, 'deployment sequence is invalid')
  check(sameJson(plan?.requiredReadiness, REQUIRED_READINESS), failures, 'deployment readiness list is invalid')
  check(plan?.rollback?.strategy === 'pause-new-risk-and-forward-repair', failures, 'rollback strategy is invalid')
  check(plan?.rollback?.preserveClaims === true, failures, 'rollback must preserve claims')
  check(plan?.rollback?.preserveReconciliation === true, failures, 'rollback must preserve reconciliation')
  check(plan?.rollback?.restorePreviousRuntimeImage === true, failures, 'rollback must restore the prior runtime image')
  check(plan?.rollback?.databaseRestoreDrillRequired === true, failures, 'rollback must require a database restore drill')
  check(plan?.rollback?.automaticMainnetRetry === false, failures, 'automatic mainnet retry must be disabled')
  return { passed: failures.length === 0, failures }
}

export function validateMainnetCanaryPolicy(policy) {
  const failures = []
  check(policy?.schemaVersion === 1, failures, 'canary policy schemaVersion must be 1')
  check(policy?.kind === 'velostra-mainnet-canary-policy', failures, 'canary policy kind is invalid')
  check(policy?.environment === 'robinhood-mainnet', failures, 'canary policy environment is invalid')
  check(policy?.enabled === false, failures, 'mainnet canary must remain disabled in preparation')
  check(policy?.approval === 'not-approved', failures, 'mainnet canary must remain not-approved in preparation')
  for (const key of ['wallets', 'agents', 'builders']) {
    check(Array.isArray(policy?.allowlists?.[key]) && policy.allowlists[key].length === 0, failures, `preparation canary ${key} allowlist must be empty`)
  }
  check(Number.isInteger(policy?.limits?.maxCalls) && policy.limits.maxCalls > 0 && policy.limits.maxCalls <= 5, failures, 'canary maxCalls must be between 1 and 5')
  for (const key of ['maxGrossAmountPerCallBaseUnits', 'maxGrossAmountPerWalletBaseUnits', 'maxGrossAmountTotalBaseUnits']) {
    check(validPositiveIntegerString(policy?.limits?.[key]), failures, `canary ${key} is invalid`)
  }
  if (
    Number.isInteger(policy?.limits?.maxCalls) && policy.limits.maxCalls > 0 &&
    validPositiveIntegerString(policy?.limits?.maxGrossAmountPerCallBaseUnits) &&
    validPositiveIntegerString(policy?.limits?.maxGrossAmountPerWalletBaseUnits) &&
    validPositiveIntegerString(policy?.limits?.maxGrossAmountTotalBaseUnits)
  ) {
    const perCall = BigInt(policy.limits.maxGrossAmountPerCallBaseUnits)
    const perWallet = BigInt(policy.limits.maxGrossAmountPerWalletBaseUnits)
    const total = BigInt(policy.limits.maxGrossAmountTotalBaseUnits)
    check(perCall <= perWallet && perWallet <= total, failures, 'canary exposure limits are not ordered')
    check(BigInt(policy.limits.maxCalls) * perCall <= total, failures, 'canary total exposure is smaller than the declared call window')
  }
  check(Number.isInteger(policy?.limits?.maxDurationSeconds) && policy.limits.maxDurationSeconds > 0 && policy.limits.maxDurationSeconds <= 1800, failures, 'canary duration must be at most 1800 seconds')
  check(policy?.thresholds?.maximumDriftBaseUnits === '0', failures, 'canary maximum drift must be zero')
  check(policy?.thresholds?.maximumFailedCalls === 0, failures, 'canary maximum failed calls must be zero')
  check(Number.isInteger(policy?.thresholds?.maximumReconciliationLagBlocks) && policy.thresholds.maximumReconciliationLagBlocks >= 0 && policy.thresholds.maximumReconciliationLagBlocks <= 10, failures, 'canary reconciliation lag threshold is invalid')
  check(sameJson(policy?.requiredFlows, CANARY_FLOWS), failures, 'canary required flows are invalid')
  check(sameJson(policy?.stopActions, CANARY_STOP_ACTIONS), failures, 'canary stop actions are invalid')
  check(policy?.expansionRequiresSeparateApproval === true, failures, 'canary expansion must require separate approval')
  return { passed: failures.length === 0, failures }
}

function validateAudit(audit) {
  const failures = []
  check(['pending', 'complete'].includes(audit?.status), failures, 'audit status is invalid')
  check(typeof audit?.scopeAccepted === 'boolean', failures, 'audit scopeAccepted is invalid')
  check(audit?.criticalOpen === null || validNonNegativeInteger(audit?.criticalOpen), failures, 'audit criticalOpen is invalid')
  check(audit?.highOpen === null || validNonNegativeInteger(audit?.highOpen), failures, 'audit highOpen is invalid')
  check(typeof audit?.mediumFindingsDispositioned === 'boolean', failures, 'audit medium disposition is invalid')
  const ready = audit?.status === 'complete'
  if (ready) {
    check(audit?.scopeAccepted === true, failures, 'audit scope is not accepted')
    check(typeof audit?.reviewerOrganization === 'string' && audit.reviewerOrganization.length >= 2, failures, 'audit reviewer organization is invalid')
    validateFileEntry(audit?.report, failures, 'audit report')
    check(audit?.criticalOpen === 0, failures, 'audit has open critical findings')
    check(audit?.highOpen === 0, failures, 'audit has open high findings')
    check(audit?.mediumFindingsDispositioned === true, failures, 'audit medium findings are not dispositioned')
  } else {
    check(audit?.scopeAccepted === false, failures, 'pending audit scopeAccepted must be false')
    check(audit?.reviewerOrganization === null, failures, 'pending audit reviewerOrganization must be null')
    check(audit?.report === null, failures, 'pending audit report must be null')
  }
  return { passed: failures.length === 0, ready: ready && failures.length === 0, failures }
}

function validateOperations(operations) {
  const required = [
    'productionDatabaseRestoreDrillPassed',
    'productionSignerRecoveryDrillPassed',
    'productionAlertDeliveryVerified',
    'incidentOwnerAssigned',
    'runbookReviewed',
  ]
  const failures = []
  for (const key of required) check(typeof operations?.[key] === 'boolean', failures, `operations ${key} is invalid`)
  return { passed: failures.length === 0, ready: required.every((key) => operations?.[key] === true), failures }
}

function validateApprovalPolicy(policy) {
  const failures = []
  check(policy?.minimumDistinctApprovers === 2, failures, 'approval policy must require two distinct approvers')
  check(sameJson(policy?.requiredRoles, ['security', 'operations']), failures, 'approval policy roles are invalid')
  check(policy?.separationOfDuties === true, failures, 'approval policy must enforce separation of duties')
  check(typeof policy?.approversAssigned === 'boolean', failures, 'approval policy approversAssigned is invalid')
  return { passed: failures.length === 0, ready: policy?.approversAssigned === true && failures.length === 0, failures }
}

function buildDecision({ audit, authority, operations, approvals }) {
  const blockers = []
  if (!audit.ready) blockers.push('independent audit is incomplete')
  if (!authority.ready) blockers.push('mainnet authority and custody plan is incomplete')
  if (!operations.ready) blockers.push('production recovery, alert, and runbook gates are incomplete')
  if (!approvals.ready) blockers.push('two-person approval roles are not assigned')
  return { blockers, decision: blockers.length === 0 ? 'READY_FOR_SIGNING' : 'NO_GO' }
}

async function readAudit(repositoryRoot, inputAudit) {
  const audit = { ...inputAudit }
  delete audit.reportPath
  delete audit.reportSha256
  if (inputAudit?.reportPath === null) {
    return { ...audit, report: null }
  }
  const report = await fileEntry(repositoryRoot, inputAudit.reportPath)
  if (inputAudit.reportSha256 !== null && inputAudit.reportSha256 !== report.sha256) {
    throw new Error('Configured audit report sha256 does not match the report file')
  }
  return { ...audit, report }
}

async function entries(repositoryRoot, paths) {
  return Promise.all(paths.map((relativePath) => fileEntry(repositoryRoot, relativePath)))
}

export async function createMainnetReadinessPacket({
  repositoryRoot,
  input,
  generatedAt = new Date().toISOString(),
  allowDirty = false,
}) {
  if (input?.schemaVersion !== 1 || input?.kind !== 'velostra-mainnet-readiness-input') throw new Error('Mainnet readiness input is invalid')
  if (input.stage !== 'preparation') throw new Error('Mainnet readiness packet only supports preparation stage')
  if (input.network?.name !== 'robinhood-mainnet' || input.network?.chainId !== MAINNET_CHAIN_ID) throw new Error('Mainnet readiness network is invalid')
  if (!allowDirty && gitStatus(repositoryRoot) !== '') throw new Error('Refusing to prepare mainnet readiness packet from a dirty worktree')

  const release = input.release === 'git-head' ? gitHead(repositoryRoot) : input.release
  if (!FULL_COMMIT.test(release)) throw new Error('Mainnet readiness release must be a full Git commit')
  const environmentIsolationPlan = await readJson(repositoryPath(repositoryRoot, input.paths.environmentIsolation))
  const authorityPlan = await readJson(repositoryPath(repositoryRoot, input.paths.authorityPlan))
  const deploymentPlan = await readJson(repositoryPath(repositoryRoot, input.paths.deploymentPlan))
  const canaryPolicy = await readJson(repositoryPath(repositoryRoot, input.paths.canaryPolicy))
  const environmentIsolation = validateEnvironmentIsolationPlan(environmentIsolationPlan)
  const authority = validateAuthorityPlan(authorityPlan)
  const deployment = validateDeploymentPlan(deploymentPlan)
  const canary = validateMainnetCanaryPolicy(canaryPolicy)
  const auditControl = await readAudit(repositoryRoot, input.audit)
  const audit = validateAudit(auditControl)
  const operations = validateOperations(input.operations)
  const approvals = validateApprovalPolicy(input.approvalPolicy)
  const structuralFailures = [
    ...environmentIsolation.failures,
    ...authority.failures,
    ...deployment.failures,
    ...canary.failures,
    ...audit.failures,
    ...operations.failures,
    ...approvals.failures,
  ]
  if (structuralFailures.length > 0) throw new Error('Unsafe or invalid mainnet readiness input:\n- ' + structuralFailures.join('\n- '))
  if (Object.values(input.authorization ?? {}).some((value) => value !== false)) throw new Error('Preparation input must not authorize mainnet activity')

  const decision = buildDecision({ audit, authority, operations, approvals })
  const packet = {
    schemaVersion: MAINNET_READINESS_SCHEMA_VERSION,
    kind: MAINNET_READINESS_KIND,
    stage: 'preparation',
    generatedAt,
    release,
    network: { name: 'robinhood-mainnet', chainId: MAINNET_CHAIN_ID },
    repository: {
      contract: await entries(repositoryRoot, CONTRACT_PATHS),
      lockfiles: await entries(repositoryRoot, LOCKFILE_PATHS),
      releaseTools: await entries(repositoryRoot, RELEASE_TOOL_PATHS),
    },
    plans: {
      environmentIsolation: await fileEntry(repositoryRoot, input.paths.environmentIsolation),
      authority: await fileEntry(repositoryRoot, input.paths.authorityPlan),
      deployment: await fileEntry(repositoryRoot, input.paths.deploymentPlan),
      canary: await fileEntry(repositoryRoot, input.paths.canaryPolicy),
    },
    controls: {
      audit: auditControl,
      operations: input.operations,
      approvalPolicy: input.approvalPolicy,
    },
    gates: {
      environmentIsolation: environmentIsolation.passed,
      independentAudit: audit.ready,
      authorityAndCustody: authority.ready,
      deploymentPlanSafe: deployment.passed,
      canaryPolicySafe: canary.passed,
      productionOperations: operations.ready,
      twoPersonApprovalRoles: approvals.ready,
    },
    decision: decision.decision,
    blockers: decision.blockers,
    authorization: {
      mainnetBroadcast: false,
      canaryExecution: false,
      expansion: false,
    },
  }
  const credentialFailures = forbiddenKeys(packet)
  if (credentialFailures.length > 0) throw new Error(credentialFailures.join('\n'))
  return sealManifest(packet)
}

async function validateEntries(repositoryRoot, actualEntries, expectedPaths, failures, label) {
  check(Array.isArray(actualEntries), failures, `${label} entries must be an array`)
  if (!Array.isArray(actualEntries)) return
  check(sameJson(actualEntries.map((entry) => entry?.path), expectedPaths), failures, `${label} path set is invalid`)
  for (let index = 0; index < actualEntries.length; index += 1) {
    const actual = actualEntries[index]
    validateFileEntry(actual, failures, `${label} entry`)
    if (typeof actual?.path !== 'string') continue
    try {
      const expected = await fileEntry(repositoryRoot, actual.path)
      check(actual.sha256 === expected.sha256, failures, `${actual.path} hash mismatch`)
    } catch {
      failures.push(`${actual.path} cannot be read from repository`)
    }
  }
}

export async function validateMainnetReadinessPacket({
  repositoryRoot,
  packet,
  expectedHead,
  requireClean = true,
  requireReady = false,
}) {
  const failures = []
  check(packet?.schemaVersion === MAINNET_READINESS_SCHEMA_VERSION, failures, 'packet schemaVersion must be 1')
  check(packet?.kind === MAINNET_READINESS_KIND, failures, 'packet kind is invalid')
  check(packet?.stage === 'preparation', failures, 'packet stage must be preparation')
  check(ISO_DATE.test(packet?.generatedAt), failures, 'packet generatedAt is invalid')
  check(FULL_COMMIT.test(packet?.release), failures, 'packet release is invalid')
  check(packet?.network?.name === 'robinhood-mainnet' && packet?.network?.chainId === MAINNET_CHAIN_ID, failures, 'packet network is invalid')
  if (expectedHead) check(packet?.release === expectedHead, failures, 'packet release differs from expected Git HEAD')
  if (requireClean) check(gitStatus(repositoryRoot) === '', failures, 'current worktree is dirty')

  const { integrity: _integrity, ...body } = packet ?? {}
  const resealed = sealManifest(body)
  check(packet?.integrity?.algorithm === 'sha256', failures, 'packet integrity algorithm is invalid')
  check(SHA256.test(packet?.integrity?.manifestSha256), failures, 'packet integrity hash is invalid')
  check(packet?.integrity?.manifestSha256 === resealed.integrity.manifestSha256, failures, 'packet integrity hash mismatch')

  await validateEntries(repositoryRoot, packet?.repository?.contract, CONTRACT_PATHS, failures, 'contract')
  await validateEntries(repositoryRoot, packet?.repository?.lockfiles, LOCKFILE_PATHS, failures, 'lockfile')
  await validateEntries(repositoryRoot, packet?.repository?.releaseTools, RELEASE_TOOL_PATHS, failures, 'release tool')
  for (const [key, label] of [['environmentIsolation', 'environment isolation plan'], ['authority', 'authority plan'], ['deployment', 'deployment plan'], ['canary', 'canary policy']]) {
    const entry = packet?.plans?.[key]
    validateFileEntry(entry, failures, label)
    if (typeof entry?.path === 'string') {
      try {
        const expected = await fileEntry(repositoryRoot, entry.path)
        check(entry.sha256 === expected.sha256, failures, `${label} hash mismatch`)
      } catch {
        failures.push(`${label} cannot be read from repository`)
      }
    }
  }

  let authority = { passed: false, ready: false, failures: ['authority plan unavailable'] }
  let environmentIsolation = { passed: false, failures: ['environment isolation plan unavailable'] }
  let deployment = { passed: false, failures: ['deployment plan unavailable'] }
  let canary = { passed: false, failures: ['canary policy unavailable'] }
  try { authority = validateAuthorityPlan(await readJson(repositoryPath(repositoryRoot, packet.plans.authority.path))) } catch {}
  try { environmentIsolation = validateEnvironmentIsolationPlan(await readJson(repositoryPath(repositoryRoot, packet.plans.environmentIsolation.path))) } catch {}
  try { deployment = validateDeploymentPlan(await readJson(repositoryPath(repositoryRoot, packet.plans.deployment.path))) } catch {}
  try { canary = validateMainnetCanaryPolicy(await readJson(repositoryPath(repositoryRoot, packet.plans.canary.path))) } catch {}
  failures.push(...environmentIsolation.failures, ...authority.failures, ...deployment.failures, ...canary.failures)

  const audit = validateAudit(packet?.controls?.audit)
  const operations = validateOperations(packet?.controls?.operations)
  const approvals = validateApprovalPolicy(packet?.controls?.approvalPolicy)
  failures.push(...audit.failures, ...operations.failures, ...approvals.failures)
  if (packet?.controls?.audit?.report) {
    try {
      const expected = await fileEntry(repositoryRoot, packet.controls.audit.report.path)
      check(packet.controls.audit.report.sha256 === expected.sha256, failures, 'audit report hash mismatch')
    } catch {
      failures.push('audit report cannot be read from repository')
    }
  }

  const decision = buildDecision({ audit, authority, operations, approvals })
  const gates = {
    independentAudit: audit.ready,
    authorityAndCustody: authority.ready,
    environmentIsolation: environmentIsolation.passed,
    deploymentPlanSafe: deployment.passed,
    canaryPolicySafe: canary.passed,
    productionOperations: operations.ready,
    twoPersonApprovalRoles: approvals.ready,
  }
  check(sameJson(packet?.gates, gates), failures, 'packet gates do not match source controls')
  check(packet?.decision === decision.decision, failures, 'packet decision does not match readiness gates')
  check(sameJson(packet?.blockers, decision.blockers), failures, 'packet blockers do not match readiness gates')
  check(packet?.authorization?.mainnetBroadcast === false, failures, 'packet must not authorize mainnet broadcast')
  check(packet?.authorization?.canaryExecution === false, failures, 'packet must not authorize canary execution')
  check(packet?.authorization?.expansion === false, failures, 'packet must not authorize expansion')
  failures.push(...forbiddenKeys(packet))
  if (requireReady) check(packet?.decision === 'READY_FOR_SIGNING', failures, 'mainnet readiness decision is not READY_FOR_SIGNING')
  return { passed: failures.length === 0, ready: packet?.decision === 'READY_FOR_SIGNING' && failures.length === 0, failures }
}
