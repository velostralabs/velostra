import type { CookieOptions } from 'express'

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/
const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')

function requireProductionEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Production ${name} is required`)
  return value
}

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Production ${name} must be a positive integer`)
  }
  return parsed
}

function assert32ByteSecret(name: string, value: string): void {
  const decoded = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64')
  if (decoded.length !== 32) throw new Error(`Production ${name} must encode exactly 32 bytes`)
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function webOrigins(): string[] {
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (origins.length === 0) throw new Error('WEB_ORIGIN must contain at least one origin')

  for (const origin of origins) {
    const parsed = new URL(origin)
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      throw new Error(`WEB_ORIGIN contains an invalid origin: ${origin}`)
    }
    if (isProduction() && parsed.protocol !== 'https:') {
      throw new Error(`Production WEB_ORIGIN must use HTTPS: ${origin}`)
    }
  }
  return origins
}

export function jsonBodyLimit(): string {
  return process.env.JSON_BODY_LIMIT ?? '64kb'
}

export function trustProxy(): boolean | number | string {
  const value = process.env.TRUST_PROXY
  if (!value || value === 'false') return false
  if (value === 'true') return true
  if (/^\d+$/.test(value)) return Number(value)
  return value
}

export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  }
}

export function clearAuthCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...options } = authCookieOptions()
  return options
}

export function assertProductionConfiguration(): void {
  const origins = webOrigins()
  if (!isProduction()) return

  const databaseUrl = new URL(requireProductionEnv('DATABASE_URL'))
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('Production DATABASE_URL must use postgres or postgresql')
  }
  const sslMode = databaseUrl.searchParams.get('sslmode')
  if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error(
      'Production DATABASE_URL must enforce TLS with sslmode=require, verify-ca, or verify-full'
    )
  }
  positiveInteger('DATABASE_POOL_MAX', process.env.DATABASE_POOL_MAX ?? '10')
  positiveInteger(
    'DATABASE_CONNECTION_TIMEOUT_MS',
    process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? '5000'
  )

  const jwtSecret = requireProductionEnv('JWT_SECRET')
  if (jwtSecret.length < 32 || jwtSecret === 'dev-secret-change-me') {
    throw new Error('Production JWT_SECRET must be at least 32 characters and non-default')
  }
  const gatewaySecret = requireProductionEnv('GATEWAY_HMAC_SECRET')
  if (gatewaySecret.length < 32 || gatewaySecret === 'replace-with-a-long-random-string') {
    throw new Error('Production GATEWAY_HMAC_SECRET must be at least 32 characters and non-default')
  }

  const authUri = new URL(requireProductionEnv('AUTH_PUBLIC_URI'))
  if (authUri.protocol !== 'https:' || authUri.origin !== authUri.toString().replace(/\/$/, '')) {
    throw new Error('Production AUTH_PUBLIC_URI must be a canonical HTTPS origin')
  }
  if (!origins.includes(authUri.origin)) {
    throw new Error('Production AUTH_PUBLIC_URI must be included in WEB_ORIGIN')
  }

  const redisUrl = new URL(requireProductionEnv('REDIS_URL'))
  if (redisUrl.protocol !== 'rediss:') {
    throw new Error('Production REDIS_URL must use rediss TLS')
  }
  if (process.env.REDIS_FAILURE_MODE === 'open') {
    throw new Error('Production REDIS_FAILURE_MODE cannot be open')
  }
  if (process.env.AUTH_NONCE_STORE === 'memory') {
    throw new Error('Production AUTH_NONCE_STORE cannot be memory')
  }

  const encryptionKey = requireProductionEnv('AGENT_SECRET_ENCRYPTION_KEY')
  assert32ByteSecret('AGENT_SECRET_ENCRYPTION_KEY', encryptionKey)
  const encryptionKeyId = process.env.AGENT_SECRET_ENCRYPTION_KEY_ID ?? 'primary'
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(encryptionKeyId)) {
    throw new Error('Production AGENT_SECRET_ENCRYPTION_KEY_ID is invalid')
  }

  const escrowAddress = requireProductionEnv('VELOSTRA_ESCROW_ADDRESS')
  if (!EVM_ADDRESS.test(escrowAddress) || /^0x0{40}$/i.test(escrowAddress)) {
    throw new Error('Production VELOSTRA_ESCROW_ADDRESS must be a non-zero EVM address')
  }
  const signerKey = requireProductionEnv('BACKEND_SIGNER_PRIVATE_KEY')
  const signerValue = PRIVATE_KEY.test(signerKey) ? BigInt(signerKey) : 0n
  if (signerValue <= 0n || signerValue >= SECP256K1_ORDER) {
    throw new Error('Production BACKEND_SIGNER_PRIVATE_KEY must be a valid secp256k1 private key')
  }
  if (process.env.ONCHAIN_SETTLEMENT_MODE !== 'required') {
    throw new Error('Production ONCHAIN_SETTLEMENT_MODE must be required')
  }
  if (positiveInteger('ROBINHOOD_CHAIN_ID', requireProductionEnv('ROBINHOOD_CHAIN_ID')) !== 4663) {
    throw new Error('Production ROBINHOOD_CHAIN_ID must be 4663')
  }
  if (positiveInteger('SETTLEMENT_TOKEN_DECIMALS', requireProductionEnv('SETTLEMENT_TOKEN_DECIMALS')) !== 6) {
    throw new Error('Production SETTLEMENT_TOKEN_DECIMALS must be 6')
  }
  positiveInteger('VELOSTRA_DEPLOYMENT_BLOCK', requireProductionEnv('VELOSTRA_DEPLOYMENT_BLOCK'))
  positiveInteger('RECONCILE_MAX_BLOCK_RANGE', process.env.RECONCILE_MAX_BLOCK_RANGE ?? '2000')
  positiveInteger('RECONCILE_RPC_RETRIES', process.env.RECONCILE_RPC_RETRIES ?? '3')

  const rpcUrl = new URL(requireProductionEnv('ROBINHOOD_RPC_URL'))
  if (rpcUrl.protocol !== 'https:') {
    throw new Error('Production ROBINHOOD_RPC_URL must use HTTPS')
  }

  const environment = requireProductionEnv('VELOSTRA_ENVIRONMENT')
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(environment)) {
    throw new Error('Production VELOSTRA_ENVIRONMENT must be a lowercase environment identifier')
  }
  if (environment === 'production' && process.env.PHASE2_ALLOW_MAINNET !== 'explicitly-approved') {
    throw new Error('Phase 2 blocks production environment startup without explicit release approval')
  }
  const release = requireProductionEnv('VELOSTRA_RELEASE')
  if (release.length < 7 || release.length > 128 || /\s/.test(release)) {
    throw new Error('Production VELOSTRA_RELEASE must identify an immutable build')
  }
}
