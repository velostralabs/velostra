import http from 'node:http'
import {
  AgentEndpointError,
  EndpointSecurityError,
  isBlockedAddress,
  parseAgentEndpoint,
  resolveSafeAgentEndpoint,
  safeFetchAgent,
} from '../src/lib/gateway/ssrf.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('FAILED: ' + message)
  console.log('✅', message)
}

async function assertRejects(
  action: () => Promise<unknown> | unknown,
  code: string,
  message: string
): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(error instanceof EndpointSecurityError || error instanceof AgentEndpointError, `${message} returns a typed error`)
    assert(error.code === code, `${message} returns ${code}`)
    return
  }
  throw new Error('FAILED: ' + message + ' did not reject')
}

async function listen(
  handler: http.RequestListener
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind TCP')
  return { server, port: address.port }
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test'
  process.env.AGENT_ALLOWED_PORTS = '80,443'
  process.env.AGENT_SSRF_TEST_ALLOW_LOOPBACK = 'false'

  console.log('\n--- SSRF address policy ---')
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ]) {
    assert(isBlockedAddress(address), `${address} is blocked`)
  }
  assert(!isBlockedAddress('93.184.216.34'), 'public IPv4 is allowed')
  assert(!isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), 'public IPv6 is allowed')

  console.log('\n--- URL and DNS policy ---')
  await assertRejects(
    () => Promise.resolve(parseAgentEndpoint('file:///etc/passwd')),
    'AGENT_ENDPOINT_SCHEME_BLOCKED',
    'non-HTTP scheme'
  )
  await assertRejects(
    () => Promise.resolve(parseAgentEndpoint('https://user:password@example.com/agent')),
    'AGENT_ENDPOINT_CREDENTIALS_BLOCKED',
    'URL credentials'
  )
  await assertRejects(
    () => Promise.resolve(parseAgentEndpoint('https://example.com:444/agent')),
    'AGENT_ENDPOINT_PORT_BLOCKED',
    'unapproved port'
  )
  await assertRejects(
    () => resolveSafeAgentEndpoint('https://agent.example/run', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]),
    'AGENT_ENDPOINT_PRIVATE_ADDRESS',
    'mixed public/private DNS answer'
  )
  const publicTarget = await resolveSafeAgentEndpoint('https://agent.example/run', async () => [
    { address: '93.184.216.34', family: 4 },
  ])
  assert(publicTarget.address === '93.184.216.34', 'public DNS target is pinned')

  console.log('\n--- Pinned request, redirect, size, and timeout policy ---')
  process.env.AGENT_SSRF_TEST_ALLOW_LOOPBACK = 'true'
  const success = await listen((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ body, host: request.headers.host }))
    })
  })
  process.env.AGENT_ALLOWED_PORTS = `80,443,${success.port}`
  const successResponse = await safeFetchAgent(`http://127.0.0.1:${success.port}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"input":"safe"}',
  })
  assert(successResponse.ok && successResponse.text.includes('safe'), 'validated IP receives the POST body')
  await close(success.server)

  const redirect = await listen((_request, response) => {
    response.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data' })
    response.end()
  })
  process.env.AGENT_ALLOWED_PORTS = `80,443,${redirect.port}`
  await assertRejects(
    () => safeFetchAgent(`http://127.0.0.1:${redirect.port}/run`),
    'AGENT_ENDPOINT_PRIVATE_ADDRESS',
    'redirect to cloud metadata address'
  )
  await close(redirect.server)

  const oversized = await listen((_request, response) => {
    response.writeHead(200, { 'content-length': '128' })
    response.end('x'.repeat(128))
  })
  process.env.AGENT_ALLOWED_PORTS = `80,443,${oversized.port}`
  process.env.AGENT_MAX_RESPONSE_BYTES = '32'
  await assertRejects(
    () => safeFetchAgent(`http://127.0.0.1:${oversized.port}/run`),
    'AGENT_RESPONSE_TOO_LARGE',
    'oversized response'
  )
  await close(oversized.server)

  const slow = await listen(() => undefined)
  process.env.AGENT_ALLOWED_PORTS = `80,443,${slow.port}`
  process.env.AGENT_MAX_RESPONSE_BYTES = '1048576'
  process.env.AGENT_TIMEOUT_MS = '50'
  await assertRejects(
    () => safeFetchAgent(`http://127.0.0.1:${slow.port}/run`),
    'AGENT_ENDPOINT_TIMEOUT',
    'slow endpoint'
  )
  await close(slow.server)

  console.log('\n🎉 SSRF AND AGENT EGRESS POLICY VERIFIED\n')
}

main().catch((error) => {
  console.error('💥', error)
  process.exit(1)
})