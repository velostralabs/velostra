import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import { SYNTHETIC_AGENT_CATALOG, syntheticProfileForPath } from './catalog.js'

const MAX_BODY_BYTES = 16 * 1024
const MAX_CALL_ID_BYTES = 128
const PORT = Number(process.env.PORT ?? 8080)

export function assertStagingPolicy(): void {
  if (process.env.VELOSTRA_ENVIRONMENT !== 'staging') {
    throw new Error('Synthetic agent is staging-only')
  }
  if (process.env.ROBINHOOD_CHAIN_ID !== '46630') {
    throw new Error('Synthetic agent requires Robinhood testnet')
  }
  if (process.env.SYNTHETIC_AGENT_ENABLED !== 'true') {
    throw new Error('Synthetic agent is disabled')
  }
  if (!/^[0-9a-f]{40}$/i.test(process.env.VELOSTRA_RELEASE ?? '')) {
    throw new Error('Synthetic agent requires an immutable release')
  }
  if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(value))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request too large'))
        request.destroy()
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET'
  const path = new URL(request.url ?? '/', 'http://synthetic-agent.local').pathname
  if (method === 'GET' && path === '/health') {
    json(response, 200, {
      status: 'ok',
      service: 'velostra-synthetic-agent',
      environment: 'staging',
      chain_id: 46630,
      profiles: SYNTHETIC_AGENT_CATALOG.length,
    })
    return
  }
  const profile = syntheticProfileForPath(path)
  if (method !== 'POST' || !profile) {
    response.setHeader('Allow', 'GET, POST')
    json(response, method === 'POST' ? 404 : 405, { error: 'not found' })
    return
  }

  const contentLength = Number(request.headers['content-length'] ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    json(response, 413, { error: 'payload too large' })
    request.resume()
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(request))
  } catch {
    json(response, 400, { error: 'invalid request' })
    return
  }
  if (!parsed || typeof parsed !== 'object') {
    json(response, 400, { error: 'invalid request' })
    return
  }
  const input = (parsed as { input?: unknown }).input
  const callId = (parsed as { call_id?: unknown }).call_id
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 10_000 ||
    typeof callId !== 'string' ||
    callId.length < 1 ||
    Buffer.byteLength(callId, 'utf8') > MAX_CALL_ID_BYTES
  ) {
    json(response, 400, { error: 'invalid request' })
    return
  }

  // Deliberately deterministic and non-persistent: staging calls never echo
  // user input or retain it in this process or a backing service.
  json(response, 200, {
    output: {
      status: 'verified',
      agent_slug: profile.slug,
      scenario_id: profile.scenario.id,
      scenario: profile.scenario.title,
      ...profile.scenario.result,
      proof: {
        call_id: callId,
        environment: 'public-testnet',
        chain_id: 46630,
        deterministic: true,
        input_retained: false,
      },
    },
  })
}

export function createSyntheticAgentServer() {
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) json(response, 500, { error: 'request failed' })
      else response.destroy()
    })
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertStagingPolicy()
  createSyntheticAgentServer().listen(PORT, '0.0.0.0')
}
