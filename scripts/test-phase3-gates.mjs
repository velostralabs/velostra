import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPhase3Manifest,
  readJson,
  repositoryPath,
  sealManifest,
  sha256Canonical,
} from './lib/phase3-release.mjs'
import {
  evaluateCanary,
  evaluateCatchup,
  evaluateReadiness,
  sealGateArtifact,
} from './lib/phase3-gates.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = await readJson(repositoryPath(repositoryRoot, 'config/phase3-release-input.example.json'))
const preparationManifest = await createPhase3Manifest({
  repositoryRoot,
  input,
  generatedAt: '2026-07-16T00:00:00.000Z',
  allowDirty: true,
})
const policy = {
  ...(await readJson(repositoryPath(repositoryRoot, preparationManifest.policies.canary.path))),
  environment: 'production',
  enabled: true,
}
const deployedManifest = sealManifest({
  ...preparationManifest,
  integrity: undefined,
  stage: 'deployed',
  environment: 'production',
  contract: {
    ...preparationManifest.contract,
    address: '0x8000000000000000000000000000000000000008',
    deploymentBlock: 900,
    deploymentTxHash: '0x' + '9'.repeat(64),
  },
  policies: {
    ...preparationManifest.policies,
    canary: {
      ...preparationManifest.policies.canary,
      sha256: sha256Canonical(policy),
    },
  },
  authorization: {
    mainnetApproved: true,
    changeTicket: 'release-1234',
    approvals: [],
  },
})

const snapshot = {
  schemaVersion: 1,
  kind: 'velostra-phase3-operational-snapshot',
  release: deployedManifest.release,
  environment: deployedManifest.environment,
  sourceManifestSha256: deployedManifest.integrity.manifestSha256,
  capturedAt: '2026-07-16T00:10:00.000Z',
  dependencies: Object.fromEntries(
    ['postgres', 'redis', 'primaryRpc', 'fallbackRpc', 'signer', 'contract', 'operationalState']
      .map((name) => [name, { ok: true, latencyMs: 5 }])
  ),
  chain: {
    chainId: 4663,
    rpcAgreement: true,
    latestBlock: '1012',
    safeHeadBlock: '1000',
    cursorBlock: '1000',
    lagBlocks: '0',
    pendingEvents: 0,
  },
  contract: {
    address: deployedManifest.contract.address,
    deploymentVerified: true,
    deploymentBlock: deployedManifest.contract.deploymentBlock,
    settlementToken: deployedManifest.contract.constructor.settlementToken,
    platformFeeBps: deployedManifest.contract.constructor.platformFeeBps,
    paused: false,
    solvent: true,
    successorEscrow: null,
    roles: deployedManifest.contract.constructor.roles,
  },
  database: {
    journalSha256: deployedManifest.repository.drizzleJournal.sha256,
    appliedMigrations: deployedManifest.repository.migrations.length,
    managedPitrVerified: true,
  },
  images: { verified: true },
  paidWritesDisabled: true,
  signer: {
    address: deployedManifest.contract.constructor.roles.settler,
    balanceWei: policy.thresholds.minSignerBalanceWei,
  },
  worker: { ageSeconds: 10 },
  backup: { ageSeconds: 60 },
  outbox: {
    byStatus: {
      PREPARED: 0,
      READY: 0,
      SUBMITTED: 0,
      AMBIGUOUS: 0,
      CONFIRMED: 0,
    },
    oldestRecoverableAgeSeconds: null,
  },
  drift: { exceedsThreshold: false, unexplainedMinor: '0' },
  alerts: { unacknowledgedCritical: 0, operatorDeliveryVerified: true },
}

const readiness = evaluateReadiness({
  manifest: deployedManifest,
  policy,
  snapshot,
  evaluatedAt: '2026-07-16T00:11:00.000Z',
})
assert.equal(readiness.passed, true)
assert.equal(readiness.decision, 'GO')
assert.equal(readiness.paidWritesAllowed, true)

const driftedSnapshot = structuredClone(snapshot)
driftedSnapshot.drift = { exceedsThreshold: true, unexplainedMinor: '1' }
const driftedReadiness = evaluateReadiness({
  manifest: deployedManifest,
  policy,
  snapshot: driftedSnapshot,
})
assert.equal(driftedReadiness.passed, false)
assert.equal(driftedReadiness.decision, 'NO-GO')
assert(driftedReadiness.failures.includes('financial_drift'))

const catchupEvidence = {
  schemaVersion: 1,
  kind: 'velostra-phase3-catchup-evidence',
  release: deployedManifest.release,
  outageDurationMs: 3_600_000,
  catchUpDurationMs: 120_000,
  maxBlockRange: 2_000,
  startCursorBlock: '1000',
  safeHeadBlock: '5000',
  finalCursorBlock: '5000',
  queriedRanges: [
    { fromBlock: '1001', toBlock: '3000' },
    { fromBlock: '3001', toBlock: '5000' },
  ],
  cursorCheckpoints: ['3000', '5000'],
  restart: { workerRestarted: true, resumedFromCheckpoint: true },
  rpc: {
    exponentialBackoff: true,
    adaptiveRangeSplit: true,
    fallbackVerified: true,
  },
  skippedRanges: 0,
  duplicateDebits: 0,
  duplicateCredits: 0,
  unexplainedDriftMinor: '0',
}
const catchup = evaluateCatchup({
  release: deployedManifest.release,
  evidence: catchupEvidence,
  maxBlockRange: 2_000,
  catchUpSloMs: 900_000,
})
assert.equal(catchup.passed, true)
assert.equal(catchup.decision, 'PASS')

const gapEvidence = structuredClone(catchupEvidence)
gapEvidence.queriedRanges[1].fromBlock = '3002'
const gapResult = evaluateCatchup({
  release: deployedManifest.release,
  evidence: gapEvidence,
  maxBlockRange: 2_000,
  catchUpSloMs: 900_000,
})
assert.equal(gapResult.passed, false)
assert(gapResult.failures.includes('ranges_contiguous'))

const malformedRangeEvidence = structuredClone(catchupEvidence)
malformedRangeEvidence.queriedRanges = {}
const malformedRangeResult = evaluateCatchup({
  release: deployedManifest.release,
  evidence: malformedRangeEvidence,
  maxBlockRange: 2_000,
  catchUpSloMs: 900_000,
})
assert.equal(malformedRangeResult.passed, false)
assert(malformedRangeResult.failures.includes('ranges_contiguous'))

const checkpointEvidence = structuredClone(catchupEvidence)
checkpointEvidence.cursorCheckpoints[0] = '2999'
const checkpointResult = evaluateCatchup({
  release: deployedManifest.release,
  evidence: checkpointEvidence,
  maxBlockRange: 2_000,
  catchUpSloMs: 900_000,
})
assert.equal(checkpointResult.passed, false)
assert(checkpointResult.failures.includes('cursor_checkpoints'))

const flowCounts = Object.fromEntries(policy.requiredFlow.map((flow) => [flow, 1]))
const summary = {
  schemaVersion: 1,
  kind: 'velostra-phase3-canary-summary',
  release: deployedManifest.release,
  sourceManifestSha256: deployedManifest.integrity.manifestSha256,
  policySha256: deployedManifest.policies.canary.sha256,
  startedAt: '2026-07-16T01:00:00.000Z',
  endedAt: '2026-07-16T01:30:00.000Z',
  calls: { total: 5, successful: 5, failed: 0 },
  allowlistViolations: 0,
  exposure: {
    maxGrossPerCallMinor: '1000000',
    maxGrossPerWalletMinor: '5000000',
    grossTotalMinor: '5000000',
  },
  flowCounts,
  financial: {
    duplicateDebits: 0,
    duplicateCredits: 0,
    unexplainedDriftMinor: '0',
  },
  finalState: {
    contractSolvent: true,
    cursorLagBlocks: '0',
    staleRecoverableOutboxRows: 0,
    pendingChainEvents: 0,
    unacknowledgedCriticalAlerts: 0,
    unexpectedRoleChanges: 0,
    unexpectedFeeChanges: 0,
  },
}
const canary = evaluateCanary({
  manifest: deployedManifest,
  policy,
  summary,
  evaluatedAt: '2026-07-16T01:31:00.000Z',
})
assert.equal(canary.passed, true)
assert.equal(canary.decision, 'PASS_AWAITING_OPERATOR')
assert.equal(canary.expansionAuthorized, false)
assert.equal(canary.operatorApprovalRequired, true)
assert.equal(canary.stopPlan.stopRequired, false)

const duplicateSummary = structuredClone(summary)
duplicateSummary.financial.duplicateDebits = 1
const stopped = evaluateCanary({
  manifest: deployedManifest,
  policy,
  summary: duplicateSummary,
})
assert.equal(stopped.passed, false)
assert.equal(stopped.decision, 'STOP')
assert.equal(stopped.expansionAuthorized, false)
assert.equal(stopped.stopPlan.stopRequired, true)
assert(stopped.stopPlan.actions.includes('disable-paid-writes'))
assert(stopped.failures.includes('duplicate_debits'))

const malformedSummary = structuredClone(summary)
delete malformedSummary.exposure.maxGrossPerCallMinor
assert.doesNotThrow(() =>
  evaluateCanary({ manifest: deployedManifest, policy, summary: malformedSummary })
)
assert.equal(
  evaluateCanary({ manifest: deployedManifest, policy, summary: malformedSummary }).passed,
  false
)

const sealed = sealGateArtifact(readiness)
assert.match(sealed.integrity.manifestSha256, /^[a-f0-9]{64}$/)

console.log('PHASE 3 READINESS, CATCH-UP, AND CANARY GATE TESTS PASSED')
