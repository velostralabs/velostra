import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  createPhase3Manifest,
  gitHead,
  readJson,
  sealManifest,
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