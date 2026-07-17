import { timingSafeEqual } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  createPublicClient,
  decodeFunctionData,
  defineChain,
  getAddress,
  http,
  isAddress,
  keccak256,
  recoverAddress,
  serializeTransaction,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
  type TransactionSerializableEIP1559,
} from 'viem'
import type { DigestSignature, DigestSigner } from './kms.js'
import type { SignerIntent, SignerIntentStore } from './store.js'

const HASH = /^0x[0-9a-fA-F]{64}$/
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SECP256K1_HALF_N = SECP256K1_N / 2n

const creditAbi = [
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
] as const

const requestSchema = z.object({
  chain_id: z.number().int().positive(),
  to: z.string().refine((value) => isAddress(value)),
  data: z.string().regex(HEX_DATA).max(16_384),
  value: z.literal('0x0'),
  idempotency_key: z.string().regex(HASH),
}).strict()

export interface RestrictedSignerConfig {
  environment: 'staging'
  region: 'us-east4'
  chainId: 46630
  rpcUrl: string
  escrowAddress: Address
  signerAddress: Address
  authToken: string
  intentTtlSeconds: number
  nonceLockMs: number
  lockWaitMs: number
  maxGas: bigint
  maxFeePerGasWei: bigint
}

export interface SignerRpc {
  getChainId(): Promise<number>
  getTransactionCount(parameters: {
    address: Address
    blockTag: 'pending'
  }): Promise<number>
  estimateGas(parameters: {
    account: Address
    to: Address
    data: Hex
    value: bigint
  }): Promise<bigint>
  estimateFeesPerGas(parameters: {
    type: 'eip1559'
  }): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>
  sendRawTransaction(parameters: { serializedTransaction: Hex }): Promise<Hash>
  getTransaction(parameters: { hash: Hash }): Promise<unknown>
}

export class RestrictedSignerError extends Error {
  readonly status: number
  readonly expose: boolean

  constructor(message: string, status = 500, expose = false) {
    super(message)
    this.name = 'RestrictedSignerError'
    this.status = status
    this.expose = expose
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required for the restricted signer')
  return value
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(name + ' must be a positive safe integer')
  }
  return value
}

function nonNegativeBigInt(name: string, fallback: string): bigint {
  const value = process.env[name] ?? fallback
  if (!/^[0-9]+$/.test(value)) throw new Error(name + ' must be a non-negative integer')
  return BigInt(value)
}

function httpsUrl(name: string): string {
  const value = new URL(required(name))
  if (value.protocol !== 'https:' || value.username || value.password) {
    throw new Error(name + ' must use HTTPS without embedded credentials')
  }
  return value.toString()
}

function address(name: string): Address {
  const value = required(name)
  if (!isAddress(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(name + ' must be a non-zero EVM address')
  }
  return getAddress(value)
}

export function loadRestrictedSignerConfig(): RestrictedSignerConfig {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Restricted signer requires NODE_ENV=production')
  }
  const environment = required('VELOSTRA_ENVIRONMENT')
  if (environment !== 'staging') {
    throw new Error('Restricted signer is authorized only for VELOSTRA_ENVIRONMENT=staging')
  }
  const region = required('VELOSTRA_REGION')
  if (region !== 'us-east4') {
    throw new Error('Restricted signer region must be us-east4')
  }
  const chainId = positiveInteger('ROBINHOOD_CHAIN_ID', 0)
  if (chainId !== 46630) {
    throw new Error('Restricted signer chain must be Robinhood testnet 46630')
  }
  const authToken = required('SETTLEMENT_SIGNER_AUTH_TOKEN')
  if (authToken.length < 32) {
    throw new Error('SETTLEMENT_SIGNER_AUTH_TOKEN must be at least 32 characters')
  }
  const maxGas = nonNegativeBigInt('SIGNER_MAX_GAS', '500000')
  const maxFeePerGasWei = nonNegativeBigInt(
    'SIGNER_MAX_FEE_PER_GAS_WEI',
    '10000000000'
  )
  if (maxGas <= 0n || maxFeePerGasWei <= 0n) {
    throw new Error('Signer gas and fee caps must be positive')
  }
  return {
    environment: 'staging',
    region: 'us-east4',
    chainId: 46630,
    rpcUrl: httpsUrl('ROBINHOOD_RPC_URL'),
    escrowAddress: address('VELOSTRA_ESCROW_ADDRESS'),
    signerAddress: address('SETTLEMENT_SIGNER_ADDRESS'),
    authToken,
    intentTtlSeconds: positiveInteger('SIGNER_INTENT_TTL_SECONDS', 2_592_000),
    nonceLockMs: positiveInteger('SIGNER_NONCE_LOCK_MS', 30_000),
    lockWaitMs: positiveInteger('SIGNER_LOCK_WAIT_MS', 5_000),
    maxGas,
    maxFeePerGasWei,
  }
}

export function createConfiguredSignerRpc(config: RestrictedSignerConfig): SignerRpc {
  const chain = defineChain({
    id: config.chainId,
    name: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  })
  return createPublicClient({ chain, transport: http(config.rpcUrl) }) as unknown as SignerRpc
}

function safeTokenEqual(received: string | undefined, expected: string): boolean {
  if (!received?.startsWith('Bearer ')) return false
  const actual = Buffer.from(received.slice(7))
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

function fingerprint(request: z.infer<typeof requestSchema>): Hash {
  return keccak256(
    stringToHex(
      JSON.stringify({
        chain_id: request.chain_id,
        to: getAddress(request.to),
        data: request.data.toLowerCase(),
        value: request.value,
        idempotency_key: request.idempotency_key.toLowerCase(),
      })
    )
  )
}

function validateCreditCalldata(request: z.infer<typeof requestSchema>): void {
  let decoded: ReturnType<typeof decodeFunctionData>
  try {
    decoded = decodeFunctionData({ abi: creditAbi, data: request.data as Hex })
  } catch {
    throw new RestrictedSignerError('Signer calldata is not an approved settlement call', 400, true)
  }
  if (decoded.functionName !== 'creditBuilderEarnings') {
    throw new RestrictedSignerError('Signer method is not allowed', 400, true)
  }
  const [builder, grossAmount, callId] = decoded.args as readonly [Address, bigint, Hash]
  if (
    !isAddress(builder) ||
    /^0x0{40}$/i.test(builder) ||
    grossAmount <= 0n ||
    callId.toLowerCase() !== request.idempotency_key.toLowerCase()
  ) {
    throw new RestrictedSignerError('Signer settlement correlation is invalid', 400, true)
  }
}

function assertDigestSignature(signature: DigestSignature): void {
  if (!HASH.test(signature.r) || !HASH.test(signature.s)) {
    throw new Error('KMS returned an invalid secp256k1 signature width')
  }
  const r = BigInt(signature.r)
  const s = BigInt(signature.s)
  if (r <= 0n || r >= SECP256K1_N || s <= 0n || s > SECP256K1_HALF_N) {
    throw new Error('KMS returned a non-canonical secp256k1 signature')
  }
}

async function signatureWithParity(
  digest: Hash,
  signature: DigestSignature,
  expectedAddress: Address
): Promise<DigestSignature & { yParity: 0 | 1 }> {
  assertDigestSignature(signature)
  for (const yParity of [0, 1] as const) {
    const recovered = await recoverAddress({
      hash: digest,
      signature: { ...signature, yParity },
    })
    if (getAddress(recovered) === expectedAddress) return { ...signature, yParity }
  }
  throw new Error('KMS signature does not recover to SETTLEMENT_SIGNER_ADDRESS')
}

function validateStoredIntent(intent: SignerIntent): void {
  if (
    !HASH.test(intent.fingerprint) ||
    !HASH.test(intent.transactionHash) ||
    !HEX_DATA.test(intent.rawTransaction) ||
    keccak256(intent.rawTransaction) !== intent.transactionHash ||
    !isAddress(intent.signerAddress) ||
    !/^[0-9]+$/.test(intent.nonce)
  ) {
    throw new Error('Stored signer intent failed integrity validation')
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export class RestrictedSettlementSigner {
  constructor(
    readonly config: RestrictedSignerConfig,
    readonly kms: DigestSigner,
    readonly store: SignerIntentStore,
    readonly rpc: SignerRpc
  ) {}

  private async checkedSignerAddress(): Promise<Address> {
    const value = getAddress(await this.kms.address())
    if (value !== this.config.signerAddress) {
      throw new Error('Cloud KMS address differs from SETTLEMENT_SIGNER_ADDRESS')
    }
    return value
  }

  private assertIntentMatches(intent: SignerIntent, expectedFingerprint: Hash): void {
    validateStoredIntent(intent)
    if (
      intent.fingerprint !== expectedFingerprint ||
      getAddress(intent.signerAddress) !== this.config.signerAddress
    ) {
      throw new RestrictedSignerError('Idempotency key is bound to another request', 409, true)
    }
  }

  private async broadcast(intent: SignerIntent): Promise<Hash> {
    try {
      const hash = await this.rpc.sendRawTransaction({
        serializedTransaction: intent.rawTransaction,
      })
      if (hash.toLowerCase() !== intent.transactionHash.toLowerCase()) {
        throw new Error('RPC returned a different transaction hash')
      }
      return intent.transactionHash
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error)
      if (message.includes('already known') || message.includes('known transaction')) {
        return intent.transactionHash
      }
      const transaction = await this.rpc
        .getTransaction({ hash: intent.transactionHash })
        .catch(() => undefined)
      if (transaction) return intent.transactionHash
      throw new RestrictedSignerError('RPC did not confirm acceptance of the signed intent', 502)
    }
  }

  private async createIntent(
    request: z.infer<typeof requestSchema>,
    requestFingerprint: Hash
  ): Promise<SignerIntent> {
    const chainId = await this.rpc.getChainId()
    if (chainId !== this.config.chainId) throw new Error('Signer RPC chain mismatch')
    const signerAddress = await this.checkedSignerAddress()
    const nonce = await this.rpc.getTransactionCount({
      address: signerAddress,
      blockTag: 'pending',
    })
    const [estimatedGas, fees] = await Promise.all([
      this.rpc.estimateGas({
        account: signerAddress,
        to: this.config.escrowAddress,
        data: request.data as Hex,
        value: 0n,
      }),
      this.rpc.estimateFeesPerGas({ type: 'eip1559' }),
    ])
    const gas = (estimatedGas * 120n + 99n) / 100n
    if (gas > this.config.maxGas) {
      throw new RestrictedSignerError('Settlement gas estimate exceeds signer policy', 422, true)
    }
    if (
      fees.maxFeePerGas <= 0n ||
      fees.maxPriorityFeePerGas < 0n ||
      fees.maxPriorityFeePerGas > fees.maxFeePerGas ||
      fees.maxFeePerGas > this.config.maxFeePerGasWei
    ) {
      throw new RestrictedSignerError('Settlement fee estimate exceeds signer policy', 422, true)
    }
    const transaction: TransactionSerializableEIP1559 = {
      type: 'eip1559',
      chainId: this.config.chainId,
      nonce,
      to: this.config.escrowAddress,
      data: request.data as Hex,
      value: 0n,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    }
    const unsigned = serializeTransaction(transaction)
    const digest = keccak256(unsigned)
    const signature = await signatureWithParity(
      digest,
      await this.kms.signDigest(digest),
      signerAddress
    )
    const rawTransaction = serializeTransaction(transaction, signature)
    return {
      schemaVersion: 1,
      fingerprint: requestFingerprint,
      rawTransaction,
      transactionHash: keccak256(rawTransaction),
      signerAddress,
      nonce: String(nonce),
      createdAt: new Date().toISOString(),
    }
  }

  async submit(input: unknown, headerIdempotencyKey?: string): Promise<{
    tx_hash: Hash
    signer_address: Address
  }> {
    const parsed = requestSchema.safeParse(input)
    if (!parsed.success) {
      throw new RestrictedSignerError('Signer request body is invalid', 400, true)
    }
    const request = parsed.data
    if (
      headerIdempotencyKey?.toLowerCase() !== request.idempotency_key.toLowerCase()
    ) {
      throw new RestrictedSignerError('Idempotency header and body differ', 400, true)
    }
    if (
      request.chain_id !== this.config.chainId ||
      getAddress(request.to) !== this.config.escrowAddress
    ) {
      throw new RestrictedSignerError('Signer destination policy rejected the request', 400, true)
    }
    validateCreditCalldata(request)
    const idempotencyKey = request.idempotency_key as Hash
    const requestFingerprint = fingerprint(request)
    const existing = await this.store.get(idempotencyKey)
    if (existing) {
      this.assertIntentMatches(existing, requestFingerprint)
      return {
        tx_hash: await this.broadcast(existing),
        signer_address: this.config.signerAddress,
      }
    }

    const lockToken = await this.store.acquireNonceLock(this.config.nonceLockMs)
    if (!lockToken) {
      const deadline = Date.now() + this.config.lockWaitMs
      while (Date.now() < deadline) {
        const concurrent = await this.store.get(idempotencyKey)
        if (concurrent) {
          this.assertIntentMatches(concurrent, requestFingerprint)
          return {
            tx_hash: await this.broadcast(concurrent),
            signer_address: this.config.signerAddress,
          }
        }
        await wait(50)
      }
      throw new RestrictedSignerError('Signer nonce lane is busy', 409, true)
    }

    try {
      const raced = await this.store.get(idempotencyKey)
      if (raced) {
        this.assertIntentMatches(raced, requestFingerprint)
        return {
          tx_hash: await this.broadcast(raced),
          signer_address: this.config.signerAddress,
        }
      }
      const intent = await this.createIntent(request, requestFingerprint)
      const inserted = await this.store.putIfAbsent(
        idempotencyKey,
        intent,
        this.config.intentTtlSeconds
      )
      if (!inserted) {
        const concurrent = await this.store.get(idempotencyKey)
        if (!concurrent) throw new Error('Signer intent insert raced without a durable record')
        this.assertIntentMatches(concurrent, requestFingerprint)
        return {
          tx_hash: await this.broadcast(concurrent),
          signer_address: this.config.signerAddress,
        }
      }
      return {
        tx_hash: await this.broadcast(intent),
        signer_address: this.config.signerAddress,
      }
    } finally {
      await this.store.releaseNonceLock(lockToken)
    }
  }

  async health(): Promise<void> {
    const [chainId] = await Promise.all([
      this.rpc.getChainId(),
      this.store.ping(),
      this.checkedSignerAddress(),
    ])
    if (chainId !== this.config.chainId) throw new Error('Signer RPC chain mismatch')
  }
}

export function createRestrictedSignerApp(service: RestrictedSettlementSigner) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '16kb', type: 'application/json' }))

  app.get('/health', async (_request, response, next) => {
    try {
      await service.health()
      response.status(200).json({
        ok: true,
        environment: service.config.environment,
        region: service.config.region,
        chain_id: service.config.chainId,
        signer_address: service.config.signerAddress,
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/v1/transactions', async (request, response, next) => {
    try {
      if (!safeTokenEqual(request.get('authorization'), service.config.authToken)) {
        throw new RestrictedSignerError('Unauthorized', 401, true)
      }
      const result = await service.submit(
        request.body,
        request.get('idempotency-key') ?? undefined
      )
      response.status(200).json(result)
    } catch (error) {
      next(error)
    }
  })

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction
    ) => {
      const status =
        error instanceof RestrictedSignerError ? error.status : 500
      const message =
        error instanceof RestrictedSignerError && error.expose
          ? error.message
          : 'Restricted signer request failed'
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'restricted_signer_error',
          status,
          message: error instanceof Error ? error.message : String(error),
        })
      )
      response.status(status).json({ error: message })
    }
  )

  return app
}