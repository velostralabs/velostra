# Velostra JavaScript SDK

> Contract reverified: 2026-07-22. Repository package; not published to a public registry.
> The public testnet API is live behind `https://velostra.xyz/testnet`; SDK consumers
> must still supply an approved API origin and must use synthetic testnet value only.

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
  'wallet-sentinel',
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
