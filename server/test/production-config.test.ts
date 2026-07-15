import assert from 'node:assert/strict'
import { assertProductionConfiguration } from '../src/lib/config.js'

const validProductionEnv: Record<string, string> = {
  NODE_ENV: 'production',
  VELOSTRA_PROCESS_ROLE: 'api',
  VELOSTRA_SECRET_PROVIDER: 'managed-injection',
  VELOSTRA_ENVIRONMENT: 'staging',
  VELOSTRA_RELEASE: '1aab94d23740c139fd4f28cee370d002bde7e3d4',
  METRICS_AUTH_TOKEN: 'm'.repeat(32),
  OBSERVABILITY_INTERVAL_MS: '15000',
  READINESS_REQUIRE_WORKER: 'true',
  READINESS_WORKER_MAX_AGE_MS: '90000',
  MONITOR_INTERVAL_MS: '30000',
  ALERT_WEBHOOK_URL: 'https://alerts.velostra.internal/events',
  ALERT_WEBHOOK_TOKEN: 'a'.repeat(32),
  ALERT_RUNBOOK_BASE_URL: 'https://runbooks.velostra.internal/operations',
  ALERT_REQUIRE_BACKUP_HEARTBEAT: 'true',
  ALERT_SIGNER_MIN_BALANCE_WEI: '10000000000000000',
  DATABASE_URL: 'postgresql://velostra:secret@db.internal:5432/velostra?sslmode=require',
  DATABASE_POOL_MAX: '10',
  DATABASE_CONNECTION_TIMEOUT_MS: '5000',
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
  SETTLEMENT_SIGNER_MODE: 'remote',
  SETTLEMENT_SIGNER_URL: 'https://signer.staging.internal/v1/transactions',
  SETTLEMENT_SIGNER_AUTH_TOKEN: 's'.repeat(32),
  SETTLEMENT_SIGNER_ADDRESS: '0x4444444444444444444444444444444444444444',
  SETTLEMENT_SIGNER_TIMEOUT_MS: '10000',
  ONCHAIN_SETTLEMENT_MODE: 'required',
  ROBINHOOD_CHAIN_ID: '4663',
  SETTLEMENT_TOKEN_DECIMALS: '6',
  VELOSTRA_DEPLOYMENT_BLOCK: '123456',
  RECONCILE_MAX_BLOCK_RANGE: '2000',
  RECONCILE_RPC_RETRIES: '3',
  ROBINHOOD_RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
  ROBINHOOD_RPC_FALLBACK_URLS: 'https://rpc-backup.staging.internal',
}

const managedKeys = new Set([
  ...Object.keys(validProductionEnv),
  'AGENT_SECRET_DECRYPTION_KEYS',
  'BACKEND_SIGNER_PRIVATE_KEY',
  'PHASE2_ALLOW_MAINNET',
])
const original = new Map<string, string | undefined>()
for (const key of managedKeys) original.set(key, process.env[key])

function configure(overrides: Record<string, string | undefined> = {}): void {
  for (const key of managedKeys) delete process.env[key]
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
  console.log('PASS: complete staging configuration')

  rejects({ DATABASE_URL: undefined }, /DATABASE_URL is required/)
  rejects(
    { DATABASE_URL: 'postgresql://velostra:secret@db.internal:5432/velostra' },
    /DATABASE_URL must enforce TLS/
  )
  rejects({ DATABASE_POOL_MAX: '0' }, /DATABASE_POOL_MAX/)
  rejects({ VELOSTRA_SECRET_PROVIDER: 'environment' }, /VELOSTRA_SECRET_PROVIDER/)
  rejects({ JWT_SECRET: 'weak' }, /JWT_SECRET/)
  rejects({ GATEWAY_HMAC_SECRET: 'weak' }, /GATEWAY_HMAC_SECRET/)
  rejects(
    { AUTH_PUBLIC_URI: 'http://app.velostra.xyz', WEB_ORIGIN: 'https://app.velostra.xyz' },
    /AUTH_PUBLIC_URI/
  )
  rejects({ AUTH_NONCE_STORE: 'memory' }, /AUTH_NONCE_STORE/)
  rejects({ REDIS_URL: 'redis://redis.internal:6379' }, /REDIS_URL must use rediss/)
  rejects({ REDIS_FAILURE_MODE: 'open' }, /REDIS_FAILURE_MODE/)
  rejects({ AGENT_SECRET_ENCRYPTION_KEY: 'short' }, /AGENT_SECRET_ENCRYPTION_KEY/)
  rejects(
    { VELOSTRA_ESCROW_ADDRESS: '0x0000000000000000000000000000000000000000' },
    /VELOSTRA_ESCROW_ADDRESS/
  )
  rejects({ BACKEND_SIGNER_PRIVATE_KEY: '0x' + '22'.repeat(32) }, /must not receive/)
  rejects({ SETTLEMENT_SIGNER_MODE: 'local' }, /SETTLEMENT_SIGNER_MODE/)
  rejects({ SETTLEMENT_SIGNER_URL: 'http://signer.internal' }, /SETTLEMENT_SIGNER_URL/)
  rejects({ SETTLEMENT_SIGNER_AUTH_TOKEN: 'weak' }, /SETTLEMENT_SIGNER_AUTH_TOKEN/)
  rejects({ SETTLEMENT_SIGNER_ADDRESS: '0x0000000000000000000000000000000000000000' }, /SETTLEMENT_SIGNER_ADDRESS/)
  rejects({ ONCHAIN_SETTLEMENT_MODE: 'disabled' }, /ONCHAIN_SETTLEMENT_MODE/)
  rejects({ ROBINHOOD_CHAIN_ID: '1' }, /ROBINHOOD_CHAIN_ID/)
  rejects({ SETTLEMENT_TOKEN_DECIMALS: '18' }, /SETTLEMENT_TOKEN_DECIMALS/)
  rejects({ VELOSTRA_DEPLOYMENT_BLOCK: '0' }, /VELOSTRA_DEPLOYMENT_BLOCK/)
  rejects({ ROBINHOOD_RPC_URL: 'http://rpc.internal' }, /ROBINHOOD_RPC_URL/)
  rejects({ ROBINHOOD_RPC_FALLBACK_URLS: 'https://rpc-ok.internal,http://rpc-unsafe.internal' }, /ROBINHOOD_RPC_FALLBACK_URLS/)
  rejects({ VELOSTRA_ENVIRONMENT: 'Invalid Environment' }, /VELOSTRA_ENVIRONMENT/)
  rejects({ VELOSTRA_RELEASE: 'dev' }, /VELOSTRA_RELEASE/)
  rejects({ VELOSTRA_RELEASE: '1aab94d' }, /40-character commit SHA/)
  rejects({ METRICS_AUTH_TOKEN: 'weak' }, /METRICS_AUTH_TOKEN/)
  rejects({ VELOSTRA_PROCESS_ROLE: 'operational-monitor', ALERT_WEBHOOK_URL: 'http://alerts.internal' }, /ALERT_WEBHOOK_URL/)
  rejects({ VELOSTRA_PROCESS_ROLE: 'operational-monitor', ALERT_WEBHOOK_TOKEN: 'weak' }, /ALERT_WEBHOOK_TOKEN/)
  rejects({ VELOSTRA_PROCESS_ROLE: 'operational-monitor', ALERT_RUNBOOK_BASE_URL: 'http://runbooks.internal' }, /ALERT_RUNBOOK_BASE_URL/)
  rejects({ READINESS_REQUIRE_WORKER: 'false' }, /READINESS_REQUIRE_WORKER/)
  rejects({ VELOSTRA_PROCESS_ROLE: 'operational-monitor', ALERT_REQUIRE_BACKUP_HEARTBEAT: 'false' }, /ALERT_REQUIRE_BACKUP_HEARTBEAT/)
  rejects({ VELOSTRA_PROCESS_ROLE: 'operational-monitor', ALERT_SIGNER_MIN_BALANCE_WEI: '-1' }, /ALERT_SIGNER_MIN_BALANCE_WEI/)
  rejects({ VELOSTRA_ENVIRONMENT: 'production' }, /Phase 2 blocks production\/mainnet/)
  rejects({ VELOSTRA_ENVIRONMENT: 'mainnet' }, /Phase 2 blocks production\/mainnet/)
  rejects({ VELOSTRA_ENVIRONMENT: 'robinhood-mainnet' }, /Phase 2 blocks production\/mainnet/)
  rejects({ VELOSTRA_PROCESS_ROLE: 'unknown' }, /VELOSTRA_PROCESS_ROLE/)

  configure({
    VELOSTRA_PROCESS_ROLE: 'migration',
    WEB_ORIGIN: undefined,
    JWT_SECRET: undefined,
    GATEWAY_HMAC_SECRET: undefined,
    REDIS_URL: undefined,
    AGENT_SECRET_ENCRYPTION_KEY: undefined,
    VELOSTRA_ESCROW_ADDRESS: undefined,
    ROBINHOOD_RPC_URL: undefined,
    SETTLEMENT_SIGNER_URL: undefined,
    SETTLEMENT_SIGNER_AUTH_TOKEN: undefined,
    METRICS_AUTH_TOKEN: undefined,
    ALERT_WEBHOOK_URL: undefined,
    ALERT_WEBHOOK_TOKEN: undefined,
  })
  assert.doesNotThrow(() => assertProductionConfiguration())

  configure({
    VELOSTRA_PROCESS_ROLE: 'operational-monitor',
    WEB_ORIGIN: undefined,
    JWT_SECRET: undefined,
    GATEWAY_HMAC_SECRET: undefined,
    AGENT_SECRET_ENCRYPTION_KEY: undefined,
    SETTLEMENT_SIGNER_URL: undefined,
    SETTLEMENT_SIGNER_AUTH_TOKEN: undefined,
    METRICS_AUTH_TOKEN: undefined,
  })
  assert.doesNotThrow(() => assertProductionConfiguration())
  configure({
    VELOSTRA_ENVIRONMENT: 'production',
    PHASE2_ALLOW_MAINNET: 'explicitly-approved',
  })
  assert.doesNotThrow(() => assertProductionConfiguration())

  console.log('PASS: unsafe deployment configurations fail closed')
  console.log('PRODUCTION STARTUP GUARDRAILS VERIFIED')
} finally {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
