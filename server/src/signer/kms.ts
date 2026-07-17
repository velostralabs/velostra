import { createPublicKey } from 'node:crypto'
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
  toHex,
} from 'viem'

const KMS_API = 'https://cloudkms.googleapis.com/v1'
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
const KMS_KEY_VERSION =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/([a-z0-9-]+)\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]*$/
const HEX_32 = /^0x[0-9a-fA-F]{64}$/

export interface DigestSignature {
  r: Hex
  s: Hex
}

export interface DigestSigner {
  address(): Promise<Address>
  signDigest(digest: Hex): Promise<DigestSignature>
}

interface CachedAccessToken {
  token: string
  expiresAtMs: number
}

function base64UrlBytes(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

export function publicKeyPemToAddress(pem: string): Address {
  const key = createPublicKey(pem)
  const jwk = key.export({ format: 'jwk' })
  if (jwk.kty !== 'EC' || jwk.crv !== 'secp256k1' || !jwk.x || !jwk.y) {
    throw new Error('Cloud KMS public key is not secp256k1')
  }
  const x = base64UrlBytes(jwk.x)
  const y = base64UrlBytes(jwk.y)
  if (x.length !== 32 || y.length !== 32) {
    throw new Error('Cloud KMS secp256k1 public key has invalid coordinates')
  }
  const publicKey = Buffer.concat([x, y])
  const hash = keccak256(toHex(publicKey))
  return getAddress(('0x' + hash.slice(-40)) as Address)
}

function derLength(bytes: Buffer, offset: number): { length: number; offset: number } {
  const first = bytes[offset]
  if (first === undefined) throw new Error('DER signature is truncated')
  if ((first & 0x80) === 0) return { length: first, offset: offset + 1 }
  const octets = first & 0x7f
  if (octets < 1 || octets > 2 || offset + 1 + octets > bytes.length) {
    throw new Error('DER signature length is invalid')
  }
  let length = 0
  for (let index = 0; index < octets; index += 1) {
    length = (length << 8) | bytes[offset + 1 + index]
  }
  return { length, offset: offset + 1 + octets }
}

function derInteger(bytes: Buffer, offset: number): { value: Buffer; offset: number } {
  if (bytes[offset] !== 0x02) throw new Error('DER signature integer tag is invalid')
  const parsed = derLength(bytes, offset + 1)
  const end = parsed.offset + parsed.length
  if (parsed.length < 1 || end > bytes.length) throw new Error('DER signature integer is invalid')
  let value = bytes.subarray(parsed.offset, end)
  if ((value[0] & 0x80) !== 0) throw new Error('DER signature integer must be positive')
  while (value.length > 1 && value[0] === 0) value = value.subarray(1)
  if (value.length > 32) throw new Error('DER signature integer exceeds secp256k1 width')
  return { value: Buffer.concat([Buffer.alloc(32 - value.length), value]), offset: end }
}

export function parseDerSignature(signature: Buffer): DigestSignature {
  if (signature[0] !== 0x30) throw new Error('DER signature sequence tag is invalid')
  const sequence = derLength(signature, 1)
  const sequenceEnd = sequence.offset + sequence.length
  if (sequenceEnd !== signature.length) throw new Error('DER signature sequence length is invalid')
  const r = derInteger(signature, sequence.offset)
  const s = derInteger(signature, r.offset)
  if (s.offset !== sequenceEnd) throw new Error('DER signature has trailing data')
  return { r: toHex(r.value), s: toHex(s.value) }
}

export class GoogleCloudKmsDigestSigner implements DigestSigner {
  readonly keyVersion: string
  readonly expectedRegion: string
  readonly timeoutMs: number
  private accessToken?: CachedAccessToken
  private signerAddress?: Address

  constructor(options: { keyVersion: string; expectedRegion: string; timeoutMs?: number }) {
    const match = KMS_KEY_VERSION.exec(options.keyVersion)
    if (!match) throw new Error('GOOGLE_CLOUD_KMS_KEY_VERSION is invalid')
    if (match[1] !== options.expectedRegion) {
      throw new Error('Cloud KMS key region differs from VELOSTRA_REGION')
    }
    this.keyVersion = options.keyVersion
    this.expectedRegion = options.expectedRegion
    this.timeoutMs = options.timeoutMs ?? 5_000
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAtMs > Date.now() + 60_000) {
      return this.accessToken.token
    }
    const response = await fetch(METADATA_TOKEN_URL, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'metadata-flavor': 'Google' },
    })
    if (!response.ok) {
      throw new Error('Cloud metadata access token failed with HTTP ' + response.status)
    }
    const value = (await response.json()) as {
      access_token?: unknown
      expires_in?: unknown
    }
    if (
      typeof value.access_token !== 'string' ||
      !Number.isFinite(value.expires_in) ||
      Number(value.expires_in) <= 0
    ) {
      throw new Error('Cloud metadata access token response is invalid')
    }
    this.accessToken = {
      token: value.access_token,
      expiresAtMs: Date.now() + Number(value.expires_in) * 1_000,
    }
    return value.access_token
  }

  private async kmsFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.token()
    const response = await fetch(KMS_API + path, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      const body = (await response.text()).slice(0, 512)
      throw new Error(
        'Cloud KMS request failed with HTTP ' + response.status + (body ? ': ' + body : '')
      )
    }
    return response
  }

  async address(): Promise<Address> {
    if (this.signerAddress) return this.signerAddress
    const response = await this.kmsFetch('/' + this.keyVersion + '/publicKey')
    const value = (await response.json()) as { pem?: unknown; algorithm?: unknown }
    if (value.algorithm !== 'EC_SIGN_SECP256K1_SHA256' || typeof value.pem !== 'string') {
      throw new Error('Cloud KMS key must use EC_SIGN_SECP256K1_SHA256')
    }
    this.signerAddress = publicKeyPemToAddress(value.pem)
    return this.signerAddress
  }

  async signDigest(digest: Hex): Promise<DigestSignature> {
    if (!HEX_32.test(digest)) throw new Error('KMS signing digest must be exactly 32 bytes')
    const response = await this.kmsFetch('/' + this.keyVersion + ':asymmetricSign', {
      method: 'POST',
      body: JSON.stringify({
        digest: { sha256: Buffer.from(digest.slice(2), 'hex').toString('base64') },
      }),
    })
    const value = (await response.json()) as { signature?: unknown }
    if (typeof value.signature !== 'string') {
      throw new Error('Cloud KMS signature response is invalid')
    }
    return parseDerSignature(Buffer.from(value.signature, 'base64'))
  }
}