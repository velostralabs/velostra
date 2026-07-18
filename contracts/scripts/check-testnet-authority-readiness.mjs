import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Safe from '@safe-global/protocol-kit'
import { ethers } from 'ethers'
import authorityPolicy from './lib/testnet-authority-policy.js'

const { AUTHORITY_NAMES, SAFE_VERSION, inspectSafe, validateAuthorityPlan } =
  authorityPolicy
const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.join(SCRIPT_ROOT, '..', '..')
const ARTIFACTS_ROOT = path.join(REPOSITORY_ROOT, 'artifacts')
const CHAIN_ID = 46630
const REGION = 'us-east4'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function requiredAddress(name) {
  const value = required(name)
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(name + ' must be a non-zero EVM address')
  }
  return ethers.getAddress(value)
}

function artifactsPath(candidate, label) {
  const resolved = path.resolve(REPOSITORY_ROOT, candidate)
  const relative = path.relative(ARTIFACTS_ROOT, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(label + ' must stay inside artifacts/')
  }
  return resolved
}

async function predictAuthority({ rpcUrl, provider, descriptor, label }) {
  const protocolKit = await Safe.init({
    provider: rpcUrl,
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
  const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction()
  const factoryAddress = ethers.getAddress(deploymentTransaction.to)
  const [safeCode, factoryCode] = await Promise.all([
    provider.getCode(address),
    provider.getCode(factoryAddress),
  ])
  let deployed = false
  if (safeCode !== '0x') {
    await inspectSafe(provider, address, label + ' Safe', descriptor.owners)
    deployed = true
  }
  return {
    address,
    deployed,
    factoryAddress,
    factoryReady: factoryCode !== '0x',
    threshold: descriptor.threshold,
    safeVersion: SAFE_VERSION,
  }
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
  const rpcUrl = required('ROBINHOOD_TESTNET_RPC_URL')
  const planPath = artifactsPath(required('TESTNET_AUTHORITY_PLAN'), 'TESTNET_AUTHORITY_PLAN')
  const outputPath = artifactsPath(
    process.env.TESTNET_AUTHORITY_READINESS_OUTPUT?.trim() ||
      'artifacts/staging/authority/testnet-authority-readiness.json',
    'TESTNET_AUTHORITY_READINESS_OUTPUT'
  )
  const deployer = requiredAddress('TESTNET_DEPLOYER_ADDRESS')
  const settler = requiredAddress('SETTLER_ADDRESS')
  if (deployer === settler) throw new Error('Deployer and settler must be distinct')
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  const roles = validateAuthorityPlan(plan)
  const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID)
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(CHAIN_ID)) throw new Error('RPC chain mismatch')

  const predictions = {}
  for (const name of AUTHORITY_NAMES) {
    predictions[name] = await predictAuthority({
      rpcUrl,
      provider,
      descriptor: roles[name],
      label: name,
    })
  }
  const authorityAddresses = AUTHORITY_NAMES.map((name) =>
    predictions[name].address.toLowerCase()
  )
  if (new Set(authorityAddresses).size !== authorityAddresses.length) {
    throw new Error('Predicted authority Safe addresses must be distinct')
  }
  if (
    authorityAddresses.includes(settler.toLowerCase()) ||
    authorityAddresses.includes(deployer.toLowerCase())
  ) {
    throw new Error('Deployer and settler must not overlap authority Safes')
  }
  const [deployerBalance, deployerCode, settlerCode] = await Promise.all([
    provider.getBalance(deployer),
    provider.getCode(deployer),
    provider.getCode(settler),
  ])
  if (deployerCode !== '0x') throw new Error('Testnet deployer must be an EOA')
  if (settlerCode !== '0x') throw new Error('Settlement signer must be an EOA')

  const factoryReady = AUTHORITY_NAMES.every(
    (name) => predictions[name].factoryReady
  )
  const deployedCount = AUTHORITY_NAMES.filter(
    (name) => predictions[name].deployed
  ).length
  const deployerFunded = deployerBalance > 0n
  const record = {
    schemaVersion: 1,
    kind: 'velostra-testnet-safe-authority-readiness',
    environment: 'staging',
    region: REGION,
    network: 'robinhood-testnet',
    chainId: CHAIN_ID,
    checkedAt: new Date().toISOString(),
    safeVersion: SAFE_VERSION,
    authorityPolicy: 'three-disjoint-2-of-3',
    factoryReady,
    deployerFunded,
    broadcastEligible: factoryReady && deployerFunded,
    deployedCount,
    predictions,
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(record, null, 2) + '\n')
  console.log(
    JSON.stringify(
      {
        passed: factoryReady,
        chainId: CHAIN_ID,
        region: REGION,
        authorityCount: AUTHORITY_NAMES.length,
        safeVersion: SAFE_VERSION,
        allFactoriesReady: factoryReady,
        deployedCount,
        deployerFunded,
        broadcastEligible: record.broadcastEligible,
        nextAction: deployerFunded ? 'authority-broadcast' : 'fund-testnet-deployer',
      },
      null,
      2
    )
  )
  if (!factoryReady) process.exitCode = 1
}

main().catch((error) => {
  console.error('Authority readiness failed:', error.message || error)
  process.exitCode = 1
})
