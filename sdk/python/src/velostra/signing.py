import hashlib
import hmac


def _sign(secret: str, value: str) -> str:
    return hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def sign_gateway_request(secret: str, timestamp: str, body: str) -> str:
    return _sign(secret, f"{timestamp}.{body}")


def sign_webhook(secret: str, timestamp: str, event_id: str, body: str) -> str:
    return _sign(secret, f"{timestamp}.{event_id}.{body}")


def verify_webhook(
    secret: str,
    timestamp: str,
    event_id: str,
    body: str,
    supplied_signature: str,
) -> bool:
    expected = sign_webhook(secret, timestamp, event_id, body)
    return hmac.compare_digest(expected, supplied_signature)
