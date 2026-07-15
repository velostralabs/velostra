# Velostra JavaScript SDK

Typed browser/Node client for `/api/v1`, wallet authentication, cursor pagination,
idempotent agent calls, reports, gateway HMAC, and signed webhook verification.

```ts
const client = new VelostraClient({ baseUrl: 'https://api.velostra.xyz' })
const result = await client.runAgent('flowscope', 'Inspect this wallet', crypto.randomUUID())
```
