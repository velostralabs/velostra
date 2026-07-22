import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { assertStagingPolicy, createSyntheticAgentServer } from '../src/synthetic-agent/index.js'
import { SYNTHETIC_AGENT_CATALOG } from '../src/synthetic-agent/catalog.js'

const original = {
  environment: process.env.VELOSTRA_ENVIRONMENT,
  chainId: process.env.ROBINHOOD_CHAIN_ID,
  enabled: process.env.SYNTHETIC_AGENT_ENABLED,
  release: process.env.VELOSTRA_RELEASE,
}

try {
  process.env.VELOSTRA_ENVIRONMENT = 'staging'
  process.env.ROBINHOOD_CHAIN_ID = '46630'
  process.env.SYNTHETIC_AGENT_ENABLED = 'true'
  process.env.VELOSTRA_RELEASE = 'a'.repeat(40)
  assert.doesNotThrow(() => assertStagingPolicy())

  process.env.ROBINHOOD_CHAIN_ID = '4663'
  assert.throws(() => assertStagingPolicy(), /testnet/)
  process.env.ROBINHOOD_CHAIN_ID = '46630'

  const server = createSyntheticAgentServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    const health = await fetch('http://127.0.0.1:' + port + '/health')
    assert.equal(health.status, 200)
    const healthBody = await health.json() as { chain_id: number; profiles: number }
    assert.equal(healthBody.chain_id, 46630)
    assert.equal(healthBody.profiles, SYNTHETIC_AGENT_CATALOG.length)

    for (const profile of SYNTHETIC_AGENT_CATALOG) {
      const marker = `must-not-be-echoed-${profile.slug}`
      const callId = `test-call-${profile.slug}`
      const execution = await fetch('http://127.0.0.1:' + port + profile.endpointPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: marker, call_id: callId }),
      })
      assert.equal(execution.status, 200)
      const text = await execution.text()
      assert.doesNotMatch(text, new RegExp(marker))
      const body = JSON.parse(text) as {
        output: { agent_slug: string; scenario_id: string; proof: { call_id: string; input_retained: boolean } }
      }
      assert.equal(body.output.agent_slug, profile.slug)
      assert.equal(body.output.scenario_id, profile.scenario.id)
      assert.equal(body.output.proof.call_id, callId)
      assert.equal(body.output.proof.input_retained, false)
    }

    const unknownProfile = await fetch('http://127.0.0.1:' + port + '/execute/unknown', {
      method: 'POST',
      body: JSON.stringify({ input: 'test', call_id: 'unknown-profile' }),
    })
    assert.equal(unknownProfile.status, 404)

    const malformed = await fetch('http://127.0.0.1:' + port + '/execute', {
      method: 'POST',
      body: '{',
    })
    assert.equal(malformed.status, 400)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  }
  console.info('Synthetic staging agent policy and HTTP contract: PASS')
} finally {
  if (original.environment === undefined) delete process.env.VELOSTRA_ENVIRONMENT
  else process.env.VELOSTRA_ENVIRONMENT = original.environment
  if (original.chainId === undefined) delete process.env.ROBINHOOD_CHAIN_ID
  else process.env.ROBINHOOD_CHAIN_ID = original.chainId
  if (original.enabled === undefined) delete process.env.SYNTHETIC_AGENT_ENABLED
  else process.env.SYNTHETIC_AGENT_ENABLED = original.enabled
  if (original.release === undefined) delete process.env.VELOSTRA_RELEASE
  else process.env.VELOSTRA_RELEASE = original.release
}
