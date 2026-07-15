import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  defineChain,
  getAddress,
  keccak256,
  isAddress,
  parseUnits,
  toBytes,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  addMoney,
  compareMoney,
  money,
  moneyFromMinor,
  moneyToMinor,
  type Money,
  type MoneyInput,
} from '../money.js'
import { settlementSignerMode, submitRemoteSettlement } from './signer.js'
import { createResilientRpcTransport, parseRpcUrls } from '../rpc.js'

export const velostraEscrowAbi = [
  {
    type: 'function',
    name: 'isSolvent',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'settlementToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'platformFeeBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'successorEscrow',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'defaultAdmin',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'hasRole',
    stateMutability: 'view',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
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
export const velostraRpcUrls = parseRpcUrls(
  process.env.ROBINHOOD_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com',
  process.env.ROBINHOOD_RPC_FALLBACK_URLS
)
export const velostraRpcUrl = velostraRpcUrls[0]
export const velostraRpcTimeoutMs = Number(process.env.ROBINHOOD_RPC_TIMEOUT_MS ?? 10_000)

if (settlementTokenDecimals !== 6) {
  throw new Error('SETTLEMENT_TOKEN_DECIMALS must be exactly 6 for the Velostra money ledger')
}
if (!Number.isInteger(velostraRpcTimeoutMs) || velostraRpcTimeoutMs <= 0) {
  throw new Error('ROBINHOOD_RPC_TIMEOUT_MS must be a positive integer')
}

const robinhoodChain = defineChain({
  id: velostraChainId,
  name: velostraChainId === 4663 ? 'Robinhood Chain' : `Velostra EVM (${velostraChainId})`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: velostraRpcUrls } },
})

let publicClient: ReturnType<typeof createPublicClient> | undefined

export function getVelostraPublicClient() {
  publicClient ??= createPublicClient({
    chain: robinhoodChain,
    transport: createResilientRpcTransport(velostraRpcUrls, velostraRpcTimeoutMs),
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

export function tokenUnitsToMoney(amount: bigint): Money {
  return moneyFromMinor(amount)
}

export function hashAgentCallId(agentCallId: string): Hash {
  if (!agentCallId) throw new OnchainVerificationError('agent call id is required')
  return keccak256(toBytes(agentCallId))
}

export function moneyToTokenUnits(amount: MoneyInput): bigint {
  const minor = moneyToMinor(amount)
  if (minor <= 0n) {
    throw new OnchainVerificationError('Amount must be positive')
  }
  return parseUnits(money(amount), settlementTokenDecimals)
}

export interface VerifiedBuilderCredit {
  builderAmount: Money
  platformAmount: Money
}

export function verifyBuilderCreditReceipt(
  receipt: TransactionReceipt,
  builder: Address,
  callId: Hash,
  grossAmount: MoneyInput
): VerifiedBuilderCredit {
  const escrowAddress = getVelostraEscrowAddress()
  if (receipt.status !== 'success') throw new OnchainSettlementRevertedError()
  if (!receipt.to || getAddress(receipt.to) !== escrowAddress) {
    throw new OnchainVerificationError('Settlement transaction was not sent to VelostraEscrow')
  }

  const expectedBuilder = getAddress(builder)
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== escrowAddress) continue

    let decoded: ReturnType<typeof decodeEventLog>
    try {
      decoded = decodeEventLog({
        abi: velostraEscrowAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      })
    } catch {
      continue
    }
    if (decoded.eventName !== 'EarningsCredited') continue

    const args = decoded.args as unknown as Record<string, unknown>
    if (
      typeof args.builder !== 'string' ||
      getAddress(args.builder) !== expectedBuilder ||
      typeof args.callId !== 'string' ||
      args.callId.toLowerCase() !== callId.toLowerCase() ||
      typeof args.amount !== 'bigint' ||
      typeof args.platformCut !== 'bigint'
    ) {
      continue
    }

    const builderAmount = tokenUnitsToMoney(args.amount)
    const platformAmount = tokenUnitsToMoney(args.platformCut)
    if (compareMoney(addMoney(builderAmount, platformAmount), grossAmount) !== 0) {
      throw new OnchainVerificationError(
        'EarningsCredited split does not equal the durable gross amount'
      )
    }
    return { builderAmount, platformAmount }
  }

  throw new OnchainVerificationError(
    'EarningsCredited event does not match the expected builder and callId'
  )
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
  amount: MoneyInput
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
  amount: MoneyInput
): Promise<TransactionReceipt> {
  return verifyEscrowEvent({ hash, sender, amount, eventName: 'Deposit', addressArg: 'user' })
}

export function verifyClaimTransaction(
  hash: Hash,
  sender: Address,
  amount: MoneyInput
): Promise<TransactionReceipt> {
  return verifyEscrowEvent({ hash, sender, amount, eventName: 'Claimed', addressArg: 'builder' })
}

export class OnchainSettlementRevertedError extends Error {
  constructor(message = 'creditBuilderEarnings reverted onchain') {
    super(message)
    this.name = 'OnchainSettlementRevertedError'
  }
}

async function submitBuilderCredit(
  builder: Address,
  grossAmount: MoneyInput,
  callId: Hash
): Promise<Hash> {
  if (process.env.ONCHAIN_SETTLEMENT_MODE === 'disabled') {
    throw new Error('Onchain settlement is disabled')
  }

  const address = getVelostraEscrowAddress()
  const args = [getAddress(builder), moneyToTokenUnits(grossAmount), callId] as const
  if (settlementSignerMode() === 'remote') {
    const data = encodeFunctionData({
      abi: velostraEscrowAbi,
      functionName: 'creditBuilderEarnings',
      args,
    })
    return submitRemoteSettlement({
      chainId: velostraChainId,
      to: address,
      data,
      idempotencyKey: callId,
    })
  }

  const privateKey = process.env.BACKEND_SIGNER_PRIVATE_KEY
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('BACKEND_SIGNER_PRIVATE_KEY is required for local paid calls')
  }

  const account = privateKeyToAccount(privateKey as Hash)
  const walletClient = createWalletClient({
    account,
    chain: robinhoodChain,
    transport: createResilientRpcTransport(velostraRpcUrls, velostraRpcTimeoutMs),
  })
  return walletClient.writeContract({
    address,
    abi: velostraEscrowAbi,
    functionName: 'creditBuilderEarnings',
    args,
  })
}

let settlementBroadcastQueue: Promise<void> = Promise.resolve()

// Serialize only signer nonce allocation/broadcast. Receipt polling happens
// outside the queue so one slow block cannot stall unrelated submissions.
export function broadcastBuilderCredit(
  builder: Address,
  grossAmount: MoneyInput,
  callId: Hash
): Promise<Hash> {
  const job = settlementBroadcastQueue.then(() =>
    submitBuilderCredit(builder, grossAmount, callId)
  )
  settlementBroadcastQueue = job.then(
    () => undefined,
    () => undefined
  )
  return job
}

export async function waitForBuilderCredit(hash: Hash): Promise<TransactionReceipt> {
  const receipt = await getVelostraPublicClient().waitForTransactionReceipt({
    hash,
    confirmations: 1,
  })
  if (receipt.status !== 'success') throw new OnchainSettlementRevertedError()
  return receipt
}

// Compatibility helper for callers that do not need durable hash persistence.
export async function creditBuilderEarningsOnchain(
  builder: Address,
  grossAmount: MoneyInput,
  callId: Hash
): Promise<Hash> {
  const hash = await broadcastBuilderCredit(builder, grossAmount, callId)
  await waitForBuilderCredit(hash)
  return hash
}