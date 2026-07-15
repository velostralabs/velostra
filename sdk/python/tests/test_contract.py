import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python" / "src"))

from velostra import sign_gateway_request, sign_webhook, verify_webhook  # noqa: E402


class ContractTest(unittest.TestCase):
    def test_shared_hmac_fixture(self) -> None:
        fixture = json.loads((ROOT / "fixtures" / "hmac-v1.json").read_text("utf-8"))
        self.assertEqual(
            sign_gateway_request(fixture["secret"], fixture["timestamp"], fixture["body"]),
            fixture["gateway_signature"],
        )
        self.assertEqual(
            sign_webhook(
                fixture["secret"], fixture["timestamp"], fixture["event_id"], fixture["body"]
            ),
            fixture["webhook_signature"],
        )
        self.assertTrue(
            verify_webhook(
                fixture["secret"],
                fixture["timestamp"],
                fixture["event_id"],
                fixture["body"],
                fixture["webhook_signature"],
            )
        )
        self.assertFalse(
            verify_webhook(
                fixture["secret"],
                fixture["timestamp"],
                fixture["event_id"],
                fixture["body"] + "x",
                fixture["webhook_signature"],
            )
        )


if __name__ == "__main__":
    unittest.main()
