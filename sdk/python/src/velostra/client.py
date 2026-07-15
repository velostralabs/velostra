from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Callable, Generator, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class PageInfo:
    next_cursor: str | None
    has_more: bool


@dataclass(frozen=True)
class AgentPage:
    items: list[dict[str, Any]]
    page: PageInfo


class VelostraApiError(RuntimeError):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        request_id: str | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id
        self.details = details


Transport = Callable[[Request, float], tuple[int, Mapping[str, str], bytes]]


def _default_transport(request: Request, timeout: float) -> tuple[int, Mapping[str, str], bytes]:
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()


class VelostraClient:
    def __init__(
        self,
        base_url: str = "https://api.velostra.xyz",
        token: str | None = None,
        timeout: float = 30.0,
        retries: int = 2,
        transport: Transport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.retries = max(0, min(5, retries))
        self._transport = transport or _default_transport

    def _request(
        self,
        method: str,
        path: str,
        body: Any = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers = {"Accept": "application/json"}
        if encoded is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        for attempt in range(self.retries + 1):
            request = Request(
                self.base_url + "/api/v1" + path,
                data=encoded,
                headers=headers,
                method=method,
            )
            try:
                status, response_headers, raw = self._transport(request, self.timeout)
            except URLError:
                if attempt >= self.retries or (method != "GET" and not idempotency_key):
                    raise
                time.sleep(0.1 * (2**attempt))
                continue

            payload = json.loads(raw.decode("utf-8")) if raw else {}
            if 200 <= status < 300:
                return payload
            retryable = status == 429 or status >= 500
            if retryable and attempt < self.retries and (method == "GET" or idempotency_key):
                retry_after = response_headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 0.1 * (2**attempt))
                continue
            raise VelostraApiError(
                status=status,
                code=payload.get("code", "REQUEST_FAILED"),
                message=payload.get("error", f"Request failed ({status})"),
                request_id=payload.get("request_id"),
                details=payload.get("details"),
            )
        raise RuntimeError("unreachable retry state")

    def authenticate_wallet(
        self,
        wallet_address: str,
        sign_message: Callable[[str], str],
    ) -> dict[str, Any]:
        nonce = self._request("POST", "/auth/nonce", {"walletAddress": wallet_address})["data"]
        signature = sign_message(nonce["message"])
        login = self._request(
            "POST",
            "/auth/login",
            {"walletAddress": wallet_address, "signature": signature},
        )["data"]
        self.token = login["token"]
        return login

    def list_agents(
        self,
        category: str | None = None,
        query: str | None = None,
        limit: int = 25,
        cursor: str | None = None,
    ) -> AgentPage:
        values = {"category": category, "q": query, "limit": limit, "cursor": cursor}
        suffix = urlencode({key: value for key, value in values.items() if value is not None})
        payload = self._request("GET", "/agents?" + suffix)
        page = payload.get("page", {})
        return AgentPage(
            items=payload["data"],
            page=PageInfo(page.get("next_cursor"), bool(page.get("has_more"))),
        )

    def iterate_agents(self, **kwargs: Any) -> Generator[dict[str, Any], None, None]:
        cursor = None
        while True:
            page = self.list_agents(cursor=cursor, **kwargs)
            yield from page.items
            cursor = page.page.next_cursor
            if not cursor:
                return

    def get_agent(self, slug: str) -> dict[str, Any]:
        return self._request("GET", "/agents/" + quote(slug, safe=""))["data"]["agent"]

    def run_agent(self, slug: str, input_text: str, idempotency_key: str) -> Any:
        return self._request(
            "POST",
            "/agents/" + quote(slug, safe="") + "/run",
            {"input": input_text},
            idempotency_key,
        )["data"]

    def create_report(
        self,
        agent_id: str,
        reason: str,
        description: str,
        idempotency_key: str,
        evidence: dict[str, Any] | None = None,
    ) -> Any:
        return self._request(
            "POST",
            "/trust/agents/" + quote(agent_id, safe="") + "/reports",
            {"reason": reason, "description": description, "evidence": evidence or {}},
            idempotency_key,
        )["data"]
