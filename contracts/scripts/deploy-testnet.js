/**
 * Guarded Robinhood testnet deployment for the isolated US staging stack.
 *
 * This command cannot target mainnet: it requires chain 46630, environment
 * staging, region us-east4, an explicit testnet-only broadcast phrase, and a
 * live RPC chain check before constructing a transaction.
 */
const fs = require('fs')
const path = require('path')
const { ethers } = require('ethers')
require('dotenv').config()

const {
  assertAuthorityPrincipals,
} = require('./lib/testnet-authority-policy')
const ROOT = path.join(__dirname, '..')
const REPOSITORY_ROOT = path.join(ROOT, '..')
const ARTIFACTS_ROOT = path.join(REPOSITORY_ROOT, 'artifacts')
const CHAIN_ID = 46630
const REGION = 'us-east4'
const BROADCAST_APPROVAL = 'isolated-staging-approved'

function required(name, environment = process.env) {
  const value = environment[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function requiredAddress(name, environment = process.env) {
  const value = required(name, environment)
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(name + ' must be an explicit non-zero EVM address')
  }
  return ethers.getAddress(value)
}

function ensureArtifactsPath(candidate) {
  const resolved = path.resolve(REPOSITORY_ROOT, candidate)
  const relative = path.relative(ARTIFACTS_ROOT, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('TESTNET deployment output must stay inside artifacts/')
  }
  return resolved
}

function validateRoleAddresses(environment = process.env) {
  const roles = {
    admin: requiredAddress('ADMIN_ADDRESS', environment),
    settler: requiredAddress('SETTLER_ADDRESS', environment),
    treasury: requiredAddress('TREASURY_ADDRESS', environment),
    pauseGuardian: requiredAddress('PAUSE_GUARDIAN_ADDRESS', environment),
  }
  const normalized = Object.values(roles).map((address) => address.toLowerCase())
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Testnet operational roles must use distinct addresses')
  }
  return roles
}

function validateTestnetBroadcastAuthorization(
  environment = process.env,
  argv = process.argv
) {
  if (!argv.includes('--broadcast')) throw new Error('--broadcast is required')
  if (environment.VELOSTRA_TESTNET_BROADCAST !== BROADCAST_APPROVAL) {
    throw new Error('VELOSTRA_TESTNET_BROADCAST must be ' + BROADCAST_APPROVAL)
  }
  if (environment.VELOSTRA_ENVIRONMENT !== 'staging') {
    throw new Error('VELOSTRA_ENVIRONMENT must be staging')
  }
  if (environment.VELOSTRA_DEPLOY_REGION !== REGION) {
    throw new Error('VELOSTRA_DEPLOY_REGION must be ' + REGION)
  }
  if (environment.ROBINHOOD_CHAIN_ID !== String(CHAIN_ID)) {
    throw new Error('ROBINHOOD_CHAIN_ID must be ' + CHAIN_ID)
  }
  const mode = environment.VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE
  if (mode !== 'deploy-mock-usd' && mode !== 'existing') {
    throw new Error(
      'VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE must be deploy-mock-usd or existing'
    )
  }
  return { chainId: CHAIN_ID, region: REGION, settlementTokenMode: mode }
}

function safeDefaultResult() {
  return {
    passed: true,
    broadcastPerformed: false,
    broadcastEligible: false,
    network: 'robinhood-testnet',
    chainId: CHAIN_ID,
    region: REGION,
    message: 'No transaction sent. Testnet broadcast requires explicit staging guards.',
    requiredForBroadcast: [
      '--broadcast',
      'VELOSTRA_TESTNET_BROADCAST=' + BROADCAST_APPROVAL,
      'VELOSTRA_ENVIRONMENT=staging',
      'VELOSTRA_DEPLOY_REGION=' + REGION,
      'ROBINHOOD_CHAIN_ID=' + CHAIN_ID,
    ],
  }
}

async function deploy(factory, args, label) {
  const contract = await factory.deploy(...args)
  const transaction = contract.deploymentTransaction()
  if (!transaction) throw new Error(label + ' deployment transaction was not created')
  const receipt = await transaction.wait()
  if (!receipt || receipt.status !== 1) {
    throw new Error(label + ' deployment was not confirmed successfully')
  }
  return {
    address: ethers.getAddress(await contract.getAddress()),
    transactionHash: transaction.hash,
    blockNumber: receipt.blockNumber,
  }
}

async function main() {
  if (!process.argv.includes('--broadcast')) {
    console.log(JSON.stringify(safeDefaultResult(), null, 2))
    return
  }

  const authorization = validateTestnetBroadcastAuthorization()
  const roles = validateRoleAddresses()
  const provider = new ethers.JsonRpcProvider(
    required('ROBINHOOD_TESTNET_RPC_URL'),
    CHAIN_ID
  )
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(CHAIN_ID)) {
    throw new Error(
      'RPC chain mismatch: expected ' + CHAIN_ID + ', received ' + network.chainId
    )
  }
  await assertAuthorityPrincipals(provider, roles)
  const wallet = new ethers.Wallet(required('TESTNET_DEPLOYER_PRIVATE_KEY'), provider)
  if ((await provider.getBalance(wallet.address)) === 0n) {
    throw new Error('Testnet deployer has no native gas balance')
  }
  const feeBps = Number(required('PLATFORM_FEE_BPS'))
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5_000) {
    throw new Error('PLATFORM_FEE_BPS must be an integer between 0 and 5000')
  }

  const escrowArtifact = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'build', 'VelostraEscrow.json'), 'utf8')
  )
  let tokenDeployment = null
  let tokenAddress
  if (authorization.settlementTokenMode === 'deploy-mock-usd') {
    const mockArtifact = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'build', 'MockUSD.json'), 'utf8')
    )
    tokenDeployment = await deploy(
      new ethers.ContractFactory(mockArtifact.abi, mockArtifact.bytecode, wallet),
      [],
      'MockUSD'
    )
    tokenAddress = tokenDeployment.address
  } else {
    tokenAddress = requiredAddress('SETTLEMENT_TOKEN')
  }

  const token = new ethers.Contract(
    tokenAddress,
    ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'],
    provider
  )
  const [tokenDecimals, tokenSymbol] = await Promise.all([
    token.decimals(),
    token.symbol(),
  ])
  if (tokenDecimals !== 6n) {
    throw new Error('Testnet settlement token must use exactly 6 decimals')
  }

  const escrowDeployment = await deploy(
    new ethers.ContractFactory(escrowArtifact.abi, escrowArtifact.bytecode, wallet),
    [
      tokenAddress,
      feeBps,
      roles.admin,
      roles.settler,
      roles.treasury,
      roles.pauseGuardian,
    ],
    'VelostraEscrow'
  )
  const deployment = {
    schemaVersion: 1,
    kind: 'velostra-robinhood-testnet-deployment',
    environment: 'staging',
    region: REGION,
    network: 'robinhood-testnet',
    chainId: CHAIN_ID,
    confirmedAt: new Date().toISOString(),
    deployer: wallet.address,
    settlementToken: {
      mode: authorization.settlementTokenMode,
      address: tokenAddress,
      symbol: tokenSymbol,
      decimals: Number(tokenDecimals),
      deployment: tokenDeployment,
    },
    escrow: {
      address: escrowDeployment.address,
      transactionHash: escrowDeployment.transactionHash,
      deploymentBlock: escrowDeployment.blockNumber,
      platformFeeBps: feeBps,
      roles,
      authorityPolicy: {
        safeVersion: '1.4.1',
        threshold: '2-of-3',
        ownerSetsDisjoint: true,
        settlerIsolated: true,
      },
    },
  }
  const outputPath = ensureArtifactsPath(
    process.env.TESTNET_DEPLOYMENT_OUTPUT?.trim() ||
      'artifacts/staging/robinhood-testnet-deployment.json'
  )
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2) + '\n')
  console.log(JSON.stringify({
    passed: true,
    broadcastPerformed: true,
    network: deployment.network,
    chainId: deployment.chainId,
    region: deployment.region,
    settlementToken: tokenAddress,
    contractAddress: escrowDeployment.address,
    transactionHash: escrowDeployment.transactionHash,
    deploymentBlock: escrowDeployment.blockNumber,
    deploymentRecord: path.relative(REPOSITORY_ROOT, outputPath),
    verificationRequired: true,
  }, null, 2))
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Testnet deployment failed:', error.message || error)
    process.exitCode = 1
  })
}

module.exports = {
  CHAIN_ID,
  REGION,
  ensureArtifactsPath,
  safeDefaultResult,
  validateRoleAddresses,
  validateTestnetBroadcastAuthorization,
}
