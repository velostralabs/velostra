const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { ethers } = require('ethers')
require('dotenv').config()

const ROOT = path.join(__dirname, '..')
const REPOSITORY_ROOT = path.join(ROOT, '..')
const ARTIFACTS_ROOT = path.join(REPOSITORY_ROOT, 'artifacts')
const CHAIN_ID = 46630
const REGION = 'us-east4'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function artifactsPath(candidate, label) {
  const resolved = path.resolve(REPOSITORY_ROOT, candidate)
  const relative = path.relative(ARTIFACTS_ROOT, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(label + ' must stay inside artifacts/')
  }
  return resolved
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function maskImmutables(bytecode, immutableReferences) {
  const bytes = Buffer.from(bytecode.slice(2), 'hex')
  for (const references of Object.values(immutableReferences ?? {})) {
    for (const reference of references) {
      bytes.fill(0, reference.start, reference.start + reference.length)
    }
  }
  return bytes
}

function sameAddress(actual, expected) {
  return ethers.getAddress(actual) === ethers.getAddress(expected)
}

async function main() {
  if (process.env.VELOSTRA_ENVIRONMENT !== 'staging') {
    throw new Error('VELOSTRA_ENVIRONMENT must be staging')
  }
  if (process.env.VELOSTRA_DEPLOY_REGION !== REGION) {
    throw new Error('VELOSTRA_DEPLOY_REGION must be ' + REGION)
  }
  if (process.env.ROBINHOOD_CHAIN_ID !== String(CHAIN_ID)) {
    throw new Error('ROBINHOOD_CHAIN_ID must be ' + CHAIN_ID)
  }
  const deploymentPath = artifactsPath(
    required('TESTNET_DEPLOYMENT_RECORD'),
    'TESTNET_DEPLOYMENT_RECORD'
  )
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'))
  if (
    deployment.kind !== 'velostra-robinhood-testnet-deployment' ||
    deployment.environment !== 'staging' ||
    deployment.region !== REGION ||
    deployment.network !== 'robinhood-testnet' ||
    deployment.chainId !== CHAIN_ID
  ) {
    throw new Error('Deployment record is not an authorized US testnet record')
  }

  const provider = new ethers.JsonRpcProvider(
    required('ROBINHOOD_TESTNET_RPC_URL'),
    CHAIN_ID
  )
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(CHAIN_ID)) throw new Error('RPC chain mismatch')

  const artifact = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'build', 'VelostraEscrow.json'), 'utf8')
  )
  const failures = []
  const checks = {}
  const check = (name, condition) => {
    checks[name] = Boolean(condition)
    if (!condition) failures.push(name)
  }

  const escrowAddress = ethers.getAddress(deployment.escrow.address)
  const tokenAddress = ethers.getAddress(deployment.settlementToken.address)
  const [runtimeCode, tokenCode, receipt] = await Promise.all([
    provider.getCode(escrowAddress),
    provider.getCode(tokenAddress),
    provider.getTransactionReceipt(deployment.escrow.transactionHash),
  ])
  check('runtime_code_present', runtimeCode !== '0x')
  check('settlement_token_code_present', tokenCode !== '0x')
  if (runtimeCode !== '0x') {
    const expectedRuntime = maskImmutables(
      artifact.deployedBytecode,
      artifact.immutableReferences
    )
    const actualRuntime = maskImmutables(runtimeCode, artifact.immutableReferences)
    check('runtime_code_length', expectedRuntime.length === actualRuntime.length)
    check('runtime_code_hash', sha256(expectedRuntime) === sha256(actualRuntime))
  }

  const escrow = new ethers.Contract(escrowAddress, artifact.abi, provider)
  const token = new ethers.Contract(
    tokenAddress,
    ['function decimals() view returns (uint8)'],
    provider
  )
  const roles = deployment.escrow.roles
  const [
    onchainToken,
    feeBps,
    paused,
    solvent,
    successor,
    defaultAdmin,
    settlerRole,
    treasuryRole,
    pauserRole,
    feeManagerRole,
    tokenDecimals,
  ] = await Promise.all([
    escrow.settlementToken(),
    escrow.platformFeeBps(),
    escrow.paused(),
    escrow.isSolvent(),
    escrow.successorEscrow(),
    escrow.defaultAdmin(),
    escrow.hasRole(ethers.id('SETTLER_ROLE'), roles.settler),
    escrow.hasRole(ethers.id('TREASURY_ROLE'), roles.treasury),
    escrow.hasRole(ethers.id('PAUSER_ROLE'), roles.pauseGuardian),
    escrow.hasRole(ethers.id('FEE_MANAGER_ROLE'), roles.admin),
    token.decimals(),
  ])
  check('settlement_token', sameAddress(onchainToken, tokenAddress))
  check('settlement_token_decimals', tokenDecimals === 6n)
  check('platform_fee_bps', Number(feeBps) === deployment.escrow.platformFeeBps)
  check('contract_unpaused', paused === false)
  check('contract_solvent', solvent === true)
  check('successor_unset', successor === ethers.ZeroAddress)
  check('default_admin', sameAddress(defaultAdmin, roles.admin))
  check('settler_role', settlerRole === true)
  check('treasury_role', treasuryRole === true)
  check('pauser_role', pauserRole === true)
  check('fee_manager_role', feeManagerRole === true)
  check('deployment_receipt_present', Boolean(receipt))
  if (receipt) {
    check('deployment_receipt_success', receipt.status === 1)
    check(
      'deployment_block',
      receipt.blockNumber === deployment.escrow.deploymentBlock
    )
    check(
      'deployment_contract_address',
      Boolean(receipt.contractAddress) &&
        sameAddress(receipt.contractAddress, escrowAddress)
    )
  }

  const output = {
    schemaVersion: 1,
    kind: 'velostra-robinhood-testnet-deployment-verification',
    passed: failures.length === 0,
    verifiedAt: new Date().toISOString(),
    region: REGION,
    chainId: CHAIN_ID,
    contractAddress: escrowAddress,
    deploymentBlock: deployment.escrow.deploymentBlock,
    checks,
    failures,
  }
  const outputPath = process.env.TESTNET_VERIFICATION_OUTPUT?.trim()
  if (outputPath) {
    const resolved = artifactsPath(outputPath, 'TESTNET_VERIFICATION_OUTPUT')
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, JSON.stringify(output, null, 2) + '\n')
  }
  console.log(JSON.stringify(output, null, 2))
  if (!output.passed) process.exitCode = 1
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Testnet verification failed:', error.message || error)
    process.exitCode = 1
  })
}

module.exports = { artifactsPath, maskImmutables }
