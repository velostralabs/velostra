/**
 * Guarded VelostraEscrow deployment.
 *
 * The command is inert unless --broadcast and every Phase 3 authorization guard
 * are present. Use the root release:plan command for the default offline plan.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { ethers } = require('ethers')
require('dotenv').config()

const ROOT = path.join(__dirname, '..')
const REPOSITORY_ROOT = path.join(ROOT, '..')
const CHAIN_ID = 4663

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function requiredAddress(name) {
  const value = required(name)
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(name + ' must be an explicit non-zero EVM address')
  }
  return ethers.getAddress(value)
}

function sameAddress(actual, expected, label) {
  if (ethers.getAddress(actual) !== ethers.getAddress(expected)) {
    throw new Error(label + ' differs from the approved release manifest')
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function safeDefaultResult() {
  return {
    passed: true,
    broadcastPerformed: false,
    broadcastEligible: false,
    message: 'No transaction sent. Run npm run release:plan for the offline deployment plan.',
    requiredForBroadcast: [
      '--broadcast',
      'PHASE3_MAINNET_BROADCAST=explicitly-approved',
      'broadcast-approved immutable manifest',
      'matching manifest SHA-256 and approval ticket',
    ],
  }
}

function assertBroadcastOptIn(environment = process.env) {
  if (environment.PHASE3_MAINNET_BROADCAST !== 'explicitly-approved') {
    throw new Error('PHASE3_MAINNET_BROADCAST must be explicitly-approved')
  }
}

function validateBroadcastAuthorization() {
  assertBroadcastOptIn()
  const manifestPath = path.resolve(REPOSITORY_ROOT, required('PHASE3_RELEASE_MANIFEST'))
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (
    manifest.integrity?.manifestSha256 !==
    required('PHASE3_RELEASE_MANIFEST_SHA256')
  ) {
    throw new Error('PHASE3_RELEASE_MANIFEST_SHA256 differs from the manifest')
  }
  if (manifest.stage !== 'broadcast-approved') {
    throw new Error('Release manifest must be broadcast-approved')
  }
  if (manifest.authorization?.mainnetApproved !== true) {
    throw new Error('Release manifest does not authorize mainnet')
  }
  if (
    manifest.authorization.changeTicket !==
    required('PHASE3_RELEASE_APPROVAL_TICKET')
  ) {
    throw new Error('PHASE3_RELEASE_APPROVAL_TICKET differs from the manifest')
  }
  if (manifest.release !== required('VELOSTRA_RELEASE')) {
    throw new Error('VELOSTRA_RELEASE differs from the approved manifest')
  }

  const validator = path.join(
    REPOSITORY_ROOT,
    'scripts',
    'validate-phase3-release.mjs'
  )
  const result = spawnSync(
    process.execPath,
    [validator, '--manifest=' + manifestPath, '--mode=broadcast'],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    }
  )
  if (result.status !== 0) {
    throw new Error(
      'Phase 3 broadcast validation failed: ' +
        (result.stderr || result.stdout || result.error?.message || 'unknown error')
    )
  }
  return { manifest, manifestPath }
}

async function main() {
  if (!process.argv.includes('--broadcast')) {
    console.log(JSON.stringify(safeDefaultResult(), null, 2))
    return
  }

  const { manifest } = validateBroadcastAuthorization()
  const deployerPrivateKey = required('DEPLOYER_PRIVATE_KEY')
  const rpcUrl = required('ROBINHOOD_RPC_URL')
  const tokenAddress = requiredAddress('SETTLEMENT_TOKEN')
  const adminAddress = requiredAddress('ADMIN_ADDRESS')
  const settlerAddress = requiredAddress('SETTLER_ADDRESS')
  const treasuryAddress = requiredAddress('TREASURY_ADDRESS')
  const pauseGuardianAddress = requiredAddress('PAUSE_GUARDIAN_ADDRESS')
  const feeBps = Number(required('PLATFORM_FEE_BPS'))
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5_000) {
    throw new Error('PLATFORM_FEE_BPS must be an integer between 0 and 5000')
  }

  const expected = manifest.contract.constructor
  sameAddress(tokenAddress, expected.settlementToken, 'SETTLEMENT_TOKEN')
  sameAddress(adminAddress, expected.roles.admin, 'ADMIN_ADDRESS')
  sameAddress(settlerAddress, expected.roles.settler, 'SETTLER_ADDRESS')
  sameAddress(treasuryAddress, expected.roles.treasury, 'TREASURY_ADDRESS')
  sameAddress(
    pauseGuardianAddress,
    expected.roles.pauseGuardian,
    'PAUSE_GUARDIAN_ADDRESS'
  )
  if (feeBps !== expected.platformFeeBps) {
    throw new Error('PLATFORM_FEE_BPS differs from the approved release manifest')
  }

  const artifactPath = path.resolve(
    REPOSITORY_ROOT,
    manifest.repository.contractArtifact.path
  )
  const artifactBytes = fs.readFileSync(artifactPath)
  if (sha256(artifactBytes) !== manifest.repository.contractArtifact.sha256) {
    throw new Error('Contract artifact hash differs from the approved manifest')
  }
  const artifact = JSON.parse(artifactBytes.toString('utf8'))

  const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID)
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(CHAIN_ID)) {
    throw new Error(
      'RPC chain mismatch: expected ' + CHAIN_ID + ', received ' + network.chainId
    )
  }

  const wallet = new ethers.Wallet(deployerPrivateKey, provider)
  sameAddress(wallet.address, manifest.contract.deployer, 'DEPLOYER_PRIVATE_KEY')
  if ((await provider.getCode(adminAddress)) === '0x') {
    throw new Error('ADMIN_ADDRESS must be a deployed multisig contract')
  }

  const token = new ethers.Contract(
    tokenAddress,
    [
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
    ],
    provider
  )
  const [tokenDecimals, tokenSymbol] = await Promise.all([
    token.decimals(),
    token.symbol(),
  ])
  if (tokenDecimals !== 6n) {
    throw new Error(
      'Settlement token must use 6 decimals; ' +
        tokenSymbol +
        ' reports ' +
        tokenDecimals
    )
  }

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  )
  const escrow = await factory.deploy(
    tokenAddress,
    feeBps,
    adminAddress,
    settlerAddress,
    treasuryAddress,
    pauseGuardianAddress
  )
  const transaction = escrow.deploymentTransaction()
  if (!transaction) throw new Error('Deployment transaction was not created')
  const receipt = await transaction.wait()
  if (!receipt || receipt.status !== 1) {
    throw new Error('Deployment transaction was not confirmed successfully')
  }
  const address = await escrow.getAddress()
  const deployment = {
    kind: 'velostra-phase3-deployment-record',
    release: manifest.release,
    sourceManifestSha256: manifest.integrity.manifestSha256,
    address,
    chainId: CHAIN_ID,
    deploymentBlock: receipt.blockNumber,
    transactionHash: transaction.hash,
    confirmedAt: new Date().toISOString(),
    settlementToken: tokenAddress,
    settlementTokenDecimals: Number(tokenDecimals),
    platformFeeBps: feeBps,
    roles: {
      admin: adminAddress,
      settler: settlerAddress,
      treasury: treasuryAddress,
      pauseGuardian: pauseGuardianAddress,
    },
  }
  fs.writeFileSync(
    path.join(ROOT, 'deployment.json'),
    JSON.stringify(deployment, null, 2) + '\n'
  )
  console.log(
    JSON.stringify(
      {
        passed: true,
        broadcastPerformed: true,
        address,
        transactionHash: transaction.hash,
        deploymentBlock: receipt.blockNumber,
        sourceManifestSha256: manifest.integrity.manifestSha256,
        verificationRequired: true,
      },
      null,
      2
    )
  )
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Deployment failed:', error.message || error)
    process.exitCode = 1
  })
}

module.exports = {
  assertBroadcastOptIn,
  safeDefaultResult,
}