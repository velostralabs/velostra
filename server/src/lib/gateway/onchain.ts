import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  formatUnits,
  http,
  keccak256,
  isAddress,
  parseUnits,
  toBytes,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const velostraEscrowAbi = [
  {
    type: 'function',
    name: 'creditBuilderEarnings',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'builder', type: 'address' },
      { name: 'grossAmount', type: 'uint256' },
      { name: 'callId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Claimed',
    inputs: [
      { name: 'builder', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EarningsCredited',
    inputs: [
      { name: 'builder', type: 'address', indexed: true },
      { name: 'callId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'platformCut', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PlatformRevenueWithdrawn',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

export class OnchainVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OnchainVerificationError'
  }
}

export const settlementTokenDecimals = Number(process.env.SETTLEMENT_TOKEN_DECIMALS ?? 6)
export const velostraChainId = Number(process.env.ROBINHOOD_CHAIN_ID ?? 4663)
export const velostraRpcUrl =
  process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
export const velostraRpcTimeoutMs = Number(process.env.ROBINHOOD_RPC_TIMEOUT_MS ?? 10_000)

if (!Number.isInteger(settlementTokenDecimals) || settlementTokenDecimals < 0 || settlementTokenDecimals > 18) {
  throw new Error('SETTLEMENT_TOKEN_DECIMALS must be an integer between 0 and 18')
}
if (!Number.isInteger(velostraRpcTimeoutMs) || velostraRpcTimeoutMs <= 0) {
  throw new Error('ROBINHOOD_RPC_TIMEOUT_MS must be a positive integer')
}

const robinhoodChain = defineChain({
  id: velostraChainId,
  name: velostraChainId === 4663 ? 'Robinhood Chain' : `Velostra EVM (${velostraChainId})`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [velostraRpcUrl] } },
})

let publicClient: ReturnType<typeof createPublicClient> | undefined

export function getVelostraPublicClient() {
  publicClient ??= createPublicClient({
    chain: robinhoodChain,
    transport: http(velostraRpcUrl, { timeout: velostraRpcTimeoutMs }),
  })
  return publicClient
}

export function getVelostraEscrowAddress(): Address {
  const value = process.env.VELOSTRA_ESCROW_ADDRESS
  if (!value || !isAddress(value)) {
    throw new OnchainVerificationError('VELOSTRA_ESCROW_ADDRESS is not configured')
  }
  return getAddress(value)
}

export function tokenUnitsToMoney(amount: bigint): number {
  return Number(formatUnits(amount, settlementTokenDecimals))
}

export function hashAgentCallId(agentCallId: string): Hash {
  if (!agentCallId) throw new OnchainVerificationError('agent call id is required')
  return keccak256(toBytes(agentCallId))
}

export function moneyToTokenUnits(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new OnchainVerificationError('Amount must be a positive finite number')
  }
  return parseUnits(amount.toFixed(settlementTokenDecimals), settlementTokenDecimals)
}

async function verifyEscrowEvent({
  hash,
  sender,
  amount,
  eventName,
  addressArg,
}: {
  hash: Hash
  sender: Address
  amount: number
  eventName: 'Deposit' | 'Claimed'
  addressArg: 'user' | 'builder'
}): Promise<TransactionReceipt> {
  const escrowAddress = getVelostraEscrowAddress()
  let receipt: TransactionReceipt

  try {
    receipt = await getVelostraPublicClient().getTransactionReceipt({ hash })
  } catch {
    throw new OnchainVerificationError('Transaction receipt was not found')
  }

  if (receipt.status !== 'success') {
    throw new OnchainVerificationError('Transaction reverted onchain')
  }
  if (!receipt.to || getAddress(receipt.to) !== escrowAddress) {
    throw new OnchainVerificationError('Transaction was not sent to VelostraEscrow')
  }

  const expectedSender = getAddress(sender)
  if (getAddress(receipt.from) !== expectedSender) {
    throw new OnchainVerificationError('Transaction sender does not match the signed-in wallet')
  }

  const expectedAmount = moneyToTokenUnits(amount)
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== escrowAddress) continue

    try {
      const decoded = decodeEventLog({
        abi: velostraEscrowAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      })
      if (decoded.eventName !== eventName) continue

      const args = decoded.args as unknown as Record<string, unknown>
      const eventAddress = args[addressArg]
      const eventAmount = args.amount
      if (
        typeof eventAddress === 'string' &&
        getAddress(eventAddress) === expectedSender &&
        typeof eventAmount === 'bigint' &&
        eventAmount === expectedAmount
      ) {
        return receipt
      }
    } catch {
      // This log belongs to another event in the same receipt.
    }
  }

  throw new OnchainVerificationError(
    `${eventName} event does not match the authenticated wallet and requested amount`
  )
}

export function verifyDepositTransaction(
  hash: Hash,
  sender: Address,
  amount: number
): Promise<TransactionReceipt> {
  return verifyEscrowEvent({ hash, sender, amount, eventName: 'Deposit', addressArg: 'user' })
}

export function verifyClaimTransaction(
  hash: Hash,
  sender: Address,
  amount: number
): Promise<TransactionReceipt> {
  return verifyEscrowEvent({ hash, sender, amount, eventName: 'Claimed', addressArg: 'builder' })
}

async function submitBuilderCredit(
  builder: Address,
  grossAmount: number,
  callId: Hash
): Promise<Hash | null> {
  if (process.env.ONCHAIN_SETTLEMENT_MODE === 'disabled') return null

  const privateKey = process.env.BACKEND_SIGNER_PRIVATE_KEY
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('BACKEND_SIGNER_PRIVATE_KEY is required for paid calls')
  }

  const account = privateKeyToAccount(privateKey as Hash)
  const walletClient = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: http(velostraRpcUrl, { timeout: velostraRpcTimeoutMs }),
  })
  const hash = await walletClient.writeContract({
    address: getVelostraEscrowAddress(),
    abi: velostraEscrowAbi,
    functionName: 'creditBuilderEarnings',
    args: [getAddress(builder), moneyToTokenUnits(grossAmount), callId],
  })
  const receipt = await getVelostraPublicClient().waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error('creditBuilderEarnings reverted onchain')
  return hash
}

let settlementQueue: Promise<void> = Promise.resolve()

export function creditBuilderEarningsOnchain(
  builder: Address,
  grossAmount: number,
  callId: Hash
): Promise<Hash | null> {
  const job = settlementQueue.then(() => submitBuilderCredit(builder, grossAmount, callId))
  settlementQueue = job.then(
    () => undefined,
    () => undefined
  )
  return job
}
