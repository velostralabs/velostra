import assert from 'node:assert/strict'
import {
  addMoney,
  compareMoney,
  money,
  moneyFromMinor,
  moneyToMinor,
  splitFee,
  subtractMoney,
} from '../src/lib/money.js'

assert.equal(money('0.1'), '0.100000')
assert.equal(money(1e-6), '0.000001')
assert.equal(moneyFromMinor(12_345_678n), '12.345678')
assert.equal(moneyToMinor('9007199254740993.000001'), 9007199254740993000001n)
assert.equal(addMoney('0.100001', '0.200002'), '0.300003')
assert.equal(subtractMoney('10', '0.000001'), '9.999999')
assert.equal(compareMoney('1.000000', '0.999999'), 1)
assert.throws(() => money('0.0000001'), /at most 6/)
assert.throws(() => money(Number.POSITIVE_INFINITY), /finite/)

const split = splitFee('1.000001', 1_000)
assert.deepEqual(split, {
  gross: '1.000001',
  builder: '0.900001',
  platform: '0.100000',
})
assert.equal(addMoney(split.builder, split.platform), split.gross)

console.log('[money] exact decimal and fee invariants passed')