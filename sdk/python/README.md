# Velostra Python SDK

> Contract reverified: 2026-07-22. Repository package; not published to a public registry.
> The public testnet API is live behind `https://velostra.xyz/testnet`; SDK consumers
> must still supply an approved API origin and must use synthetic testnet value only.

Dependency-free typed Python 3.10+ client for /api/v1 with stable errors, opaque
cursor pagination, wallet authentication helpers, idempotent agent calls, reports,
gateway HMAC, and signed webhook verification.

~~~python
from uuid import uuid4
from velostra import VelostraClient

client = VelostraClient(
    base_url="https://api.example.invalid",
    token="session-token",
)
result = client.run_agent("wallet-sentinel", "Review this synthetic approval set", str(uuid4()))
~~~

Use one idempotency key per business intent and retain it across network retries.
Treat IDEMPOTENCY_INDETERMINATE as a state-inspection requirement.

sign_gateway_request signs timestamp + "." + exact_body.
verify_webhook verifies timestamp + "." + event_id + "." + exact_body. Capture raw
body bytes and deduplicate receiver effects by stable event ID.

~~~bash
python -m unittest discover -s sdk/python/tests -v
~~~
