const assert = require('assert')
const path = require('path')
const {
  ensureArtifactsPath,
  safeDefaultResult,
  validateRoleAddresses,
  validateTestnetBroadcastAuthorization,
} = require('../scripts/deploy-testnet')

const base = {
  VELOSTRA_TESTNET_BROADCAST: 'isolated-staging-approved',
  VELOSTRA_ENVIRONMENT: 'staging',
  VELOSTRA_DEPLOY_REGION: 'us-east4',
  ROBINHOOD_CHAIN_ID: '46630',
  VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE: 'deploy-mock-usd',
  ADMIN_ADDRESS: '0x1000000000000000000000000000000000000001',
  SETTLER_ADDRESS: '0x2000000000000000000000000000000000000002',
  TREASURY_ADDRESS: '0x3000000000000000000000000000000000000003',
  PAUSE_GUARDIAN_ADDRESS: '0x4000000000000000000000000000000000000004',
}

const safe = safeDefaultResult()
assert.equal(safe.broadcastPerformed, false)
assert.equal(safe.chainId, 46630)
assert.equal(safe.region, 'us-east4')

assert.deepEqual(
  validateTestnetBroadcastAuthorization(base, ['node', 'deploy', '--broadcast']),
  {
    chainId: 46630,
    region: 'us-east4',
    settlementTokenMode: 'deploy-mock-usd',
  }
)
assert.equal(validateRoleAddresses(base).settler, base.SETTLER_ADDRESS)
assert(
  ensureArtifactsPath('artifacts/staging/deployment.json').endsWith(
    path.join('artifacts', 'staging', 'deployment.json')
  )
)

const rejected = [
  [{ ...base, ROBINHOOD_CHAIN_ID: '4663' }, 'ROBINHOOD_CHAIN_ID'],
  [{ ...base, VELOSTRA_DEPLOY_REGION: 'asia-southeast1' }, 'VELOSTRA_DEPLOY_REGION'],
  [{ ...base, VELOSTRA_ENVIRONMENT: 'production' }, 'VELOSTRA_ENVIRONMENT'],
  [{ ...base, VELOSTRA_TESTNET_BROADCAST: 'explicitly-approved' }, 'VELOSTRA_TESTNET_BROADCAST'],
  [{ ...base, VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE: 'mainnet-token' }, 'VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE'],
]
for (const [environment, message] of rejected) {
  assert.throws(
    () =>
      validateTestnetBroadcastAuthorization(
        environment,
        ['node', 'deploy', '--broadcast']
      ),
    new RegExp(message)
  )
}
assert.throws(
  () => validateTestnetBroadcastAuthorization(base, ['node', 'deploy']),
  /--broadcast/
)
assert.throws(
  () =>
    validateRoleAddresses({
      ...base,
      TREASURY_ADDRESS: base.SETTLER_ADDRESS,
    }),
  /distinct/
)
assert.throws(
  () =>
    validateRoleAddresses({
      ...base,
      ADMIN_ADDRESS: '0x0000000000000000000000000000000000000000',
    }),
  /non-zero/
)
assert.throws(
  () => ensureArtifactsPath('../private-deployment.json'),
  /inside artifacts/
)

console.log('ROBINHOOD TESTNET DEPLOYMENT POLICY VERIFIED')
