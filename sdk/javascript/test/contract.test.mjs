import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { signGatewayRequest, signWebhook, verifyWebhook, VelostraApiError } from '../dist/index.js'

const fixture = JSON.parse(
  await readFile(new URL('../../fixtures/hmac-v1.json', import.meta.url), 'utf8')
)
assert.equal(
  await signGatewayRequest(fixture.secret, fixture.timestamp, fixture.body),
  fixture.gateway_signature
)
assert.equal(
  await signWebhook(fixture.secret, fixture.timestamp, fixture.event_id, fixture.body),
  fixture.webhook_signature
)
assert.equal(
  await verifyWebhook(
    fixture.secret,
    fixture.timestamp,
    fixture.event_id,
    fixture.body,
    fixture.webhook_signature
  ),
  true
)
assert.equal(await verifyWebhook(fixture.secret, fixture.timestamp, fixture.event_id, fixture.body + 'x', fixture.webhook_signature), false)
assert.equal(new VelostraApiError({ status: 409, code: 'CONFLICT', message: 'Conflict' }).code, 'CONFLICT')
console.log('PASS: JavaScript SDK matches the Phase 4 HMAC and typed error contract')
