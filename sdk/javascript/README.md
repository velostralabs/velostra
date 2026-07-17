# Velostra JavaScript SDK

> Contract verified: 2026-07-17. Repository package; not published to a public registry.

Typed browser/Node client for /api/v1 with stable errors, opaque cursor pagination,
wallet authentication helpers, idempotent agent calls, reports, gateway HMAC, and
signed webhook verification.

~~~ts
import { VelostraClient } from '@velostra/sdk'

const client = new VelostraClient({
  baseUrl: 'https://api.example.invalid',
  token: 'session-token'
})

const page = await client.listAgents({ limit: 25 })
const result = await client.runAgent(
  'flowscope',
  'Inspect this wallet',
  crypto.randomUUID()
)
~~~

Use one idempotency key per business intent and retain it across network retries.
Treat IDEMPOTENCY_INDETERMINATE as a state-inspection requirement, not permission to
repeat under a new key.

signGatewayRequest signs timestamp + "." + exactBody.
verifyWebhook verifies timestamp + "." + eventId + "." + exactBody. Capture raw
body bytes and deduplicate receiver effects by stable event ID.

~~~bash
npm test --prefix sdk/javascript
~~~
