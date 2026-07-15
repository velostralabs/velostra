import { fallback, http, type Transport } from 'viem'

const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

export function parseRpcUrls(primary: string, fallbackCsv?: string): string[] {
  const candidates = [primary, ...(fallbackCsv ?? '').split(',')]
    .map((value) => value.trim())
    .filter(Boolean)
  const unique: string[] = []

  for (const candidate of candidates) {
    const parsed = new URL(candidate)
    if (!HTTP_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('RPC URLs must use HTTP(S) without embedded credentials')
    }
    const normalized = parsed.toString().replace(/\/$/, '')
    if (!unique.includes(normalized)) unique.push(normalized)
  }

  if (unique.length === 0) throw new Error('At least one RPC URL is required')
  return unique
}

export function createResilientRpcTransport(
  urls: readonly string[],
  timeoutMs: number
): Transport {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('RPC timeout must be a positive integer')
  }
  const transports = urls.map((url) => http(url, { timeout: timeoutMs, retryCount: 0 }))
  if (transports.length === 1) return transports[0]
  return fallback(transports, {
    rank: false,
    retryCount: 0,
  })
}
