import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Safe from '@safe-global/protocol-kit'
import { ethers } from 'ethers'
import authorityPolicy from './lib/testnet-authority-policy.js'

const { AUTHORITY_NAMES, SAFE_VERSION, inspectSafe, validateAuthorityPlan } =
  authorityPolicy
const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url))
const CONTRACTS_ROOT = path.join(SCRIPT_ROOT, '..')
const REPOSITORY_ROOT = path.join(CONTRACTS_ROOT, '..')
const ARTIFACTS_ROOT = path.join(REPOSITORY_ROOT, 'artifacts')
const CHAIN_ID = 46630
const REGION = 'us-east4'
const BROADCAST_APPROVAL = 'isolated-authority-staging-approved'

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

function validateBroadcast() {
  if (!process.argv.includes('--broadcast')) throw new Error('--broadcast is required')
  if (process.env.VELOSTRA_TESTNET_AUTHORITY_BROADCAST !== BROADCAST_APPROVAL) {
    throw new Error(
      'VELOSTRA_TESTNET_AUTHORITY_BROADCAST must be ' + BROADCAST_APPROVAL
    )
  }
  if (process.env.VELOSTRA_ENVIRONMENT !== 'staging') {
    throw new Error('VELOSTRA_ENVIRONMENT must be staging')
  }
  if (process.env.VELOSTRA_DEPLOY_REGION !== REGION) {
    throw new Error('VELOSTRA_DEPLOY_REGION must be ' + REGION)
  }
  if (process.env.ROBINHOOD_CHAIN_ID !== String(CHAIN_ID)) {
    throw new Error('ROBINHOOD_CHAIN_ID must be ' + CHAIN_ID)
  }
}

function safeDefaultResult() {
  return {
    passed: true,
    broadcastPerformed: false,
    chainId: CHAIN_ID,
    region: REGION,
    message: 'No transaction sent. Authority deployment requires explicit staging guards.',
  }
}

async function deploySafe({ rpcUrl, privateKey, wallet, descriptor, label }) {
  const protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: privateKey,
    predictedSafe: {
      safeAccountConfig: {
        owners: descriptor.owners,
        threshold: descriptor.threshold,
      },
      safeDeploymentConfig: {
        saltNonce: descriptor.saltNonce,
        safeVersion: SAFE_VERSION,
        deploymentType: 'canonical',
      },
    },
  })
  const address = ethers.getAddress(await protocolKit.getAddress())
  let transactionHash = null
  let deploymentBlock = null
  let created = false
  if ((await wallet.provider.getCode(address)) === '0x') {
    const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction()
    const transaction = await wallet.sendTransaction({
      to: deploymentTransaction.to,
      value: BigInt(deploymentTransaction.value),
      data: deploymentTransaction.data,
    })
    const receipt = await transaction.wait()
    if (!receipt || receipt.status !== 1) {
      throw new Error(label + ' Safe deployment was not confirmed successfully')
    }
    transactionHash = transaction.hash
    deploymentBlock = receipt.blockNumber
    created = true
  }
  const verified = await inspectSafe(
    wallet.provider,
    address,
    label + ' Safe',
    descriptor.owners
  )
  return {
    address,
    owners: verified.owners,
    threshold: verified.threshold,
    safeVersion: verified.version,
    saltNonce: descriptor.saltNonce,
    created,
    transactionHash,
    deploymentBlock,
  }
}

async function main() {
  if (!process.argv.includes('--broadcast')) {
    console.log(JSON.stringify(safeDefaultResult(), null, 2))
    return
  }
  validateBroadcast()
  const planPath = artifactsPath(required('TESTNET_AUTHORITY_PLAN'), 'TESTNET_AUTHORITY_PLAN')
  const outputPath = artifactsPath(
    process.env.TESTNET_AUTHORITY_OUTPUT?.trim() ||
      'artifacts/staging/authority/robinhood-testnet-authorities.json',
    'TESTNET_AUTHORITY_OUTPUT'
  )
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  const roles = validateAuthorityPlan(plan)
  const rpcUrl = required('ROBINHOOD_TESTNET_RPC_URL')
  const privateKey = required('TESTNET_DEPLOYER_PRIVATE_KEY')
  const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID)
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(CHAIN_ID)) throw new Error('RPC chain mismatch')
  const wallet = new ethers.Wallet(privateKey, provider)
  if ((await provider.getBalance(wallet.address)) === 0n) {
    throw new Error('Testnet deployer has no native gas balance')
  }

  const deployedRoles = {}
  for (const name of AUTHORITY_NAMES) {
    deployedRoles[name] = await deploySafe({
      rpcUrl,
      privateKey,
      wallet,
      descriptor: roles[name],
      label: name,
    })
  }
  const addresses = AUTHORITY_NAMES.map((name) =>
    deployedRoles[name].address.toLowerCase()
  )
  if (new Set(addresses).size !== addresses.length) {
    throw new Error('Predicted authority Safe addresses must be distinct')
  }

  const record = {
    schemaVersion: 1,
    kind: 'velostra-robinhood-testnet-safe-authorities',
    environment: 'staging',
    region: REGION,
    network: 'robinhood-testnet',
    chainId: CHAIN_ID,
    confirmedAt: new Date().toISOString(),
    deployer: wallet.address,
    roles: deployedRoles,
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(record, null, 2) + '\n')
  console.log(
    JSON.stringify(
      {
        passed: true,
        broadcastPerformed: true,
        authorityCount: AUTHORITY_NAMES.length,
        allThresholds: '2-of-3',
        deploymentRecord: path.relative(REPOSITORY_ROOT, outputPath),
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error('Testnet authority deployment failed:', error.message || error)
  process.exitCode = 1
})
