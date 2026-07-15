import { SignJWT, jwtVerify } from 'jose'
import type { Request } from 'express'
import { verifyMessage, isAddress, getAddress } from 'viem'
import { nanoid } from 'nanoid'
import { ensureRedisConnected } from './redis.js'
import { webOrigins } from './config.js'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me')
const NONCE_TTL_MS = 5 * 60 * 1000
const NONCE_PREFIX = 'velostra:auth:nonce:'

export interface AuthPayload {
  id: string
  wallet_address: string
  display_name?: string
  is_builder: boolean
  is_admin: boolean
  [key: string]: unknown
}

export interface AuthNonceRecord {
  nonce: string
  message: string
  expiresAt: number
}

export interface StoredAuthNonce {
  record: AuthNonceRecord
  token: string
}

export interface AuthNonceStore {
  put(walletAddress: string, record: AuthNonceRecord, ttlMs: number): Promise<void>
  read(walletAddress: string): Promise<StoredAuthNonce | null>
  consume(walletAddress: string, token: string): Promise<boolean>
}

export class MemoryAuthNonceStore implements AuthNonceStore {
  private readonly values = new Map<string, { record: AuthNonceRecord; token: string }>()

  async put(walletAddress: string, record: AuthNonceRecord): Promise<void> {
    const token = JSON.stringify(record)
    this.values.set(walletAddress, { record, token })
  }

  async read(walletAddress: string): Promise<StoredAuthNonce | null> {
    const stored = this.values.get(walletAddress)
    if (!stored) return null
    if (stored.record.expiresAt <= Date.now()) {
      this.values.delete(walletAddress)
      return null
    }
    return { record: stored.record, token: stored.token }
  }

  async consume(walletAddress: string, token: string): Promise<boolean> {
    const stored = this.values.get(walletAddress)
    if (!stored || stored.token !== token || stored.record.expiresAt <= Date.now()) {
      if (stored?.record.expiresAt && stored.record.expiresAt <= Date.now()) {
        this.values.delete(walletAddress)
      }
      return false
    }
    this.values.delete(walletAddress)
    return true
  }
}

export class RedisAuthNonceStore implements AuthNonceStore {
  private key(walletAddress: string): string {
    return `${NONCE_PREFIX}${walletAddress.toLowerCase()}`
  }

  async put(walletAddress: string, record: AuthNonceRecord, ttlMs: number): Promise<void> {
    const redis = await ensureRedisConnected()
    await redis.set(this.key(walletAddress), JSON.stringify(record), 'PX', ttlMs)
  }

  async read(walletAddress: string): Promise<StoredAuthNonce | null> {
    const redis = await ensureRedisConnected()
    const token = await redis.get(this.key(walletAddress))
    if (!token) return null
    try {
      const record = JSON.parse(token) as AuthNonceRecord
      if (
        typeof record.nonce !== 'string' ||
        typeof record.message !== 'string' ||
        typeof record.expiresAt !== 'number' ||
        record.expiresAt <= Date.now()
      ) {
        await redis.del(this.key(walletAddress))
        return null
      }
      return { record, token }
    } catch {
      await redis.del(this.key(walletAddress))
      return null
    }
  }

  async consume(walletAddress: string, token: string): Promise<boolean> {
    const redis = await ensureRedisConnected()
    const result = await redis.eval(
      "local value = redis.call('GET', KEYS[1]); if not value then return 0 end; if value ~= ARGV[1] then return 0 end; redis.call('DEL', KEYS[1]); return 1",
      1,
      this.key(walletAddress),
      token
    )
    return Number(result) === 1
  }
}

export class AuthNonceService {
  constructor(private readonly store: AuthNonceStore) {}

  async generate(walletAddress: string): Promise<{ message: string; nonce: string }> {
    if (!isAddress(walletAddress)) throw new Error('Invalid EVM address')

    const checksummed = getAddress(walletAddress)
    const nonce = nanoid(16)
    const issuedAt = new Date()
    const expiresAt = issuedAt.getTime() + NONCE_TTL_MS
    const publicOrigin = new URL(process.env.AUTH_PUBLIC_URI ?? webOrigins()[0])
    const message = [
      `${publicOrigin.host} wants you to sign in with your Ethereum account:`,
      checksummed,
      '',
      'Sign in to Velostra. This request costs no gas and does not submit a transaction.',
      '',
      `URI: ${publicOrigin.origin}`,
      'Version: 1',
      'Chain ID: 4663',
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    ].join('\n')

    await this.store.put(checksummed, { nonce, message, expiresAt }, NONCE_TTL_MS)
    return { message, nonce }
  }

  async verify(walletAddress: string, signature: `0x${string}`): Promise<boolean> {
    if (!isAddress(walletAddress)) return false
    const checksummed = getAddress(walletAddress)
    const stored = await this.store.read(checksummed)
    if (!stored || stored.record.expiresAt <= Date.now()) return false

    try {
      const valid = await verifyMessage({
        address: checksummed,
        message: stored.record.message,
        signature,
      })
      if (!valid) return false
      return this.store.consume(checksummed, stored.token)
    } catch {
      return false
    }
  }
}

let defaultNonceService: AuthNonceService | undefined

function nonceStoreMode(): 'redis' | 'memory' {
  const configured = process.env.AUTH_NONCE_STORE
  if (configured === 'redis' || configured === 'memory') return configured
  return process.env.NODE_ENV === 'test' ? 'memory' : 'redis'
}

export function getAuthNonceService(): AuthNonceService {
  defaultNonceService ??= new AuthNonceService(
    nonceStoreMode() === 'memory' ? new MemoryAuthNonceStore() : new RedisAuthNonceStore()
  )
  return defaultNonceService
}

export function setAuthNonceServiceForTests(service: AuthNonceService | undefined): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Nonce service override is test-only')
  defaultNonceService = service
}

export async function signJWT(payload: AuthPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET)
}

export async function verifyJWT(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as AuthPayload
  } catch {
    return null
  }
}

export async function verifyAuth(req: Request): Promise<AuthPayload | null> {
  const token = req.cookies?.velostra_token ?? req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  return verifyJWT(token)
}

export async function requireAdminAuth(req: Request): Promise<AuthPayload | null> {
  const auth = await verifyAuth(req)
  return auth?.is_admin ? auth : null
}

export async function requireBuilderAuth(req: Request): Promise<AuthPayload | null> {
  const auth = await verifyAuth(req)
  return auth?.is_builder ? auth : null
}

export function generateAuthNonce(walletAddress: string): Promise<{ message: string; nonce: string }> {
  return getAuthNonceService().generate(walletAddress)
}

export function verifyWalletSignature(
  walletAddress: string,
  signature: `0x${string}`
): Promise<boolean> {
  return getAuthNonceService().verify(walletAddress, signature)
}

export async function completeWalletLogin(
  walletAddress: string,
  signature: `0x${string}`
): Promise<{ token: string; user: AuthPayload } | { error: string }> {
  const valid = await verifyWalletSignature(walletAddress, signature)
  if (!valid) return { error: 'Invalid or expired wallet signature' }

  const { db } = await import('../db/client.js')
  const { users, builders } = await import('../db/schema.js')
  const { eq, sql } = await import('drizzle-orm')

  const checksummed = getAddress(walletAddress)
  const [user] = await db
    .insert(users)
    .values({ wallet_address: checksummed })
    .onConflictDoUpdate({ target: users.wallet_address, set: { updated_at: sql`now()` } })
    .returning()
  const [builderProfile] = await db
    .select()
    .from(builders)
    .where(eq(builders.user_id, user.id))
    .limit(1)

  const isAdmin = process.env.ADMIN_WALLET
    ? checksummed.toLowerCase() === process.env.ADMIN_WALLET.toLowerCase()
    : false
  const payload: AuthPayload = {
    id: user.id,
    wallet_address: checksummed,
    display_name: user.display_name ?? undefined,
    is_builder: Boolean(builderProfile),
    is_admin: isAdmin,
  }

  return { token: await signJWT(payload), user: payload }
}