import assert from 'node:assert/strict'
import { createECDH, createPublicKey } from 'node:crypto'
import type { Server } from 'node:http'
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  recoverTransactionAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { privateKeyToAccount, sign } from 'viem/accounts'
import {
  parseDerSignature,
  publicKeyPemToAddress,
  type DigestSigner,
} from '../src/signer/kms.js'
import {
  createRestrictedSignerApp,
  RestrictedSettlementSigner,
  type RestrictedSignerConfig,
  type SignerRpc,
} from '../src/signer/service.js'
import type {
  SignerIntent,
  SignerIntentStore,
} from '../src/signer/store.js'

const privateKey =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as Hex
const account = privateKeyToAccount(privateKey)
const escrowAddress = getAddress('0x1111111111111111111111111111111111111111')
const builderAddress = getAddress('0x2222222222222222222222222222222222222222')
const callId = ('0x' + 'ab'.repeat(32)) as Hash
const otherCallId = ('0x' + 'cd'.repeat(32)) as Hash
const authToken = 'restricted-signer-test-token-at-least-32-characters'

class LocalDigestSigner implements DigestSigner {
  async address(): Promise<Address> {
    return account.address
  }

  async signDigest(digest: Hex) {
    const signature = await sign({ hash: digest, privateKey })
    return { r: signature.r, s: signature.s }
  }
}

class MemoryStore implements SignerIntentStore {
  readonly intents = new Map<string, SignerIntent>()
  private lock?: string

  async get(idempotencyKey: Hash) {
    return this.intents.get(idempotencyKey.toLowerCase())
  }

  async putIfAbsent(idempotencyKey: Hash, intent: SignerIntent) {
    const key = idempotencyKey.toLowerCase()
    if (this.intents.has(key)) return false
    this.intents.set(key, intent)
    return true
  }

  async acquireNonceLock() {
    if (this.lock) return undefined
    this.lock = 'lock'
    return this.lock
  }

  async releaseNonceLock(token: string) {
    if (this.lock === token) this.lock = undefined
  }

  async ping() {}

  async close() {}
}

class MemoryRpc implements SignerRpc {
  readonly rawTransactions: Hex[] = []
  readonly known = new Map<Hash, { hash: Hash }>()

  async getChainId() {
    return 46630
  }

  async getTransactionCount() {
    return 7
  }

  async estimateGas() {
    return 100_000n
  }

  async estimateFeesPerGas() {
    return { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 0n }
  }

  async sendRawTransaction({ serializedTransaction }: { serializedTransaction: Hex }) {
    this.rawTransactions.push(serializedTransaction)
    const hash = keccak256(serializedTransaction)
    this.known.set(hash, { hash })
    return hash
  }

  async getTransaction({ hash }: { hash: Hash }) {
    const transaction = this.known.get(hash)
    if (!transaction) throw new Error('transaction not found')
    return transaction
  }
}

function settlementData(grossAmount: bigint, correlation = callId): Hex {
  return encodeFunctionData({
    abi: [
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
    ],
    functionName: 'creditBuilderEarnings',
    args: [builderAddress, grossAmount, correlation],
  })
}

function body(grossAmount = 4_000_000n, correlation = callId) {
  return {
    chain_id: 46630,
    to: escrowAddress,
    data: settlementData(grossAmount, correlation),
    value: '0x0',
    idempotency_key: callId,
  }
}

function derInteger(value: Hex): Buffer {
  let bytes = Buffer.from(value.slice(2), 'hex')
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1)
  if ((bytes[0] & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes])
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes])
}

function derSignature(r: Hex, s: Hex): Buffer {
  const body = Buffer.concat([derInteger(r), derInteger(s)])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

const config: RestrictedSignerConfig = {
  environment: 'staging',
  region: 'us-east4',
  chainId: 46630,
  rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
  escrowAddress,
  signerAddress: account.address,
  authToken,
  intentTtlSeconds: 2_592_000,
  nonceLockMs: 30_000,
  lockWaitMs: 1_000,
  maxGas: 500_000n,
  maxFeePerGasWei: 10_000_000_000n,
}

const store = new MemoryStore()
const rpc = new MemoryRpc()
const signer = new RestrictedSettlementSigner(
  config,
  new LocalDigestSigner(),
  store,
  rpc
)

const app = createRestrictedSignerApp(signer)
const server = await new Promise<Server>((resolve) => {
  const value = app.listen(0, '127.0.0.1', () => resolve(value))
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Signer test server failed')
const baseUrl = 'http://127.0.0.1:' + address.port

async function request(
  payload: unknown,
  options: { token?: string; idempotencyKey?: Hash } = {}
) {
  const response = await fetch(baseUrl + '/v1/transactions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + (options.token ?? authToken),
      'content-type': 'application/json',
      'idempotency-key': options.idempotencyKey ?? callId,
    },
    body: JSON.stringify(payload),
  })
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  }
}

try {
  const health = await fetch(baseUrl + '/health')
  assert.equal(health.status, 200)
  assert.equal((await health.json() as { chain_id: number }).chain_id, 46630)

  const [first, replay] = await Promise.all([request(body()), request(body())])
  assert.equal(first.status, 200)
  assert.equal(replay.status, 200)
  assert.equal(first.body.tx_hash, replay.body.tx_hash)
  assert.equal(first.body.signer_address, account.address)
  assert.equal(store.intents.size, 1)
  assert.equal(new Set(rpc.rawTransactions).size, 1)
  assert(rpc.rawTransactions.length >= 1)
  assert.equal(
    getAddress(
      await recoverTransactionAddress({
        serializedTransaction: rpc.rawTransactions[0],
      })
    ),
    account.address
  )

  const conflict = await request(body(5_000_000n))
  assert.equal(conflict.status, 409)
  assert.match(String(conflict.body.error), /another request/)

  const wrongHeader = await request(body(), { idempotencyKey: otherCallId })
  assert.equal(wrongHeader.status, 400)

  const wrongCallId = await request(body(4_000_000n, otherCallId))
  assert.equal(wrongCallId.status, 400)

  const unauthorized = await request(body(), { token: 'wrong-token' })
  assert.equal(unauthorized.status, 401)

  const digest = keccak256('0x1234')
  const localSignature = await sign({ hash: digest, privateKey })
  const parsedDer = parseDerSignature(
    derSignature(localSignature.r, localSignature.s)
  )
  assert.equal(parsedDer.r, localSignature.r)
  assert.equal(parsedDer.s, localSignature.s)

  const ecdh = createECDH('secp256k1')
  ecdh.setPrivateKey(Buffer.from(privateKey.slice(2), 'hex'))
  const spkiPrefix = Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex')
  const publicKey = createPublicKey({
    key: Buffer.concat([spkiPrefix, ecdh.getPublicKey(undefined, 'uncompressed')]),
    format: 'der',
    type: 'spki',
  })
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
  assert.equal(publicKeyPemToAddress(pem), account.address)

  console.log('CLOUD KMS RESTRICTED SIGNER POLICY AND IDEMPOTENCY VERIFIED')
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  )
}