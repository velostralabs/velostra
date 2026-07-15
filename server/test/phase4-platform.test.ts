import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import express from 'express'
import { cursorScope, decodeCursor, encodeCursor } from '../src/lib/platform/cursor.js'
import { apiV1Headers, legacyApiHeaders } from '../src/lib/platform/http.js'
import { generateRequestSignature } from '../src/lib/gateway/hmac.js'
import { signWebhookBody } from '../src/lib/platform/webhooks.js'
import { sanitizeProductTelemetry } from '../src/lib/platform/telemetry.js'
import { PRIVACY_RETENTION_POLICY } from '../src/lib/platform/privacy.js'

process.env.PLATFORM_CURSOR_SECRET = 'phase4-test-cursor-secret-with-more-than-32-characters'

const hmacFixture = JSON.parse(
  await readFile(new URL('../../sdk/fixtures/hmac-v1.json', import.meta.url), 'utf8')
)
assert.equal(
  generateRequestSignature(hmacFixture.body, hmacFixture.timestamp, hmacFixture.secret),
  hmacFixture.gateway_signature
)
assert.equal(
  signWebhookBody(hmacFixture.secret, hmacFixture.timestamp, hmacFixture.event_id, hmacFixture.body),
  hmacFixture.webhook_signature
)
console.log('PASS: backend and both SDKs share one byte-for-byte HMAC fixture')

assert.deepEqual(
  sanitizeProductTelemetry({ request_id: 'request_01', route: '/api/v1/agents', status_code: 200 }),
  { request_id: 'request_01', route: '/api/v1/agents', status_code: 200 }
)
assert.throws(() => sanitizeProductTelemetry({ raw_prompt: 'private' }), /prohibited/)
assert.throws(() => sanitizeProductTelemetry({ experimental_field: 1 }), /not classified/)
assert(PRIVACY_RETENTION_POLICY.retained.some((entry) => entry.includes('financial ledger')))
console.log('PASS: telemetry is allowlisted and privacy policy preserves financial evidence')
const scope = cursorScope({ resource: 'agents', category: 'TRADING', q: null })
const boundary = { createdAt: new Date('2026-07-16T00:00:00.000Z'), id: 'agent_01' }
const encoded = encodeCursor(boundary, scope)
assert.deepEqual(decodeCursor(encoded, scope), boundary)
assert.throws(() => decodeCursor(encoded + 'x', scope), /Cursor is invalid/)
assert.throws(() => decodeCursor(encoded, cursorScope({ resource: 'agents' })), /Cursor is invalid/)
console.log('PASS: signed cursors are opaque, tamper-evident, and query scoped')

const app = express()
app.get('/v1/object', apiV1Headers, (_req, res) => res.json({ agent: { id: 'agent_01' } }))
app.get('/v1/page', apiV1Headers, (_req, res) =>
  res.json({ data: [{ id: 'agent_01' }], page: { next_cursor: null, has_more: false } })
)
app.get('/legacy', legacyApiHeaders('/api/v1/agents'), (_req, res) => res.json({ ok: true }))

const server = http.createServer(app)
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('test server did not bind')
const base = `http://127.0.0.1:${address.port}`

try {
  const object = await fetch(base + '/v1/object')
  assert.equal(object.headers.get('x-api-version'), '1')
  assert.deepEqual(await object.json(), { data: { agent: { id: 'agent_01' } } })

  const page = await fetch(base + '/v1/page')
  assert.deepEqual(await page.json(), {
    data: [{ id: 'agent_01' }],
    page: { next_cursor: null, has_more: false },
  })

  const legacy = await fetch(base + '/legacy')
  assert.equal(legacy.headers.get('deprecation'), 'true')
  assert.equal(legacy.headers.get('sunset'), 'Fri, 31 Dec 2027 23:59:59 GMT')
  assert.match(legacy.headers.get('link') ?? '', /successor-version/)
  console.log('PASS: v1 envelopes and legacy deprecation metadata are stable')
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

console.log('\nPHASE 4 PLATFORM INTERFACE UNIT CONTRACT VERIFIED')
