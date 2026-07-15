# Velostra Python SDK

Dependency-free typed Python client for `/api/v1`, wallet authentication, cursor
pagination, idempotent agent calls, reports, gateway HMAC, and webhook verification.

```python
client = VelostraClient(base_url="https://api.velostra.xyz", token="...")
result = client.run_agent("flowscope", "Inspect this wallet", str(uuid.uuid4()))
```
