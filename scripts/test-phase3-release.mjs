import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  createPhase3Manifest,
  gitHead,
  readJson,
  sealManifest,
  validateReleaseAuthorityPolicy,
  validatePhase3Manifest,
} from './lib/phase3-release.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = await readJson(
  path.join(repositoryRoot, 'config/phase3-release-input.example.json')
)
const manifest = await createPhase3Manifest({
  repositoryRoot,
  input,
  generatedAt: '2026-07-16T00:00:00.000Z',
  allowDirty: true,
})

assert.equal(
  canonicalJson({ z: 1, a: { d: 2, c: 3 } }),
  canonicalJson({ a: { c: 3, d: 2 }, z: 1 })
)
assert.equal(manifest.release, gitHead(repositoryRoot))
assert.equal(manifest.authorization.mainnetApproved, false)
assert.equal(manifest.contract.address, null)

const authorityPolicy = await readJson(
  path.join(repositoryRoot, manifest.policies.authority.path)
)
const productionAuthorityPolicy = structuredClone(authorityPolicy)
productionAuthorityPolicy.environment = 'robinhood-mainnet'
productionAuthorityPolicy.change_ticket = 'release-1234'
const expectedPrincipals = {
  DEFAULT_ADMIN: manifest.contract.constructor.roles.admin,
  FEE_MANAGER: manifest.contract.constructor.roles.admin,
  SETTLER: manifest.contract.constructor.roles.settler,
  TREASURY: manifest.contract.constructor.roles.treasury,
  PAUSER: manifest.contract.constructor.roles.pauseGuardian,
}
productionAuthorityPolicy.roles = productionAuthorityPolicy.roles.map((role) => ({
  ...role,
  principal: expectedPrincipals[role.role],
}))
const authorityContext = {
  stage: 'broadcast-approved',
  environment: 'robinhood-mainnet',
  changeTicket: 'release-1234',
  constructor: manifest.contract.constructor,
}
assert.deepEqual(
  validateReleaseAuthorityPolicy(productionAuthorityPolicy, authorityContext),
  { passed: true, failures: [] }
)
const wrongSettlerPolicy = structuredClone(productionAuthorityPolicy)
wrongSettlerPolicy.roles = wrongSettlerPolicy.roles.map((role) =>
  role.role === 'SETTLER'
    ? { ...role, principal: '0x9999999999999999999999999999999999999999' }
    : role
)
const wrongSettlerResult = validateReleaseAuthorityPolicy(
  wrongSettlerPolicy,
  authorityContext
)
assert.equal(wrongSettlerResult.passed, false)
assert(
  wrongSettlerResult.failures.includes(
    'authority principal differs from contract constructor for SETTLER'
  )
)

const valid = await validatePhase3Manifest({
  repositoryRoot,
  manifest,
  mode: 'preparation',
  expectedHead: gitHead(repositoryRoot),
  requireClean: false,
})
assert.deepEqual(valid, { passed: true, failures: [] })

const tamperedHash = structuredClone(manifest)
tamperedHash.repository.source.sha256 = '0'.repeat(64)
const tamperedHashResult = await validatePhase3Manifest({
  repositoryRoot,
  manifest: tamperedHash,
  mode: 'preparation',
  requireClean: false,
})
assert.equal(tamperedHashResult.passed, false)
assert(tamperedHashResult.failures.includes('manifest integrity hash mismatch'))
assert(tamperedHashResult.failures.includes('contract source hash mismatch'))

const omittedLockfile = sealManifest({
  ...manifest,
  integrity: undefined,
  repository: {
    ...manifest.repository,
    lockfiles: manifest.repository.lockfiles.slice(1),
  },
})
const omittedLockfileResult = await validatePhase3Manifest({
  repositoryRoot,
  manifest: omittedLockfile,
  mode: 'preparation',
  requireClean: false,
})
assert.equal(omittedLockfileResult.passed, false)
assert(
  omittedLockfileResult.failures.includes(
    'manifest lockfile set differs from required release lockfiles'
  )
)

const omittedReleaseTool = sealManifest({
  ...manifest,
  integrity: undefined,
  repository: {
    ...manifest.repository,
    releaseTools: manifest.repository.releaseTools.slice(1),
  },
})
const omittedReleaseToolResult = await validatePhase3Manifest({
  repositoryRoot,
  manifest: omittedReleaseTool,
  mode: 'preparation',
  requireClean: false,
})
assert.equal(omittedReleaseToolResult.passed, false)
assert(
  omittedReleaseToolResult.failures.includes(
    'manifest release-tool set differs from required release tools'
  )
)

const divergentArtifactPath = sealManifest({
  ...manifest,
  integrity: undefined,
  contract: { ...manifest.contract, artifact: 'contracts/build/MockUSD.json' },
})
const divergentArtifactResult = await validatePhase3Manifest({
  repositoryRoot,
  manifest: divergentArtifactPath,
  mode: 'preparation',
  requireClean: false,
})
assert.equal(divergentArtifactResult.passed, false)
assert(
  divergentArtifactResult.failures.includes(
    'contract artifact path differs from repository artifact entry'
  )
)

const wrongChain = sealManifest({
  ...manifest,
  integrity: undefined,
  chain: { ...manifest.chain, id: 1 },
})
const wrongChainResult = await validatePhase3Manifest({
  repositoryRoot,
  manifest: wrongChain,
  mode: 'preparation',
  requireClean: false,
})
assert.equal(wrongChainResult.passed, false)
assert(wrongChainResult.failures.includes('chain id must be 4663'))

const prematurelyApproved = sealManifest({
  ...manifest,
  integrity: undefined,
  authorization: { ...manifest.authorization, mainnetApproved: true },
})
const prematureResult = await validatePhase3Manifest({
  repositoryRoot,
  manifest: prematurelyApproved,
  mode: 'preparation',
  requireClean: false,
})
assert.equal(prematureResult.passed, false)
assert(prematureResult.failures.includes('preparation must not authorize mainnet'))

const broadcastResult = await validatePhase3Manifest({
  repositoryRoot,
  manifest,
  mode: 'broadcast',
  requireClean: false,
})
assert.equal(broadcastResult.passed, false)
assert(
  broadcastResult.failures.includes(
    'broadcast validation requires broadcast-approved stage'
  )
)
assert(broadcastResult.failures.includes('mainnetApproved must be true'))
assert(broadcastResult.failures.includes('Phase 2 evidence file entry is required'))
assert(
  broadcastResult.failures.includes('independent review file entry is required')
)

console.log('PHASE 3 RELEASE MANIFEST TESTS PASSED')
