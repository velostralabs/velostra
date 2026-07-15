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

const incompleteFlowPolicy = structuredClone(policy)
incompleteFlowPolicy.requiredFlow = incompleteFlowPolicy.requiredFlow.filter(
  (flow) => flow !== 'platform-revenue'
)
const incompleteFlowResult = validateCanaryPolicy(
  incompleteFlowPolicy,
  'preparation',
  manifest.environment
)
assert.equal(incompleteFlowResult.passed, false)
assert(
  incompleteFlowResult.failures.includes(
    'required canary flow is missing: platform-revenue'
  )
)
const wrongEnvironmentResult = validateCanaryPolicy(
  policy,
  'preparation',
  'another-environment'
)
assert.equal(wrongEnvironmentResult.passed, false)
assert(
  wrongEnvironmentResult.failures.includes(
    'canary policy environment differs from release environment'
  )
)

const malformedPolicy = structuredClone(policy)
malformedPolicy.allowlists.wallets = {}
malformedPolicy.requiredFlow = {}
malformedPolicy.stopActions = {}
const malformedResult = validateCanaryPolicy(malformedPolicy)
assert.equal(malformedResult.passed, false)
assert(malformedResult.failures.includes('wallets allowlist must not be empty'))
assert(malformedResult.failures.includes('required canary flow is missing: deposit'))
assert(malformedResult.failures.includes('required stop action is missing: disable-paid-writes'))

const zeroAddressPolicy = structuredClone(policy)
zeroAddressPolicy.allowlists.wallets = ['0x0000000000000000000000000000000000000000']
const zeroAddressResult = validateCanaryPolicy(zeroAddressPolicy)
assert.equal(zeroAddressResult.passed, false)
assert(zeroAddressResult.failures.includes('wallet allowlist contains an invalid address'))

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
const { deploymentTransactionChecks } = require(
  '../contracts/scripts/verify-deployment.js'
)
assert.equal(safeDefaultResult().broadcastPerformed, false)
assert.equal(safeDefaultResult().broadcastEligible, false)
assert.throws(
  () => assertBroadcastOptIn({ PHASE3_MAINNET_BROADCAST: 'disabled' }),
  /PHASE3_MAINNET_BROADCAST must be explicitly-approved/
)
assert.doesNotThrow(() =>
  assertBroadcastOptIn({ PHASE3_MAINNET_BROADCAST: 'explicitly-approved' })
)

const expectedInitCode = '0x60006000'
const approvedDeployer = '0x7000000000000000000000000000000000000007'
const transactionChecks = deploymentTransactionChecks(
  {
    from: approvedDeployer,
    to: null,
    chainId: 4663n,
    value: 0n,
    data: expectedInitCode,
  },
  { contract: { deployer: approvedDeployer } },
  expectedInitCode
)
assert(Object.values(transactionChecks).every(Boolean))
const wrongDeployerChecks = deploymentTransactionChecks(
  {
    from: '0x6000000000000000000000000000000000000006',
    to: null,
    chainId: 4663n,
    value: 0n,
    data: expectedInitCode,
  },
  { contract: { deployer: approvedDeployer } },
  expectedInitCode
)
assert.equal(wrongDeployerChecks.deployment_transaction_deployer, false)
assert.equal(
  deploymentTransactionChecks(
    {
      from: approvedDeployer,
      to: null,
      chainId: 4663n,
      value: 0n,
      data: '0x6001',
    },
    { contract: { deployer: approvedDeployer } },
    expectedInitCode
  ).deployment_transaction_init_code,
  false
)

console.log('PHASE 3 DEPLOYMENT PLAN TESTS PASSED')
