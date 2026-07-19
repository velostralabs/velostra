import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const APPROVAL = 'isolated-staging-canary-funding-approved'
const CHAIN_ID = 46630
const TARGET_GAS = parseEther('0.003')
const TARGET_TOKEN = parseUnits('2', 6)
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
  return value
}

function outputPath() {
  const resolved = path.resolve(
    repositoryRoot,
    process.env.CANARY_WALLET_EVIDENCE_OUTPUT ??
      'artifacts/staging/evidence/canary-wallet-readiness.json'
  )
  const relative = path.relative(artifactsRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Canary wallet evidence must stay under artifacts')
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
  required('VELOSTRA_CANARY_FUNDING_APPROVAL') !== APPROVAL ||
  required('VELOSTRA_ENVIRONMENT') !== 'staging' ||
  required('ROBINHOOD_CHAIN_ID') !== String(CHAIN_ID) ||
  required('PHASE3_PAID_WRITES_MODE') !== 'disabled'
) {
  throw new Error('Canary wallet funding is locked to write-disabled chain-46630 staging')
}

const rpcUrl = required('ROBINHOOD_RPC_URL')
const tokenAddress = address('SETTLEMENT_TOKEN_ADDRESS')
const evidenceAccount = privateKeyToAccount(privateKey('EVIDENCE_WALLET_PRIVATE_KEY'))
const deployerAccount = privateKeyToAccount(privateKey('TESTNET_DEPLOYER_PRIVATE_KEY'))
const network = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const transport = http(rpcUrl, { timeout: 10_000, retryCount: 2 })
const publicClient = createPublicClient({ chain: network, transport })
const evidenceWallet = createWalletClient({ account: evidenceAccount, chain: network, transport })
const deployerWallet = createWalletClient({ account: deployerAccount, chain: network, transport })
const tokenAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
]

async function confirm(hash, label) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error(label + ' transaction reverted')
}

async function main() {
  if (await publicClient.getChainId() !== CHAIN_ID) throw new Error('Funding RPC chain mismatch')
  const decimals = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: 'decimals',
  })
  if (decimals !== 6) throw new Error('Settlement token decimals mismatch')

  let nativeBalance = await publicClient.getBalance({ address: evidenceAccount.address })
  if (nativeBalance < TARGET_GAS) {
    const requiredGas = TARGET_GAS - nativeBalance
    const deployerBalance = await publicClient.getBalance({ address: deployerAccount.address })
    if (deployerBalance <= requiredGas) {
      throw new Error('Testnet deployer does not have enough native gas for the canary wallet')
    }
    const hash = await deployerWallet.sendTransaction({
      to: evidenceAccount.address,
      value: requiredGas,
    })
    await confirm(hash, 'Native funding')
    nativeBalance = await publicClient.getBalance({ address: evidenceAccount.address })
  }

  let tokenBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: 'balanceOf',
    args: [evidenceAccount.address],
  })
  if (tokenBalance < TARGET_TOKEN) {
    const hash = await evidenceWallet.writeContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'mint',
      args: [evidenceAccount.address, TARGET_TOKEN - tokenBalance],
    })
    await confirm(hash, 'Synthetic token mint')
    tokenBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [evidenceAccount.address],
    })
  }

  const evidence = {
    schemaVersion: 1,
    kind: 'velostra-staging-canary-wallet-readiness',
    environment: 'staging',
    chainId: CHAIN_ID,
    capturedAt: new Date().toISOString(),
    nativeGasReady: nativeBalance >= TARGET_GAS,
    settlementTokenReady: tokenBalance >= TARGET_TOKEN,
    nativeGasFloor: formatEther(TARGET_GAS),
    settlementTokenFloor: formatUnits(TARGET_TOKEN, 6),
    passed: nativeBalance >= TARGET_GAS && tokenBalance >= TARGET_TOKEN,
  }
  await atomicWrite(outputPath(), evidence)
  if (!evidence.passed) throw new Error('Canary wallet funding did not reach readiness floors')
  console.info('CANARY_WALLET_READINESS_PASSED')
}

main().catch((error) => {
  console.error('CANARY_WALLET_READINESS_FAILED', {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Unknown error',
  })
  process.exitCode = 1
})
