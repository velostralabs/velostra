import assert from 'node:assert/strict'
import http from 'node:http'
import { decodeFunctionData, getAddress, type Address, type Hash, type Hex } from 'viem'
import { submitRemoteSettlement } from '../src/lib/gateway/signer.js'

const signerAddress = getAddress('0x4444444444444444444444444444444444444444')
const otherAddress = getAddress('0x5555555555555555555555555555555555555555')
const txHash = (`0x${'ab'.repeat(32)}`) as Hash
const callId = (`0x${'cd'.repeat(32)}`) as Hash
const calldata = '0x1234' as Hex
const token = 'restricted-signer-test-token-32-chars'
let requestBody: Record<string, unknown> | undefined
let requestHeaders: http.IncomingHttpHeaders | undefined

const server = http.createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  request.on('end', () => {
    requestHeaders = request.headers
    requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ tx_hash: txHash, signer_address: signerAddress }))
  })
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Mock signer failed to listen')

const managedKeys = [
  'NODE_ENV',
  'SETTLEMENT_SIGNER_URL',
  'SETTLEMENT_SIGNER_AUTH_TOKEN',
  'SETTLEMENT_SIGNER_ADDRESS',
  'SETTLEMENT_SIGNER_TIMEOUT_MS',
  'SETTLEMENT_SIGNER_MODE',
  'VELOSTRA_ESCROW_ADDRESS',
  'ONCHAIN_SETTLEMENT_MODE',
] as const
const original = new Map(managedKeys.map((key) => [key, process.env[key]]))

try {
  process.env.NODE_ENV = 'test'
  process.env.SETTLEMENT_SIGNER_URL = `http://127.0.0.1:${address.port}/v1/transactions`
  process.env.SETTLEMENT_SIGNER_AUTH_TOKEN = token
  process.env.SETTLEMENT_SIGNER_ADDRESS = signerAddress
  process.env.SETTLEMENT_SIGNER_TIMEOUT_MS = '2000'
  process.env.SETTLEMENT_SIGNER_MODE = 'remote'
  process.env.VELOSTRA_ESCROW_ADDRESS = '0x1111111111111111111111111111111111111111'
  process.env.ONCHAIN_SETTLEMENT_MODE = 'required'

  const result = await submitRemoteSettlement({
    chainId: 4663,
    to: getAddress('0x1111111111111111111111111111111111111111'),
    data: calldata,
    idempotencyKey: callId,
  })

  assert.equal(result, txHash)
  assert.equal(requestHeaders?.authorization, `Bearer ${token}`)
  assert.equal(requestHeaders?.['idempotency-key'], callId)
  assert.equal(requestBody?.chain_id, 4663)
  assert.equal(requestBody?.idempotency_key, callId)
  assert.equal(requestBody?.value, '0x0')

  const builder = getAddress('0x6666666666666666666666666666666666666666')
  const { broadcastBuilderCredit, velostraEscrowAbi } = await import(
    '../src/lib/gateway/onchain.js'
  )
  assert.equal(await broadcastBuilderCredit(builder, '4.000000', callId), txHash)
  const decoded = decodeFunctionData({
    abi: velostraEscrowAbi,
    data: String(requestBody?.data) as Hex,
  })
  const args = decoded.args as readonly [Address, bigint, Hash]
  assert.equal(decoded.functionName, 'creditBuilderEarnings')
  assert.equal(args[0], builder)
  assert.equal(args[1], 4_000_000n)
  assert.equal(args[2], callId)
  assert.equal(requestHeaders?.['idempotency-key'], callId)
  process.env.SETTLEMENT_SIGNER_ADDRESS = otherAddress
  await assert.rejects(
    submitRemoteSettlement({
      chainId: 4663,
      to: getAddress('0x1111111111111111111111111111111111111111'),
      data: calldata,
      idempotencyKey: callId,
    }),
    /does not match SETTLEMENT_SIGNER_ADDRESS/
  )

  console.log('RESTRICTED SETTLEMENT SIGNER VERIFIED')
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
