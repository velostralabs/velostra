import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, gitHead, readJson, sealManifest } from './lib/phase3-release.mjs'
import {
  createMainnetReadinessPacket,
  validateMainnetReadinessPacket,
} from './lib/mainnet-readiness.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = await readJson(path.join(repositoryRoot, 'config/mainnet-readiness-input.example.json'))
const pendingPacket = await createMainnetReadinessPacket({
  repositoryRoot,
  input,
  generatedAt: '2026-07-21T00:00:00.000Z',
  allowDirty: true,
})

assert.equal(pendingPacket.decision, 'NO_GO')
assert.deepEqual(pendingPacket.authorization, {
  mainnetBroadcast: false,
  canaryExecution: false,
  expansion: false,
})
assert.equal(pendingPacket.gates.environmentIsolation, true)
assert.deepEqual(pendingPacket.blockers, [
  'independent audit is incomplete',
  'mainnet authority and custody plan is incomplete',
  'production recovery, alert, and runbook gates are incomplete',
  'two-person approval roles are not assigned',
])
assert.deepEqual(
  await validateMainnetReadinessPacket({
    repositoryRoot,
    packet: pendingPacket,
    expectedHead: gitHead(repositoryRoot),
    requireClean: false,
  }),
  { passed: true, ready: false, failures: [] }
)

const prematureGate = await validateMainnetReadinessPacket({
  repositoryRoot,
  packet: pendingPacket,
  requireClean: false,
  requireReady: true,
})
assert.equal(prematureGate.passed, false)
assert(prematureGate.failures.includes('mainnet readiness decision is not READY_FOR_SIGNING'))

const authorized = sealManifest({
  ...pendingPacket,
  integrity: undefined,
  authorization: { ...pendingPacket.authorization, mainnetBroadcast: true },
})
const authorizedResult = await validateMainnetReadinessPacket({ repositoryRoot, packet: authorized, requireClean: false })
assert.equal(authorizedResult.passed, false)
assert(authorizedResult.failures.includes('packet must not authorize mainnet broadcast'))

const credentialLeak = sealManifest({
  ...pendingPacket,
  integrity: undefined,
  controls: { ...pendingPacket.controls, privateKey: 'must-never-appear' },
})
const credentialResult = await validateMainnetReadinessPacket({ repositoryRoot, packet: credentialLeak, requireClean: false })
assert.equal(credentialResult.passed, false)
assert(credentialResult.failures.some((failure) => failure.includes('forbidden credential field')))

const testRoot = path.join(repositoryRoot, 'artifacts', 'mainnet', 'readiness-test')
await fs.rm(testRoot, { recursive: true, force: true })
await fs.mkdir(testRoot, { recursive: true })
try {
  const authority = await readJson(path.join(repositoryRoot, input.paths.authorityPlan))
  authority.status = 'ready'
  authority.ownerSetsDisjoint = true
  authority.safes.forEach((safe, index) => {
    safe.principal = `0x${String(index + 1).repeat(40)}`
    safe.owners = [1, 2, 3].map((owner) => `${safe.purpose}-owner-${owner}`)
  })
  authority.settler.principal = `0x${'4'.repeat(40)}`
  authority.settler.rotationDrillPassed = true
  authority.recovery = {
    runbookReviewed: true,
    accessDrillPassed: true,
    lastDrillAt: '2026-07-20T00:00:00.000Z',
  }
  const deployment = await readJson(path.join(repositoryRoot, input.paths.deploymentPlan))
  const canary = await readJson(path.join(repositoryRoot, input.paths.canaryPolicy))
  const environmentIsolation = await readJson(path.join(repositoryRoot, input.paths.environmentIsolation))
  const relative = (name) => `artifacts/mainnet/readiness-test/${name}`
  await fs.writeFile(path.join(testRoot, 'authority.json'), canonicalJson(authority))
  await fs.writeFile(path.join(testRoot, 'deployment.json'), canonicalJson(deployment))
  await fs.writeFile(path.join(testRoot, 'canary.json'), canonicalJson(canary))
  await fs.writeFile(path.join(testRoot, 'environment-isolation.json'), canonicalJson(environmentIsolation))
  await fs.writeFile(path.join(testRoot, 'audit-report.txt'), 'independent test fixture\n')

  const readyInput = structuredClone(input)
  readyInput.paths = {
    environmentIsolation: relative('environment-isolation.json'),
    authorityPlan: relative('authority.json'),
    deploymentPlan: relative('deployment.json'),
    canaryPolicy: relative('canary.json'),
  }
  readyInput.audit = {
    status: 'complete',
    scopeAccepted: true,
    reviewerOrganization: 'Independent Review Fixture',
    reportPath: relative('audit-report.txt'),
    reportSha256: null,
    criticalOpen: 0,
    highOpen: 0,
    mediumFindingsDispositioned: true,
  }
  Object.keys(readyInput.operations).forEach((key) => { readyInput.operations[key] = true })
  readyInput.approvalPolicy.approversAssigned = true
  const readyPacket = await createMainnetReadinessPacket({
    repositoryRoot,
    input: readyInput,
    generatedAt: '2026-07-21T00:00:00.000Z',
    allowDirty: true,
  })
  assert.equal(readyPacket.decision, 'READY_FOR_SIGNING')
  assert.equal(readyPacket.gates.environmentIsolation, true)
  assert.deepEqual(readyPacket.blockers, [])
  assert.equal(readyPacket.authorization.mainnetBroadcast, false)
  assert.deepEqual(
    await validateMainnetReadinessPacket({
      repositoryRoot,
      packet: readyPacket,
      requireClean: false,
      requireReady: true,
    }),
    { passed: true, ready: true, failures: [] }
  )


  environmentIsolation.separateResourcesRequired.database = false
  await fs.writeFile(path.join(testRoot, 'environment-isolation.json'), canonicalJson(environmentIsolation))
  const sharedDatabase = await validateMainnetReadinessPacket({ repositoryRoot, packet: readyPacket, requireClean: false })
  assert.equal(sharedDatabase.passed, false)
  assert(sharedDatabase.failures.includes('environment isolation plan hash mismatch'))
  assert(sharedDatabase.failures.includes('mainnet database must be isolated from testnet'))
  environmentIsolation.separateResourcesRequired.database = true
  await fs.writeFile(path.join(testRoot, 'environment-isolation.json'), canonicalJson(environmentIsolation))

  deployment.paidWritesAtDeploy = 'enabled'
  await fs.writeFile(path.join(testRoot, 'deployment.json'), canonicalJson(deployment))
  const tamperedPlan = await validateMainnetReadinessPacket({ repositoryRoot, packet: readyPacket, requireClean: false })
  assert.equal(tamperedPlan.passed, false)
  assert(tamperedPlan.failures.includes('deployment plan hash mismatch'))
  assert(tamperedPlan.failures.includes('paid writes must be disabled at deployment'))
} finally {
  await fs.rm(testRoot, { recursive: true, force: true })
}

console.log('MAINNET READINESS PACKET TESTS PASSED')