export const MONEY_DECIMALS = 6
export const MONEY_SCALE = 10n ** BigInt(MONEY_DECIMALS)

export type Money = string & { readonly __money: unique symbol }
export type MoneyInput = string | number | bigint

function expandExponent(value: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(value)
  if (!match) return value

  const [, sign, integer, fraction = '', exponentRaw] = match
  const exponent = Number(exponentRaw)
  if (!Number.isSafeInteger(exponent)) throw new Error('Money exponent is out of range')

  const digits = integer + fraction
  const decimalIndex = integer.length + exponent
  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
}

export function moneyToMinor(input: MoneyInput): bigint {
  if (typeof input === 'bigint') return input
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new Error('Money must be finite')
  }

  const normalized = expandExponent(String(input).trim())
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(normalized)
  if (!match) throw new Error(`Invalid money value: ${String(input)}`)

  const [, sign, whole, fraction = ''] = match
  if (fraction.length > MONEY_DECIMALS) {
    throw new Error(`Money supports at most ${MONEY_DECIMALS} decimal places`)
  }

  const units = BigInt(whole) * MONEY_SCALE + BigInt(fraction.padEnd(MONEY_DECIMALS, '0'))
  return sign === '-' ? -units : units
}

export function moneyFromMinor(units: bigint): Money {
  const sign = units < 0n ? '-' : ''
  const absolute = units < 0n ? -units : units
  const whole = absolute / MONEY_SCALE
  const fraction = (absolute % MONEY_SCALE).toString().padStart(MONEY_DECIMALS, '0')
  return `${sign}${whole}.${fraction}` as Money
}

export function money(input: MoneyInput): Money {
  return moneyFromMinor(moneyToMinor(input))
}

export function addMoney(...values: MoneyInput[]): Money {
  return moneyFromMinor(values.reduce<bigint>((sum, value) => sum + moneyToMinor(value), 0n))
}

export function subtractMoney(left: MoneyInput, right: MoneyInput): Money {
  return moneyFromMinor(moneyToMinor(left) - moneyToMinor(right))
}

export function compareMoney(left: MoneyInput, right: MoneyInput): -1 | 0 | 1 {
  const a = moneyToMinor(left)
  const b = moneyToMinor(right)
  return a < b ? -1 : a > b ? 1 : 0
}

export function moneyToNumber(input: MoneyInput): number {
  return Number(money(input))
}

export function splitFee(gross: MoneyInput, platformFeeBps: number) {
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) {
    throw new Error('platformFeeBps must be an integer between 0 and 10000')
  }

  const grossMinor = moneyToMinor(gross)
  if (grossMinor < 0n) throw new Error('Gross amount cannot be negative')

  // Solidity floors the fee and assigns the exact remainder to the builder.
  const platformMinor = (grossMinor * BigInt(platformFeeBps)) / 10_000n
  const builderMinor = grossMinor - platformMinor
  return {
    gross: moneyFromMinor(grossMinor),
    builder: moneyFromMinor(builderMinor),
    platform: moneyFromMinor(platformMinor),
  }
}