import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPhase3Manifest, readJson, repositoryPath } from './lib/phase3-release.mjs'
import {
  createDeploymentPlan,
  finalizeDeploymentManifest,
  validateCanaryPolicy,
} from './lib/phase3-deployment.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = await readJson(repositoryPath(repositoryRoot, 'config/phase3-release-input.example.json'))
const manifest = await createPhase3Manifest({
  repositoryRoot,
  input,
  generatedAt: '2026-07-16T00:00:00.000Z',
  allowDirty: true,
})
const artifact = await readJson(repositoryPath(repositoryRoot, manifest.contract.artifact))
const policy = await readJson(repositoryPath(repositoryRoot, manifest.policies.canary.path))
assert.deepEqual(validateCanaryPolicy(policy), { passed: true, failures: [] })

const plan = createDeploymentPlan({
  manifest,
  artifact,
  canaryPolicy: policy,
  generatedAt: '2026-07-16T00:01:00.000Z',
})
assert.equal(plan.broadcastPerformed, false)
assert.equal(plan.broadcastEligible, false)
assert.equal(plan.transaction.chainId, 4663)
assert.equal(plan.transaction.to, null)
assert.equal(plan.database.destructiveRollbackAllowed, false)
assert.equal(plan.rollback.destructiveDatabaseRollbackAllowed, false)
assert(plan.rollout.orderedSteps.includes('require-zero-drift-go-no-go'))
assert(plan.rollback.orderedActions.includes('use-forward-database-repair'))
assert(!JSON.stringify(plan).includes('privateKey'))

const unsafePolicy = structuredClone(policy)
unsafePolicy.rollback.destructiveDatabaseRollbackAllowed = true
const unsafeResult = validateCanaryPolicy(unsafePolicy)
assert.equal(unsafeResult.passed, false)
assert(unsafeResult.failures.includes('destructive database rollback must be forbidden'))

assert.throws(
  () => finalizeDeploymentManifest(manifest, {}),
  /broadcast-approved/
)
const approved = {
  ...manifest,
  stage: 'broadcast-approved',
  authorization: {
    mainnetApproved: true,
    changeTicket: 'release-1234',
    approvals: [],
  },
}
const deployed = finalizeDeploymentManifest(approved, {
  release: approved.release,
  sourceManifestSha256: approved.integrity.manifestSha256,
  address: '0x8000000000000000000000000000000000000008',
  deploymentBlock: 12345,
  transactionHash: '0x' + '9'.repeat(64),
  chainId: 4663,
  confirmedAt: '2026-07-16T00:02:00.000Z',
})
assert.equal(deployed.stage, 'deployed')
assert.equal(deployed.contract.deploymentBlock, 12345)
assert.equal(deployed.deploymentRecord.verificationRequired, true)

const require = createRequire(import.meta.url)
const { assertBroadcastOptIn, safeDefaultResult } = require('../contracts/scripts/deploy.js')
assert.equal(safeDefaultResult().broadcastPerformed, false)
assert.equal(safeDefaultResult().broadcastEligible, false)
assert.throws(
  () => assertBroadcastOptIn({ PHASE3_MAINNET_BROADCAST: 'disabled' }),
  /PHASE3_MAINNET_BROADCAST must be explicitly-approved/
)
assert.doesNotThrow(() =>
  assertBroadcastOptIn({ PHASE3_MAINNET_BROADCAST: 'explicitly-approved' })
)

console.log('PHASE 3 DEPLOYMENT PLAN TESTS PASSED')