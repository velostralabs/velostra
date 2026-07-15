import type { Server } from 'node:http'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('FAILED: ' + message)
  console.log('✅', message)
}

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test'
  process.env.WEB_ORIGIN = 'https://app.velostra.test'
  process.env.JSON_BODY_LIMIT = '64b'
  process.env.JWT_SECRET = 'http-security-test-secret-that-is-long-enough'
  process.env.AGENT_SECRET_ENCRYPTION_KEY = '00'.repeat(32)
  process.env.METRICS_AUTH_TOKEN = 'metrics-test-token-that-is-long-enough'

  const { createApp } = await import('../src/app.js')
  const app = createApp()
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP test server did not bind')
    const base = `http://127.0.0.1:${address.port}`

    const health = await fetch(`${base}/health`, {
      headers: { origin: 'https://app.velostra.test' },
    })
    assert(health.status === 200, 'allowlisted origin reaches the API')
    assert(health.headers.get('x-content-type-options') === 'nosniff', 'nosniff header is present')
    assert(health.headers.get('x-frame-options') === 'DENY', 'frame embedding is denied')
    assert(Boolean(health.headers.get('x-request-id')), 'request correlation ID is returned')
    assert(health.headers.get('access-control-allow-origin') === 'https://app.velostra.test', 'CORS echoes only the allowlisted origin')
    assert(health.headers.get('x-powered-by') === null, 'Express fingerprint header is disabled')

    const readiness = await fetch(`${base}/ready`)
    assert(readiness.status === 503, 'deep readiness fails closed before a dependency snapshot exists')

    const metricsWithoutToken = await fetch(`${base}/metrics`)
    assert(metricsWithoutToken.status === 401, 'metrics reject an unauthenticated scrape')
    const metrics = await fetch(`${base}/metrics`, {
      headers: { authorization: `Bearer ${process.env.METRICS_AUTH_TOKEN}` },
    })
    assert(metrics.status === 200, 'metrics accept the configured scrape token')
    assert(
      (await metrics.text()).includes('velostra_process_uptime_seconds'),
      'metrics return Prometheus text exposition'
    )
    const blockedOrigin = await fetch(`${base}/health`, {
      headers: { origin: 'https://evil.example' },
    })
    const blockedOriginBody = await blockedOrigin.json() as { code?: string; request_id?: string }
    assert(blockedOrigin.status === 403, 'unknown browser origin is rejected')
    assert(blockedOriginBody.code === 'ORIGIN_NOT_ALLOWED', 'CORS rejection has a machine-readable code')
    assert(Boolean(blockedOriginBody.request_id), 'CORS rejection remains correlated')

    const invalidJson = await fetch(`${base}/api/auth/nonce`, {
      method: 'POST',
      headers: {
        origin: 'https://app.velostra.test',
        'content-type': 'application/json',
      },
      body: '{broken',
    })
    const invalidJsonBody = await invalidJson.json() as { code?: string }
    assert(invalidJson.status === 400, 'invalid JSON is rejected before routing')
    assert(invalidJsonBody.code === 'INVALID_JSON', 'invalid JSON has a machine-readable code')

    const oversized = await fetch(`${base}/api/auth/nonce`, {
      method: 'POST',
      headers: {
        origin: 'https://app.velostra.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ walletAddress: '0x' + '1'.repeat(100) }),
    })
    const oversizedBody = await oversized.json() as { code?: string }
    assert(oversized.status === 413, 'oversized request body is rejected')
    assert(oversizedBody.code === 'REQUEST_TOO_LARGE', 'body limit failure has a machine-readable code')

    const notFound = await fetch(`${base}/missing`)
    const notFoundBody = await notFound.json() as { code?: string }
    assert(notFound.status === 404, 'unknown API route returns 404')
    assert(notFoundBody.code === 'ROUTE_NOT_FOUND', '404 has a machine-readable code')

    console.log('\n🎉 HTTP TRUST-BOUNDARY POLICY VERIFIED\n')
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

main().catch((error) => {
  console.error('💥', error)
  process.exit(1)
})