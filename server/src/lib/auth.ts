/**
 * Velostra — Auth Utilities (Robinhood Chain / EVM edition)
 *
 * Ported from the original Solana/Phantom `nacl.sign.detached.verify` flow
 * to standard EVM `personal_sign` (EIP-191) verification via viem, since
 * Robinhood Chain wallets (MetaMask, Robinhood Wallet, any injected EVM
 * wallet) sign messages the Ethereum way, not the Solana way.
 */

import { SignJWT, jwtVerify } from 'jose'
import type { Request } from 'express'
import { verifyMessage, isAddress, getAddress } from 'viem'
import { nanoid } from 'nanoid'
// NOTE: prisma is imported lazily inside completeWalletLogin() rather than
// at module scope. This keeps the pure crypto functions in this file
// (generateAuthNonce, verifyWalletSignature, signJWT/verifyJWT) importable
// and testable without requiring a generated Prisma client / live database.

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me')
const NONCE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ─────────────────────────────────────────
// JWT
// ─────────────────────────────────────────

export interface AuthPayload {
  id: string
  wallet_address: string
  display_name?: string
  is_builder: boolean
  is_admin: boolean
  [key: string]: unknown
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

// ─────────────────────────────────────────
// REQUEST AUTH (Express)
// ─────────────────────────────────────────

export async function verifyAuth(req: Request): Promise<AuthPayload | null> {
  const token =
    req.cookies?.velostra_token ?? req.headers.authorization?.replace('Bearer ', '')

  if (!token) return null
  return verifyJWT(token)
}

export async function requireAdminAuth(req: Request): Promise<AuthPayload | null> {
  const auth = await verifyAuth(req)
  if (!auth?.is_admin) return null
  return auth
}

export async function requireBuilderAuth(req: Request): Promise<AuthPayload | null> {
  const auth = await verifyAuth(req)
  if (!auth?.is_builder) return null
  return auth
}

// ─────────────────────────────────────────
// NONCE STORE
// ─────────────────────────────────────────
// In-memory nonce store, keyed by wallet address. Swap for Redis in a
// multi-instance deployment (same shape as gateway/ratelimit.ts below).

const nonceStore = new Map<string, { nonce: string; message: string; expires: number }>()

function cleanExpiredNonces() {
  const now = Date.now()
  for (const [key, val] of nonceStore.entries()) {
    if (val.expires < now) nonceStore.delete(key)
  }
}

/**
 * Generate a SIWE-style plaintext message for the wallet to sign.
 * EVM wallets sign human-readable messages via `personal_sign`, unlike
 * Solana's raw-bytes ed25519 signing — so this message IS the payload.
 */
export function generateAuthNonce(walletAddress: string): { message: string; nonce: string } {
  cleanExpiredNonces()

  if (!isAddress(walletAddress)) {
    throw new Error('Invalid EVM address')
  }

  const checksummed = getAddress(walletAddress)
  const nonce = nanoid(16)
  const issuedAt = new Date().toISOString()

  const message = [
    'Velostra wants you to sign in with your Robinhood Chain wallet.',
    '',
    'This request will not trigger a blockchain transaction or cost any gas.',
    '',
    `Wallet: ${checksummed}`,
    `Chain ID: 4663`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n')

  nonceStore.set(checksummed, { nonce, message, expires: Date.now() + NONCE_TTL_MS })

  return { message, nonce }
}

// ─────────────────────────────────────────
// WALLET SIGNATURE VERIFICATION (EIP-191)
// ─────────────────────────────────────────

export async function verifyWalletSignature(
  walletAddress: string,
  signature: `0x${string}`
): Promise<boolean> {
  if (!isAddress(walletAddress)) return false
  const checksummed = getAddress(walletAddress)

  const stored = nonceStore.get(checksummed)
  if (!stored) return false
  if (stored.expires < Date.now()) {
    nonceStore.delete(checksummed)
    return false
  }

  try {
    const valid = await verifyMessage({
      address: checksummed,
      message: stored.message,
      signature,
    })
    if (valid) nonceStore.delete(checksummed) // one-time use
    return valid
  } catch {
    return false
  }
}

// ─────────────────────────────────────────
// LOGIN FLOW
// ─────────────────────────────────────────

export async function completeWalletLogin(
  walletAddress: string,
  signature: `0x${string}`
): Promise<{ token: string; user: AuthPayload } | { error: string }> {
  const ok = await verifyWalletSignature(walletAddress, signature)
  if (!ok) return { error: 'Invalid or expired wallet signature' }

  const { db } = await import('../db/client.js')
  const { users, builders } = await import('../db/schema.js')
  const { eq, sql } = await import('drizzle-orm')

  const checksummed = getAddress(walletAddress)

  const [user] = await db
    .insert(users)
    .values({ wallet_address: checksummed })
    .onConflictDoUpdate({ target: users.wallet_address, set: { updated_at: sql`now()` } })
    .returning()

  const [builderProfile] = await db.select().from(builders).where(eq(builders.user_id, user.id)).limit(1)

  const isAdmin = process.env.ADMIN_WALLET
    ? checksummed.toLowerCase() === process.env.ADMIN_WALLET.toLowerCase()
    : false

  const payload: AuthPayload = {
    id: user.id,
    wallet_address: checksummed,
    display_name: user.display_name ?? undefined,
    is_builder: !!builderProfile,
    is_admin: isAdmin,
  }

  const token = await signJWT(payload)
  return { token, user: payload }
}
