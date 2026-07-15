import { getAddress, isAddress, type Address, type Hash, type Hex } from 'viem'
import { z } from 'zod'

const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const responseSchema = z.object({
  tx_hash: hashSchema,
  signer_address: z.string(),
})

export type SettlementSignerMode = 'local' | 'remote'

export function settlementSignerMode(): SettlementSignerMode {
  const value = process.env.SETTLEMENT_SIGNER_MODE ?? 'local'
  if (value !== 'local' && value !== 'remote') {
    throw new Error('SETTLEMENT_SIGNER_MODE must be local or remote')
  }
  return value
}

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function configuredRemoteSignerAddress(): Address {
  const rawAddress = process.env.SETTLEMENT_SIGNER_ADDRESS
  if (!rawAddress || !isAddress(rawAddress) || /^0x0{40}$/i.test(rawAddress)) {
    throw new Error('SETTLEMENT_SIGNER_ADDRESS must be a non-zero EVM address')
  }
  return getAddress(rawAddress)
}
function remoteSignerConfiguration(): {
  url: URL
  token: string
  address: Address
  timeoutMs: number
} {
  const rawUrl = process.env.SETTLEMENT_SIGNER_URL
  const token = process.env.SETTLEMENT_SIGNER_AUTH_TOKEN
  if (!rawUrl || !token) {
    throw new Error('SETTLEMENT_SIGNER_URL and SETTLEMENT_SIGNER_AUTH_TOKEN are required')
  }
  const url = new URL(rawUrl)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Production SETTLEMENT_SIGNER_URL must use HTTPS')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('SETTLEMENT_SIGNER_URL must be an HTTP(S) URL without embedded credentials')
  }
  if (token.length < 32) {
    throw new Error('SETTLEMENT_SIGNER_AUTH_TOKEN must be at least 32 characters')
  }
  return {
    url,
    token,
    address: configuredRemoteSignerAddress(),
    timeoutMs: positiveInteger('SETTLEMENT_SIGNER_TIMEOUT_MS', 10_000),
  }
}

export function getRemoteSettlementSignerAddress(): Address {
  return configuredRemoteSignerAddress()
}

export async function submitRemoteSettlement(input: {
  chainId: number
  to: Address
  data: Hex
  idempotencyKey: Hash
}): Promise<Hash> {
  const config = remoteSignerConfiguration()
  const response = await fetch(config.url, {
    method: 'POST',
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey,
      'user-agent': 'velostra-settlement/1',
    },
    body: JSON.stringify({
      chain_id: input.chainId,
      to: input.to,
      data: input.data,
      value: '0x0',
      idempotency_key: input.idempotencyKey,
    }),
  })

  if (!response.ok) {
    throw new Error(`Restricted signer rejected settlement request with HTTP ${response.status}`)
  }
  const parsed = responseSchema.parse(await response.json())
  if (getAddress(parsed.signer_address) !== config.address) {
    throw new Error('Restricted signer response does not match SETTLEMENT_SIGNER_ADDRESS')
  }
  return parsed.tx_hash as Hash
}
