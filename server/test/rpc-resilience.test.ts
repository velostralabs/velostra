import assert from 'node:assert/strict'
import http from 'node:http'
import { createPublicClient, defineChain } from 'viem'
import { createResilientRpcTransport, parseRpcUrls } from '../src/lib/rpc.js'

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('Missing test server port'))
      else resolve(address.port)
    })
  })
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

let primaryCalls = 0
let fallbackCalls = 0
const primary = http.createServer((_request, response) => {
  primaryCalls += 1
  response.writeHead(429, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'rate limited' }))
})
const secondary = http.createServer((request, response) => {
  fallbackCalls += 1
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    const payload = JSON.parse(body) as { id: number }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: '0x2a' }))
  })
})

try {
  const [primaryPort, secondaryPort] = await Promise.all([listen(primary), listen(secondary)])
  const urls = parseRpcUrls(
    `http://127.0.0.1:${primaryPort}`,
    ` http://127.0.0.1:${secondaryPort},http://127.0.0.1:${secondaryPort}/ `
  )
  assert.equal(urls.length, 2, 'RPC URL parsing trims and deduplicates endpoints')

  const chain = defineChain({
    id: 4663,
    name: 'Velostra RPC resilience test',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: urls } },
  })
  const client = createPublicClient({
    chain,
    transport: createResilientRpcTransport(urls, 250),
  })
  assert.equal(await client.getBlockNumber({ cacheTime: 0 }), 42n)
  assert.ok(primaryCalls >= 1, 'primary RPC receives the request')
  assert.ok(fallbackCalls >= 1, '429 response fails over to the secondary RPC')
  assert.throws(
    () => parseRpcUrls('https://user:password@rpc.example'),
    /without embedded credentials/
  )
  console.log('RPC RESILIENCE VERIFIED: deterministic 429 failover and URL policy')
} finally {
  await Promise.all([close(primary), close(secondary)])
}
