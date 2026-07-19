import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const APPROVAL = 'isolated-staging-builder-initialization-approved'
const CHAIN_ID = 46630
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifactsRoot = path.resolve(repositoryRoot, 'artifacts')

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function privateKey(name) {
  const value = required(name)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(name + ' is invalid')
  return value
}

function address(name) {
  const value = required(name)
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(name + ' is invalid')
  return getAddress(value)
}

function evidencePath() {
  const resolved = path.resolve(
    repositoryRoot,
    process.env.STAGING_BUILDER_EVIDENCE_OUTPUT ??
      'artifacts/staging/evidence/canary-builder-readiness.json'
  )
  const relative = path.relative(artifactsRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Builder evidence must stay under artifacts')
  }
  return resolved
}

async function atomicWrite(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = target + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temporary, target)
}

if (
  required('VELOSTRA_BUILDER_INITIALIZATION_APPROVAL') !== APPROVAL ||
  required('VELOSTRA_ENVIRONMENT') !== 'staging' ||
  required('ROBINHOOD_CHAIN_ID') !== String(CHAIN_ID) ||
  required('PHASE3_PAID_WRITES_MODE') !== 'disabled'
) {
  throw new Error('Builder initialization is locked to write-disabled chain-46630 staging')
}

const rpcUrl = required('ROBINHOOD_RPC_URL')
const escrowAddress = address('VELOSTRA_ESCROW_ADDRESS')
const account = privateKeyToAccount(privateKey('EVIDENCE_WALLET_PRIVATE_KEY'))
const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 })
const network = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const transport = http(rpcUrl, { timeout: 10_000, retryCount: 2 })
const publicClient = createPublicClient({ chain: network, transport })
const walletClient = createWalletClient({ account, chain: network, transport })
const builderAbi = [
  {
    type: 'function',
    name: 'builders',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'totalEarned', type: 'uint256' },
      { name: 'availableToClaim', type: 'uint256' },
      { name: 'totalClaimed', type: 'uint256' },
      { name: 'initialized', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'initializeBuilder',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
]

async function builderState() {
  return publicClient.readContract({
    address: escrowAddress,
    abi: builderAbi,
    functionName: 'builders',
    args: [account.address],
  })
}

async function main() {
  if (await publicClient.getChainId() !== CHAIN_ID) {
    throw new Error('Builder initialization RPC chain mismatch')
  }
  const result = await pool.query(
    `select b.wallet_address
       from agents a
       join builders b on b.id = a.builder_id
      where a.slug = 'phase2-synthetic-agent'
        and a.status = 'APPROVED'
        and b.status = 'ACTIVE'
      limit 1`
  )
  const configuredBuilder = result.rows[0]?.wallet_address
  if (!configuredBuilder || getAddress(configuredBuilder) !== account.address) {
    throw new Error('Evidence wallet does not own the approved synthetic builder')
  }

  let transactionSent = false
  let state = await builderState()
  if (state[3] !== true) {
    try {
      const simulation = await publicClient.simulateContract({
        account,
        address: escrowAddress,
        abi: builderAbi,
        functionName: 'initializeBuilder',
      })
      const hash = await walletClient.writeContract(simulation.request)
      transactionSent = true
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
      if (receipt.status !== 'success') throw new Error('Builder initialization reverted')
    } catch (error) {
      state = await builderState()
      if (state[3] !== true) throw error
    }
    state = await builderState()
  }

  const evidence = {
    schemaVersion: 1,
    kind: 'velostra-staging-builder-readiness',
    environment: 'staging',
    chainId: CHAIN_ID,
    capturedAt: new Date().toISOString(),
    paidWritesDisabled: true,
    syntheticBuilderMatched: true,
    transactionSent,
    builderInitialized: state[3] === true,
    passed: state[3] === true,
  }
  await atomicWrite(evidencePath(), evidence)
  if (!evidence.passed) throw new Error('Builder initialization was not observed onchain')
  console.info('STAGING_BUILDER_INITIALIZATION_PASSED')
}

main()
  .catch(() => {
    console.error('STAGING_BUILDER_INITIALIZATION_FAILED')
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
