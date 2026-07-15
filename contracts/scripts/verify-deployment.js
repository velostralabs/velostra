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

function deploymentTransactionChecks(transaction, manifest, expectedData) {
  return {
    deployment_transaction_present: Boolean(transaction),
    deployment_transaction_deployer:
      Boolean(transaction) && sameAddress(transaction.from, manifest.contract.deployer),
    deployment_transaction_creation: transaction?.to === null,
    deployment_transaction_chain: transaction?.chainId === BigInt(CHAIN_ID),
    deployment_transaction_zero_value: transaction?.value === 0n,
    deployment_transaction_init_code:
      typeof transaction?.data === 'string' &&
      transaction.data.toLowerCase() === expectedData.toLowerCase(),
  }
}

async function main() {
  const manifestPath = path.resolve(
    REPOSITORY_ROOT,
    required('PHASE3_RELEASE_MANIFEST')
  )
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const validator = path.join(
    REPOSITORY_ROOT,
    'scripts',
    'validate-phase3-release.mjs'
  )
  const validation = spawnSync(
    process.execPath,
    [validator, '--manifest=' + manifestPath, '--mode=deployed'],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    }
  )
  if (validation.status !== 0) {
    throw new Error(
      'Deployed release manifest validation failed: ' +
        (validation.stderr ||
          validation.stdout ||
          validation.error?.message ||
          'unknown error')
    )
  }

  const provider = new ethers.JsonRpcProvider(required('ROBINHOOD_RPC_URL'), CHAIN_ID)
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(CHAIN_ID)) {
    throw new Error('RPC chain mismatch')
  }

  const artifactPath = path.resolve(
    REPOSITORY_ROOT,
    manifest.repository.contractArtifact.path
  )
  const artifactBytes = fs.readFileSync(artifactPath)
  const artifact = JSON.parse(artifactBytes.toString('utf8'))
  const failures = []
  const checks = {}
  const check = (name, condition) => {
    checks[name] = Boolean(condition)
    if (!condition) failures.push(name)
  }

  check(
    'artifact_hash',
    sha256(artifactBytes) === manifest.repository.contractArtifact.sha256
  )
  const address = ethers.getAddress(manifest.contract.address)
  const code = await provider.getCode(address)
  check('runtime_code_present', code !== '0x')
  if (code !== '0x') {
    const expectedRuntime = maskImmutables(
      artifact.deployedBytecode,
      artifact.immutableReferences
    )
    const actualRuntime = maskImmutables(code, artifact.immutableReferences)
    check('runtime_code_length', expectedRuntime.length === actualRuntime.length)
    check(
      'runtime_code_hash',
      sha256(expectedRuntime) === sha256(actualRuntime)
    )
  }

  const escrow = new ethers.Contract(address, artifact.abi, provider)
  const expected = manifest.contract.constructor
  const roles = expected.roles
  const expectedDeployment = await new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode
  ).getDeployTransaction(
    expected.settlementToken,
    expected.platformFeeBps,
    roles.admin,
    roles.settler,
    roles.treasury,
    roles.pauseGuardian
  )
  if (typeof expectedDeployment.data !== 'string') {
    throw new Error('Expected deployment init code could not be constructed')
  }
  const [
    settlementToken,
    platformFeeBps,
    paused,
    solvent,
    successorEscrow,
    defaultAdmin,
    settlerRole,
    treasuryRole,
    pauserRole,
    feeManagerRole,
    deploymentTransaction,
    receipt,
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
    provider.getTransaction(manifest.contract.deploymentTxHash),
    provider.getTransactionReceipt(manifest.contract.deploymentTxHash),
  ])

  check(
    'settlement_token',
    sameAddress(settlementToken, expected.settlementToken)
  )
  check(
    'platform_fee_bps',
    Number(platformFeeBps) === expected.platformFeeBps
  )
  check('contract_unpaused', paused === false)
  check('contract_solvent', solvent === true)
  check('successor_unset', successorEscrow === ethers.ZeroAddress)
  check('default_admin', sameAddress(defaultAdmin, roles.admin))
  check('settler_role', settlerRole === true)
  check('treasury_role', treasuryRole === true)
  check('pauser_role', pauserRole === true)
  check('fee_manager_role', feeManagerRole === true)
  for (const [name, passed] of Object.entries(
    deploymentTransactionChecks(
      deploymentTransaction,
      manifest,
      expectedDeployment.data
    )
  )) {
    check(name, passed)
  }
  check('deployment_receipt_present', Boolean(receipt))
  if (receipt) {
    check(
      'deployment_receipt_success',
      receipt.status === 1 &&
        receipt.blockNumber === manifest.contract.deploymentBlock
    )
    check(
      'deployment_contract_address',
      Boolean(receipt.contractAddress) &&
        sameAddress(receipt.contractAddress, address)
    )
  }

  const output = {
    schemaVersion: 1,
    kind: 'velostra-phase3-deployment-verification',
    passed: failures.length === 0,
    verifiedAt: new Date().toISOString(),
    release: manifest.release,
    manifestSha256: manifest.integrity.manifestSha256,
    chainId: CHAIN_ID,
    contractAddress: address,
    deploymentBlock: manifest.contract.deploymentBlock,
    checks,
    failures,
  }
  const outputPath = process.env.PHASE3_VERIFICATION_OUTPUT?.trim()
  if (outputPath) {
    const resolved = path.resolve(REPOSITORY_ROOT, outputPath)
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, JSON.stringify(output, null, 2) + '\n')
  }
  console.log(JSON.stringify(output, null, 2))
  if (!output.passed) process.exitCode = 1
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Deployment verification failed:', error.message || error)
    process.exitCode = 1
  })
}

module.exports = { deploymentTransactionChecks }
