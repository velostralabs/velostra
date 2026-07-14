// Velostra — Platform Constants (server)

export const PLATFORM_FEE_BPS = 1000 // 10%
export const BUILDER_SHARE_BPS = 9000 // 90%
export const MIN_PRICE_PER_CALL = 0.08
export const MIN_TOPUP_USD = 1.0
export const MIN_CLAIM_USD = 1.0
export const FREE_TIER_CALLS_PER_MONTH = 10

export const PRICE_TIERS = {
  BASIC: { min: 0.08, max: 0.5, label: 'Basic' },
  STANDARD: { min: 0.5, max: 2.0, label: 'Standard' },
  PRO: { min: 2.0, max: 10.0, label: 'Pro' },
  PREMIUM: { min: 10.0, max: Infinity, label: 'Premium' },
} as const

export type PriceTierKey = keyof typeof PRICE_TIERS

export function priceTierFor(price: number): PriceTierKey {
  if (price < 0.5) return 'BASIC'
  if (price < 2.0) return 'STANDARD'
  if (price < 10.0) return 'PRO'
  return 'PREMIUM'
}

export const AGENT_CATEGORIES = [
  'CRYPTO_DEFI',
  'WALLET_ANALYSIS',
  'TOKEN_RESEARCH',
  'TRADING',
  'WRITING',
  'RESEARCH',
  'PRODUCTIVITY',
  'DATA_ANALYSIS',
  'CODE',
  'OTHER',
] as const

// ─────────────────────────────────────────
// ROBINHOOD CHAIN
// ─────────────────────────────────────────

export const ROBINHOOD_CHAIN_ID = 4663
export const ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'
export const ROBINHOOD_EXPLORER_URL = 'https://robinhoodchain.blockscout.com'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

export const JWT_EXPIRY_SECONDS = 60 * 60 * 24
export const NONCE_EXPIRY_MS = 5 * 60 * 1000
