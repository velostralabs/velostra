import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const CHAIN_ID = 46630
const TARGET_BALANCE = parseEther('0.01')
const SOURCE_RESERVE = parseEther('0.001')
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifactsRoot = path.resolve(repositoryRoot, 'artifacts')
const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}
const key = (name) => {
  const value = required(name)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(name + ' is invalid')
  return value
}

if (
  required('VELOSTRA_SIGNER_FUNDING_APPROVAL') !== 'bounded-staging-signer-funding-approved' ||
  required('VELOSTRA_ENVIRONMENT') !== 'staging' ||
  required('ROBINHOOD_CHAIN_ID') !== String(CHAIN_ID) ||
  required('PHASE3_PAID_WRITES_MODE') !== 'disabled'
) throw new Error('Signer funding is locked to write-disabled chain-46630 staging')

const signerAddress = required('SETTLEMENT_SIGNER_ADDRESS')
if (!isAddress(signerAddress)) throw new Error('Settlement signer address is malformed')
const rpcUrl = required('ROBINHOOD_RPC_URL')
const network = defineChain({ id: CHAIN_ID, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } })
const transport = http(rpcUrl, { timeout: 10_000, retryCount: 2 })
const publicClient = createPublicClient({ chain: network, transport })
const sources = [
  privateKeyToAccount(key('TESTNET_DEPLOYER_PRIVATE_KEY')),
  privateKeyToAccount(key('EVIDENCE_WALLET_PRIVATE_KEY')),
]
if (sources.some((source) => source.address === getAddress(signerAddress))) {
  throw new Error('Signer funding sources must be distinct from the restricted signer')
}

function outputPath() {
  const resolved = path.resolve(repositoryRoot, 'artifacts/staging/evidence/signer-gas-readiness.json')
  const relative = path.relative(artifactsRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Signer evidence escaped artifacts')
  return resolved
}

async function atomicWrite(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = target + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temporary, target)
}

async function main() {
  if (await publicClient.getChainId() !== CHAIN_ID) throw new Error('Signer funding RPC chain mismatch')
  let signerBalance = await publicClient.getBalance({ address: getAddress(signerAddress) })
  let transactionCount = 0
  const usedSources = []
  for (const source of sources) {
    if (signerBalance >= TARGET_BALANCE) break
    const sourceBalance = await publicClient.getBalance({ address: source.address })
    const fees = await publicClient.estimateFeesPerGas({ type: 'eip1559' })
    const transferCost = 21_000n * fees.maxFeePerGas * 2n
    const available = sourceBalance > SOURCE_RESERVE + transferCost
      ? sourceBalance - SOURCE_RESERVE - transferCost
      : 0n
    const shortfall = TARGET_BALANCE - signerBalance
    const amount = available < shortfall ? available : shortfall
    if (amount <= 0n) continue
    const wallet = createWalletClient({ account: source, chain: network, transport })
    const hash = await wallet.sendTransaction({
      to: getAddress(signerAddress),
      value: amount,
      gas: 21_000n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
    if (receipt.status !== 'success') throw new Error('Signer gas funding reverted')
    transactionCount += 1
    usedSources.push(source.address)
    signerBalance = await publicClient.getBalance({ address: getAddress(signerAddress) })
  }
  const usedSourcesRetainedReserve = (await Promise.all(
    usedSources.map((address) => publicClient.getBalance({ address }))
  )).every((balance) => balance >= SOURCE_RESERVE)
  const passed = signerBalance >= TARGET_BALANCE && usedSourcesRetainedReserve
  await atomicWrite(outputPath(), {
    schemaVersion: 1,
    kind: 'velostra-staging-signer-gas-readiness',
    environment: 'staging',
    chainId: CHAIN_ID,
    capturedAt: new Date().toISOString(),
    paidWritesDisabled: true,
    boundedTargetApplied: true,
    transactionCount,
    signerGasReady: signerBalance >= TARGET_BALANCE,
    usedSourcesRetainedReserve,
    passed,
  })
  if (!passed) throw new Error('Encrypted testnet sources cannot reach the bounded signer gas target')
  console.info('STAGING_SIGNER_GAS_READINESS_PASSED')
}

main().catch(() => {
  console.error('STAGING_SIGNER_GAS_READINESS_FAILED')
  process.exitCode = 1
})
