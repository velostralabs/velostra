# Velostra Python SDK

> Contract verified: 2026-07-18. Repository package; not published to a public registry.
> Public API status: not deployed; `velostra.xyz` is a static protocol preview.

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
result = client.run_agent("flowscope", "Inspect this wallet", str(uuid4()))
~~~

Use one idempotency key per business intent and retain it across network retries.
Treat IDEMPOTENCY_INDETERMINATE as a state-inspection requirement.

sign_gateway_request signs timestamp + "." + exact_body.
verify_webhook verifies timestamp + "." + event_id + "." + exact_body. Capture raw
body bytes and deduplicate receiver effects by stable event ID.

~~~bash
python -m unittest discover -s sdk/python/tests -v
~~~
