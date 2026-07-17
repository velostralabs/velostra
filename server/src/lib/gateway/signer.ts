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
  maxResponseBytes: number
  identityTokenAudience?: URL
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
  const rawAudience = process.env.SETTLEMENT_SIGNER_ID_TOKEN_AUDIENCE?.trim()
  const identityTokenAudience = rawAudience ? new URL(rawAudience) : undefined
  if (
    identityTokenAudience &&
    (identityTokenAudience.protocol !== 'https:' ||
      identityTokenAudience.username ||
      identityTokenAudience.password ||
      identityTokenAudience.origin !== identityTokenAudience.toString().replace(/\/$/, ''))
  ) {
    throw new Error('SETTLEMENT_SIGNER_ID_TOKEN_AUDIENCE must be a canonical HTTPS origin')
  }
  return {
    url,
    token,
    address: configuredRemoteSignerAddress(),
    timeoutMs: positiveInteger('SETTLEMENT_SIGNER_TIMEOUT_MS', 10_000),
    maxResponseBytes: positiveInteger('SETTLEMENT_SIGNER_MAX_RESPONSE_BYTES', 16_384),
    identityTokenAudience,
  }
}

let cachedIdentityToken:
  | { audience: string; token: string; expiresAtSeconds: number }
  | undefined

function jwtExpirySeconds(token: string): number {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Cloud Run metadata returned a malformed identity token')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
    exp?: unknown
  }
  if (!Number.isInteger(payload.exp) || Number(payload.exp) <= 0) {
    throw new Error('Cloud Run identity token is missing a valid expiry')
  }
  return Number(payload.exp)
}

async function cloudRunIdentityToken(audience: URL, timeoutMs: number): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (
    cachedIdentityToken?.audience === audience.toString() &&
    cachedIdentityToken.expiresAtSeconds > nowSeconds + 60
  ) {
    return cachedIdentityToken.token
  }

  const endpoint = new URL(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity'
  )
  endpoint.searchParams.set('audience', audience.toString())
  endpoint.searchParams.set('format', 'full')
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
    headers: { 'metadata-flavor': 'Google' },
  })
  if (!response.ok) {
    throw new Error('Cloud Run identity token request failed with HTTP ' + response.status)
  }
  const token = (await response.text()).trim()
  cachedIdentityToken = {
    audience: audience.toString(),
    token,
    expiresAtSeconds: jwtExpirySeconds(token),
  }
  return token
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Restricted signer response exceeds configured byte limit')
  }
  if (!response.body) throw new Error('Restricted signer returned an empty response')

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error('Restricted signer response exceeds configured byte limit')
    }
    chunks.push(Buffer.from(value))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
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
  const headers: Record<string, string> = {
    authorization: 'Bearer ' + config.token,
    'content-type': 'application/json',
    'idempotency-key': input.idempotencyKey,
    'user-agent': 'velostra-settlement/1',
  }
  if (config.identityTokenAudience) {
    headers['x-serverless-authorization'] =
      'Bearer ' + await cloudRunIdentityToken(config.identityTokenAudience, config.timeoutMs)
  }
  const response = await fetch(config.url, {
    method: 'POST',
    signal: AbortSignal.timeout(config.timeoutMs),
    headers,
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
  const parsed = responseSchema.parse(await readBoundedJson(response, config.maxResponseBytes))
  if (getAddress(parsed.signer_address) !== config.address) {
    throw new Error('Restricted signer response does not match SETTLEMENT_SIGNER_ADDRESS')
  }
  return parsed.tx_hash as Hash
}
