import assert from 'node:assert/strict'
import { assertProductionConfiguration } from '../src/lib/config.js'

const validProductionEnv: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://velostra:secret@db.internal:5432/velostra',
  JWT_SECRET: 'j'.repeat(32),
  GATEWAY_HMAC_SECRET: 'h'.repeat(32),
  AUTH_PUBLIC_URI: 'https://app.velostra.xyz',
  WEB_ORIGIN: 'https://app.velostra.xyz,https://www.velostra.xyz',
  REDIS_URL: 'rediss://redis.internal:6379',
  REDIS_FAILURE_MODE: 'closed',
  AUTH_NONCE_STORE: 'redis',
  AGENT_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  AGENT_SECRET_ENCRYPTION_KEY_ID: 'primary',
  VELOSTRA_ESCROW_ADDRESS: '0x1111111111111111111111111111111111111111',
  BACKEND_SIGNER_PRIVATE_KEY: `0x${'22'.repeat(32)}`,
  ONCHAIN_SETTLEMENT_MODE: 'required',
  ROBINHOOD_CHAIN_ID: '4663',
  SETTLEMENT_TOKEN_DECIMALS: '6',
  VELOSTRA_DEPLOYMENT_BLOCK: '123456',
  RECONCILE_MAX_BLOCK_RANGE: '2000',
  RECONCILE_RPC_RETRIES: '3',
  ROBINHOOD_RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
}

const managedKeys = new Set([...Object.keys(validProductionEnv), 'AGENT_SECRET_DECRYPTION_KEYS'])
const original = new Map<string, string | undefined>()
for (const key of managedKeys) original.set(key, process.env[key])

function configure(overrides: Record<string, string | undefined> = {}): void {
  for (const [key, value] of Object.entries({ ...validProductionEnv, ...overrides })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function rejects(overrides: Record<string, string | undefined>, expected: RegExp): void {
  configure(overrides)
  assert.throws(() => assertProductionConfiguration(), expected)
}

try {
  configure()
  assert.doesNotThrow(() => assertProductionConfiguration())
  console.log('✅ complete production configuration passes')

  rejects({ DATABASE_URL: undefined }, /DATABASE_URL is required/)
  rejects({ JWT_SECRET: 'weak' }, /JWT_SECRET/)
  rejects({ GATEWAY_HMAC_SECRET: 'weak' }, /GATEWAY_HMAC_SECRET/)
  rejects({ AUTH_PUBLIC_URI: 'http://app.velostra.xyz', WEB_ORIGIN: 'https://app.velostra.xyz' }, /AUTH_PUBLIC_URI/)
  rejects({ AUTH_NONCE_STORE: 'memory' }, /AUTH_NONCE_STORE/)
  rejects({ REDIS_FAILURE_MODE: 'open' }, /REDIS_FAILURE_MODE/)
  rejects({ AGENT_SECRET_ENCRYPTION_KEY: 'short' }, /AGENT_SECRET_ENCRYPTION_KEY/)
  rejects({ VELOSTRA_ESCROW_ADDRESS: '0x0000000000000000000000000000000000000000' }, /VELOSTRA_ESCROW_ADDRESS/)
  rejects({ BACKEND_SIGNER_PRIVATE_KEY: 'bad-key' }, /BACKEND_SIGNER_PRIVATE_KEY/)
  rejects({ ONCHAIN_SETTLEMENT_MODE: 'disabled' }, /ONCHAIN_SETTLEMENT_MODE/)
  rejects({ ROBINHOOD_CHAIN_ID: '1' }, /ROBINHOOD_CHAIN_ID/)
  rejects({ SETTLEMENT_TOKEN_DECIMALS: '18' }, /SETTLEMENT_TOKEN_DECIMALS/)
  rejects({ VELOSTRA_DEPLOYMENT_BLOCK: '0' }, /VELOSTRA_DEPLOYMENT_BLOCK/)
  rejects({ ROBINHOOD_RPC_URL: 'http://rpc.internal' }, /ROBINHOOD_RPC_URL/)
  console.log('✅ unsafe production configurations fail closed')
  console.log('\n🎉 PRODUCTION STARTUP GUARDRAILS VERIFIED')
} finally {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}