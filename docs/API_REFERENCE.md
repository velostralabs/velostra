# API reference

> Last verified against `server/src/routes` and middleware: 2026-07-16.
> Phase state: Phase 2 repository scope is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> Local base URL: `http://localhost:8787`.

## Conventions

Authenticated routes accept the httpOnly `velostra_token` cookie or Bearer token.
Financial JSON values are decimal numbers for clients; internal decisions use exact
6-decimal strings/minor units.

Error responses include stable machine fields:

```json
{
  "error": "human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "request_id": "correlation-id"
}
```

Direct route responses include `error` and `code`; centralized errors also include
`request_id` and optional safe `details`. Never branch client behavior on message
text.

## Health

`GET /health` returns process health and chain identity. It is not a deep DB/Redis/
RPC readiness probe; deep readiness belongs to Phase 2.

## Auth - `/api/auth`

| Method | Path | Behavior |
|---|---|---|
| POST | `/nonce` | body `{ walletAddress }`; returns bound EIP-191 message + nonce |
| POST | `/login` | body `{ walletAddress, signature }`; atomic single-use verification, token/user |
| POST | `/logout` | clears auth cookie |
| GET | `/me` | `{ auth: session|null }` |

Important codes: `INVALID_WALLET_INPUT`, `INVALID_WALLET_ADDRESS`,
`INVALID_LOGIN_INPUT`, `AUTH_VERIFICATION_FAILED`, `AUTH_REQUIRED`.

## Marketplace - `/api/agents`

### `GET /api/agents`

Approved agents, maximum 60. Query: `q`, category enum, and sort `featured`,
`popular`, or `price`.

### `GET /api/agents/:slug`

Approved agent detail, builder, tags, and latest reviews. `AGENT_NOT_FOUND` on
missing/non-approved listing.

### `POST /api/agents/:slug/run`

Auth required. Body:

```json
{ "input": "1-10000 characters" }
```

Success:

```json
{
  "call_id": "cuid2",
  "output": {},
  "execution_ms": 123,
  "is_free_tier": false,
  "settlement_tx_hash": "0x..."
}
```

Paid flow creates a durable reservation/outbox before builder HTTP. Important
codes:

- `INVALID_INPUT`, `AGENT_NOT_FOUND`, `AGENT_SECRET_REVOKED`;
- `GLOBAL_RATE_LIMITED`, `USER_RATE_LIMITED`, `AGENT_RATE_LIMITED`;
- `INSUFFICIENT_CREDITS` (402);
- `AGENT_ENDPOINT_FAILED` (502);
- `SETTLEMENT_REVERTED` (502, reservation released);
- `SETTLEMENT_AMBIGUOUS` or `RECONCILIATION_PENDING` (503, reservation retained and
  worker owns recovery).

A 503 recovery response may have a known `settlement_tx_hash`; a lost broadcast
response may not. `call_id` remains the durable support/reconciliation identity.

### `POST /api/agents/:slug/review`

Auth required. Body `{ rating: 1..5, comment?: max 1000 }`. Upserts the unique
user+agent review and recalculates aggregate rating.

## Builder - `/api/builder`

| Method | Path | Behavior |
|---|---|---|
| POST | `/register` | create builder and earnings row; refresh builder session |
| GET | `/me` | profile, earnings, owned agents |
| POST | `/agents` | submit pending agent and return one plaintext secret |
| POST | `/agents/:id/secret/rotate` | replace encrypted secret and return new plaintext once |
| POST | `/agents/:id/secret/revoke` | disable gateway execution for the agent |
| GET | `/earnings` | exact earnings + latest 20 claims |
| POST | `/claim` | reconcile a wallet-submitted confirmed claim tx |

Agent submit constraints: name 2-60, description 10-280, long description max
4,000, category enum, endpoint URL passing SSRF policy, price minimum 0.08, optional
logo/tags (max 8). Normal agent responses never expose encrypted secret storage.

Claim body:

```json
{ "amount": 1.5, "tx_hash": "0x<64 hex>" }
```

The API verifies escrow, sender, event, amount, receipt, and replay. Important
codes include `BUILDER_NOT_FOUND`, `INVALID_AGENT_PRICE`, endpoint-policy codes,
`INVALID_CLAIM_INPUT`, `INVALID_CLAIM_AMOUNT`, `CLAIM_VERIFICATION_FAILED`,
`INSUFFICIENT_EARNINGS`, and `CLAIM_REPLAYED`.

## Dashboard - `/api/dashboard`

Auth required.

- `GET /`: spendable balance, free-tier status, 20 recent calls.
- `POST /topup`: body `{ amount_usd, tx_hash }` after wallet deposit; minimum $1.

Top-up verifies receipt/escrow/sender/event/amount. Codes:
`INVALID_TOPUP_AMOUNT`, `TOPUP_VERIFICATION_FAILED`, `TOPUP_REPLAYED`. Missing
browser report is healed by the worker.

## Admin - `/api/admin`

Every route requires auth plus a DB permission.

| Method | Path | Permission |
|---|---|---|
| GET | `/agents/pending` | `agent:read` |
| POST | `/agents/:id/decision` | `agent:decide` |
| GET | `/reports` | `report:read` |
| POST | `/reports/:id/resolve` | `report:resolve` |
| GET | `/stats` | `stats:read` |
| GET | `/roles` | `rbac:manage` |
| POST | `/roles/grant` | `rbac:manage` |
| POST | `/roles/revoke` | `rbac:manage` |
| GET | `/audit-log?limit=1..100` | `audit:read` |

Roles: `SUPER_ADMIN`, `AGENT_REVIEWER`, `REPORT_MODERATOR`, `FINANCE_VIEWER`,
`AUDITOR`. The last active super admin cannot be revoked. Targets must have signed
in before a role can be granted. Mutations are audited.

## Builder HMAC protocol

Outbound body:

```json
{ "input": "...", "user_id": "...", "call_id": "..." }
```

Headers: `X-Velostra-Agent-Id`, `X-Velostra-Timestamp`, and lowercase hex
`X-Velostra-Signature`. Signature is HMAC-SHA256 over
`timestamp + "." + exactRawBody` using the per-agent secret. Builder must enforce a
fresh timestamp, timing-safe equality, and optional call ID replay cache.

## Current product API gaps

Public `/api/v1` versioning, cursor pagination, agent edit/versioning, approval
webhooks, user report creation, and public SDKs are Phase 4 roadmap work. Error
codes, secret rotation/revoke, and admin RBAC are implemented.
