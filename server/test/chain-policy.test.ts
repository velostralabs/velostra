import assert from 'node:assert/strict'
import {
  confirmedSafeHead,
  planBlockRanges,
  reconciliationReorgPolicy,
} from '../src/lib/chain-policy.js'

assert.equal(reconciliationReorgPolicy, 'confirmation-depth')
assert.equal(confirmedSafeHead(100n, 12n), 88n)
assert.equal(confirmedSafeHead(5n, 12n), 0n)

const orphanCandidate = 99n
assert.ok(
  orphanCandidate > confirmedSafeHead(100n, 12n),
  'an event inside the confirmation window is not eligible for ingestion'
)
assert.ok(
  orphanCandidate <= confirmedSafeHead(111n, 12n),
  'the canonical replacement becomes eligible only after confirmation depth'
)

const ranges = planBlockRanges(17n, 29n, 5n)
assert.deepEqual(ranges, [
  { fromBlock: 17n, toBlock: 21n },
  { fromBlock: 22n, toBlock: 26n },
  { fromBlock: 27n, toBlock: 29n },
])
assert.equal(ranges[0].fromBlock, 17n)
assert.equal(ranges.at(-1)?.toBlock, 29n)
for (let index = 1; index < ranges.length; index += 1) {
  assert.equal(ranges[index].fromBlock, ranges[index - 1].toBlock + 1n)
}
assert.deepEqual(planBlockRanges(30n, 29n, 5n), [])
assert.throws(() => planBlockRanges(0n, 1n, 0n), /must be positive/)

console.log('CHAIN POLICY VERIFIED: confirmation window and gap-free range planning')
