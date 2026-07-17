import { assertPhase3RuntimeConfiguration } from './phase3-canary.js'

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

export type DeploymentProcessRole =
  | 'api'
  | 'reconciliation-worker'
  | 'webhook-worker'
  | 'operational-monitor'
  | 'migration'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('Production ' + name + ' is required')
  return value
}

function positiveInteger(name: string, fallback?: string): number {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Production ' + name + ' must be a positive integer')
  }
  return parsed
}

function secret(name: string): string {
  const value = required(name)
  if (value.length < 32) throw new Error('Production ' + name + ' must be at least 32 characters')
  return value
}

function nonZeroAddress(name: string): string {
  const value = required(name)
  if (!EVM_ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error('Production ' + name + ' must be a non-zero EVM address')
  }
  return value
}

function httpsUrl(name: string): URL {
  const value = new URL(required(name))
  if (value.protocol !== 'https:' || value.username || value.password) {
    throw new Error('Production ' + name + ' must use HTTPS without embedded credentials')
  }
  return value
}

function optionalHttpsUrls(name: string): URL[] {
  const raw = process.env[name]?.trim()
  if (!raw) return []
  return raw.split(',').map((entry) => {
    const value = entry.trim()
    if (!value) throw new Error('Production ' + name + ' contains an empty URL')
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('Production ' + name + ' must use HTTPS without embedded credentials')
    }
    return parsed
  })
}

function exact32ByteSecret(name: string): void {
  const value = required(name)
  const decoded = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new Error('Production ' + name + ' must encode exactly 32 bytes')
  }
}

export function deploymentProcessRole(): DeploymentProcessRole {
  const role = process.env.VELOSTRA_PROCESS_ROLE ?? 'api'
  if (
    role !== 'api' &&
    role !== 'reconciliation-worker' &&
    role !== 'webhook-worker' &&
    role !== 'operational-monitor' &&
    role !== 'migration'
  ) {
    throw new Error('Production VELOSTRA_PROCESS_ROLE is invalid')
  }
  return role
}

function isMainnetLike(environment: string): boolean {
  return environment === 'production' || /(^|-)mainnet($|-)/.test(environment)
}

export function expectedRobinhoodChainId(environment: string): 4663 | 46630 {
  return isMainnetLike(environment) ? 4663 : 46630
}

function assertCommon(role: DeploymentProcessRole): string {
  if (required('VELOSTRA_SECRET_PROVIDER') !== 'managed-injection') {
    throw new Error('Production VELOSTRA_SECRET_PROVIDER must be managed-injection')
  }
  const databaseUrl = new URL(required('DATABASE_URL'))
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('Production DATABASE_URL must use postgres or postgresql')
  }
  const sslMode = databaseUrl.searchParams.get('sslmode')
  if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('Production DATABASE_URL must enforce TLS')
  }
  positiveInteger('DATABASE_POOL_MAX', '10')
  positiveInteger('DATABASE_CONNECTION_TIMEOUT_MS', '5000')

  const environment = required('VELOSTRA_ENVIRONMENT')
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(environment)) {
    throw new Error('Production VELOSTRA_ENVIRONMENT must be a lowercase identifier')
  }
  const mainnetLike = isMainnetLike(environment)
  const release = required('VELOSTRA_RELEASE')
  if (!/^[0-9a-f]{40}$/i.test(release)) {
    throw new Error('Production VELOSTRA_RELEASE must be a full 40-character commit SHA')
  }
  if (mainnetLike) assertPhase3RuntimeConfiguration(role, environment, release)
  return environment
}

function assertRedis(): void {
  const redis = new URL(required('REDIS_URL'))
  if (redis.protocol !== 'rediss:') throw new Error('Production REDIS_URL must use rediss TLS')
  if (process.env.REDIS_FAILURE_MODE === 'open') {
    throw new Error('Production REDIS_FAILURE_MODE cannot be open')
  }
}

function assertChain(environment: string, requireSignerAuthorization: boolean): void {
  nonZeroAddress('VELOSTRA_ESCROW_ADDRESS')
  const expectedChainId = expectedRobinhoodChainId(environment)
  if (positiveInteger('ROBINHOOD_CHAIN_ID') !== expectedChainId) {
    throw new Error(
      `Production ROBINHOOD_CHAIN_ID must be ${expectedChainId} for ${environment}`
    )
  }
  if (positiveInteger('SETTLEMENT_TOKEN_DECIMALS') !== 6) {
    throw new Error('Production SETTLEMENT_TOKEN_DECIMALS must be 6')
  }
  positiveInteger('VELOSTRA_DEPLOYMENT_BLOCK')
  httpsUrl('ROBINHOOD_RPC_URL')
  optionalHttpsUrls('ROBINHOOD_RPC_FALLBACK_URLS')
  if (process.env.ONCHAIN_SETTLEMENT_MODE !== 'required') {
    throw new Error('Production ONCHAIN_SETTLEMENT_MODE must be required')
  }
  if ((process.env.BACKEND_SIGNER_PRIVATE_KEY ?? '').trim()) {
    throw new Error('Production must not receive BACKEND_SIGNER_PRIVATE_KEY')
  }
  if (required('SETTLEMENT_SIGNER_MODE') !== 'remote') {
    throw new Error('Production SETTLEMENT_SIGNER_MODE must be remote')
  }
  nonZeroAddress('SETTLEMENT_SIGNER_ADDRESS')
  if (requireSignerAuthorization) {
    httpsUrl('SETTLEMENT_SIGNER_URL')
    secret('SETTLEMENT_SIGNER_AUTH_TOKEN')
    const rawAudience = process.env.SETTLEMENT_SIGNER_ID_TOKEN_AUDIENCE?.trim()
    if (rawAudience) {
      const audience = httpsUrl('SETTLEMENT_SIGNER_ID_TOKEN_AUDIENCE')
      if (audience.origin !== audience.toString().replace(/\/$/, '')) {
        throw new Error(
          'Production SETTLEMENT_SIGNER_ID_TOKEN_AUDIENCE must be a canonical HTTPS origin'
        )
      }
    }
    positiveInteger('SETTLEMENT_SIGNER_TIMEOUT_MS', '10000')
    positiveInteger('SETTLEMENT_SIGNER_MAX_RESPONSE_BYTES', '16384')
  }
}

function assertApi(environment: string, origins: string[]): void {
  secret('JWT_SECRET')
  secret('GATEWAY_HMAC_SECRET')
  secret('PLATFORM_CURSOR_SECRET')
  const authUri = httpsUrl('AUTH_PUBLIC_URI')
  if (authUri.origin !== authUri.toString().replace(/\/$/, '') || !origins.includes(authUri.origin)) {
    throw new Error('Production AUTH_PUBLIC_URI must be a canonical WEB_ORIGIN')
  }
  if (process.env.AUTH_NONCE_STORE === 'memory') {
    throw new Error('Production AUTH_NONCE_STORE cannot be memory')
  }
  assertRedis()
  exact32ByteSecret('AGENT_SECRET_ENCRYPTION_KEY')
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(process.env.AGENT_SECRET_ENCRYPTION_KEY_ID ?? 'primary')) {
    throw new Error('Production AGENT_SECRET_ENCRYPTION_KEY_ID is invalid')
  }
  assertChain(environment, true)
  secret('METRICS_AUTH_TOKEN')
  positiveInteger('OBSERVABILITY_INTERVAL_MS', '15000')
  positiveInteger('READINESS_WORKER_MAX_AGE_MS', '90000')
  positiveInteger('READINESS_WEBHOOK_WORKER_MAX_AGE_MS', '90000')
  if (process.env.READINESS_REQUIRE_WORKER !== 'true') {
    throw new Error('Production READINESS_REQUIRE_WORKER must be true')
  }
  if (process.env.READINESS_REQUIRE_WEBHOOK_WORKER !== 'true') {
    throw new Error('Production READINESS_REQUIRE_WEBHOOK_WORKER must be true')
  }
}

function assertReconciliationWorker(environment: string): void {
  assertChain(environment, true)
  positiveInteger('RECONCILE_MAX_BLOCK_RANGE', '2000')
  positiveInteger('RECONCILE_RPC_RETRIES', '3')
  positiveInteger('RECONCILE_INTERVAL_MS', '30000')
}

function assertWebhookWorker(): void {
  exact32ByteSecret('AGENT_SECRET_ENCRYPTION_KEY')
  positiveInteger('WEBHOOK_BATCH_SIZE', '25')
  positiveInteger('WEBHOOK_MAX_ATTEMPTS', '8')
  positiveInteger('WEBHOOK_RETRY_BASE_MS', '1000')
  positiveInteger('WEBHOOK_RETRY_MAX_MS', '3600000')
  positiveInteger('WEBHOOK_LOCK_MS', '60000')
  positiveInteger('WEBHOOK_INTERVAL_MS', '5000')
}

function assertMonitor(environment: string): void {
  assertRedis()
  assertChain(environment, false)
  httpsUrl('ALERT_WEBHOOK_URL')
  secret('ALERT_WEBHOOK_TOKEN')
  httpsUrl('ALERT_RUNBOOK_BASE_URL')
  positiveInteger('MONITOR_INTERVAL_MS', '30000')
  if (process.env.ALERT_REQUIRE_WEBHOOK_HEARTBEAT !== 'true') {
    throw new Error('Production ALERT_REQUIRE_WEBHOOK_HEARTBEAT must be true')
  }
  positiveInteger('ALERT_WEBHOOK_WORKER_MAX_AGE_SECONDS', '90')
  positiveInteger('ALERT_WEBHOOK_MAX_PENDING_AGE_SECONDS', '300')
  if (process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT !== 'true') {
    throw new Error('Production ALERT_REQUIRE_BACKUP_HEARTBEAT must be true')
  }
  if (!/^\d+$/.test(process.env.ALERT_SIGNER_MIN_BALANCE_WEI ?? '10000000000000000')) {
    throw new Error('Production ALERT_SIGNER_MIN_BALANCE_WEI must be a non-negative integer')
  }
}

export function assertDeploymentConfiguration(
  role: DeploymentProcessRole,
  origins: string[]
): void {
  const environment = assertCommon(role)
  if (role === 'migration') return
  if (role === 'api') assertApi(environment, origins)
  else if (role === 'reconciliation-worker') assertReconciliationWorker(environment)
  else if (role === 'webhook-worker') assertWebhookWorker()
  else assertMonitor(environment)
}
