import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backend = readFileSync(path.join(root, 'server/src/synthetic-agent/catalog.ts'), 'utf8')
const frontend = readFileSync(path.join(root, 'src/data/testnetDemoAgents.ts'), 'utf8')
const handler = readFileSync(path.join(root, 'server/src/synthetic-agent/index.ts'), 'utf8')

function parseProfiles(source) {
  const profiles = []
  const pattern = /slug:\s*'([^']+)'[\s\S]*?price:\s*([0-9.]+),[\s\S]*?scenario:\s*\{[\s\S]*?id:\s*'([^']+)'/g
  for (const match of source.matchAll(pattern)) {
    profiles.push({ slug: match[1], price: Number(match[2]), scenario: match[3] })
  }
  return profiles
}

const expected = [
  { slug: 'flowbook-trader', price: 4, scenario: 'market-brief' },
  { slug: 'wallet-sentinel', price: 0.2, scenario: 'approval-risk' },
  { slug: 'token-scope', price: 1.4, scenario: 'diligence-checklist' },
  { slug: 'contract-lens', price: 2.8, scenario: 'settlement-invariants' },
]

const backendPublic = parseProfiles(backend).filter((profile) =>
  expected.some((entry) => entry.slug === profile.slug)
)
assert.deepEqual(backendPublic, expected, 'backend public-demo catalog drifted')
assert.deepEqual(parseProfiles(frontend), expected, 'frontend public-demo catalog drifted')

for (const profile of expected) {
  assert(
    backend.includes("endpointPath: '/execute/" + profile.slug + "'"),
    profile.slug + ' is missing its isolated execution route'
  )
}
assert(handler.includes('input_retained: false'), 'synthetic responses must declare non-retention')
assert(handler.includes('syntheticProfileForPath(path)'), 'execution routes must resolve through the catalog')
assert(backend.includes('without placing an order or using live market data'))
assert(backend.includes('not investment advice'))
assert(backend.includes('not a substitute for a professional security audit'))

console.log('DEMO AGENT GATE PASSED: 4 public scenarios match backend, frontend, and safety boundaries')

