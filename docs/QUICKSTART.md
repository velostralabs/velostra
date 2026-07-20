# Local quickstart

> Last verified against package scripts, env templates, and managed staging: 2026-07-20.
> Phase state: Phase 0-4 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> Redacted managed results and the remaining gates are indexed in
> [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md). Never point destructive local tests at
> the managed staging database.

## Prerequisites

- Node.js 22+ and npm;
- PostgreSQL 14+;
- Redis 7 for the real shared-nonce/rate-limit path;
- MetaMask or another EIP-6963/injected wallet only for manual wallet testing.

Use disposable databases for integration tests.

## Start dependencies

```powershell
docker run -d --name velostra-pg -e POSTGRES_PASSWORD=velostra -e POSTGRES_DB=velostra -p 5432:5432 postgres:16
docker run -d --name velostra-redis -p 6379:6379 redis:7
```

## API

```powershell
Copy-Item server/.env.example server/.env
npm install --prefix server
npm --prefix server run db:migrate
npm --prefix server run dev
```

Minimum local read/auth configuration:

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://postgres:velostra@127.0.0.1:5432/velostra
JWT_SECRET=a-long-local-development-secret-at-least-32-chars
AUTH_PUBLIC_URI=http://localhost:5173
AUTH_NONCE_STORE=redis
ADMIN_BOOTSTRAP_WALLETS=0xYourWallet
GATEWAY_HMAC_SECRET=a-long-local-gateway-secret-at-least-32-chars
AGENT_SECRET_ENCRYPTION_KEY=<32-byte base64 or 64 hex>
AGENT_SECRET_ENCRYPTION_KEY_ID=local
WEB_ORIGIN=http://localhost:5173
REDIS_URL=redis://127.0.0.1:6379
REDIS_FAILURE_MODE=open
PLATFORM_CURSOR_SECRET=a-separate-local-secret-at-least-32-chars
```

Generate a local encryption key without printing any wallet key into source, for
example with your password/secret manager tooling. Never put backend secrets in the
root frontend `.env`.

Check:

```powershell
Invoke-RestMethod http://localhost:8787/health
```

Paid flow additionally needs a local/test escrow, settler key, RPC, chain ID,
token decimals 6, and deployment block. `ONCHAIN_SETTLEMENT_MODE=disabled` is only
for isolated UI work and does not prove a money loop; production rejects it.
Multiple RPCs can be exercised with `ROBINHOOD_RPC_URL` as primary and a
comma-separated `ROBINHOOD_RPC_FALLBACK_URLS` list. Production signer authority
must use the restricted HTTPS signer adapter; raw process private keys are rejected.

## Frontend

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Public root env:

```dotenv
VITE_API_URL=http://localhost:8787
VITE_ESCROW_ADDRESS=0x...
VITE_SETTLEMENT_TOKEN=0x...
```

Open `http://localhost:5173`. The same static protocol preview is public at
[https://velostra.xyz/](https://velostra.xyz/), built by Netlify from `main` using
`netlify.toml`. The public preview has no managed API or contract build values; use
the local environment above for full-stack development. Canonical routes include
`/system`, `/proof`,
`/economics`, `/marketplace`, `/agents/:slug`, `/dashboard`, `/builder`, `/admin`,
and `/docs`. Legacy hash links are normalized to clean paths.

`Connect Wallet` opens an explicit provider picker. MetaMask has a first-class
connector; Rainbow, Coinbase, and other wallets may appear through EIP-6963/
injected discovery. The app never asks for seed phrases or private keys.

## Local contract

The integration suite deploys its own contract automatically. For manual deploy,
configure `contracts/.env` with distinct role addresses and run:

```powershell
npm install --prefix contracts
npm test --prefix contracts
```

Do not run `deploy:robinhood` until the independent audit and every mainnet release
prerequisite are closed.

## Reconciliation

With escrow/RPC/deployment block configured:

```powershell
npm --prefix server run reconcile
npm --prefix server run reconcile -- --from-block=123456 --to-block=125000
npm --prefix server run reconcile:worker
```

Retroactive scans preserve the normal cursor unless the requested range begins at
its exact next block.

## Webhook worker

For local builder webhook delivery, start a separate terminal:

~~~powershell
npm --prefix server run webhooks
npm --prefix server run webhooks:worker
~~~

The one-shot command drains one due batch; worker mode repeats using the configured
interval. Local endpoints still pass the webhook URL security policy. Use stable
event-ID deduplication in the receiver.

## Verification

Isolated gates:

```powershell
npm run lint
npm run build
npm run test:privacy
npm run test:browser
npm run audit:metamask
npm run test:phase2-evidence
npm run test:phase3-release
npm run test:phase4-unit
npm --prefix server run build
npm --prefix server run db:check
npm --prefix server run test:config
npm --prefix server run test:auth
npm --prefix server run test:ssrf
npm --prefix server run test:http-security
npm --prefix server run test:secrets
npm --prefix server run test:signer
npm --prefix server run test:kms-signer
powershell -NoProfile -File deploy/gcp/test-staging-policy.ps1
powershell -NoProfile -File deploy/gcp/test-deployment-plan.ps1
npm --prefix server run test:authority
npm --prefix server run test:resilience
npm --prefix server run test:observability
npm --prefix server run test:phase3-canary
npm --prefix server run test:admin-policy
npm --prefix server run test:money-unit
npm test --prefix contracts
```

Disposable Postgres gates:

```powershell
$env:DATABASE_URL='postgresql://postgres:velostra@127.0.0.1:5432/velostra_test'
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm --prefix server run test:observability-db
npm --prefix server run test:phase3-canary-db
npm run test:phase4-db
npm --prefix server run test:money
```

The money-loop suite resets application state in that database. Never point it at
staging or production.

## US-only managed testnet staging

The selected staging target is Robinhood testnet chain 46630 with every managed
resource in a US Virginia region. Validate the non-mutating deployment plan:

    powershell -NoProfile -File deploy/gcp/test-staging-policy.ps1
    powershell -NoProfile -File deploy/gcp/test-deployment-plan.ps1
    powershell -NoProfile -File deploy/gcp/bootstrap-staging.ps1 -ProjectId velostra-production

The bootstrap remains plan-only unless Apply and a billing account are supplied.
The US foundation, managed data plane, twelve scoped secrets, private Telegram,
three disjoint Safe 1.4.1 2-of-3 authorities, synthetic token, VelostraEscrow, and
immutable signer/API/web/jobs runtime are now deployed. Validate the retained,
ignored authority/deployment records without decrypting keys:

    npm run test:testnet-authorities
    powershell -NoProfile -File deploy/gcp/check-testnet-authorities.ps1

Deep readiness, origin binding, signer privacy, and scheduled-worker entrypoints have
passed while paid writes remain disabled. Follow
[the US staging runbook](../deploy/gcp/README.md) for idempotent redeploy and the
remaining real-wallet/alert/outage/PITR/soak evidence. Use only approved US regions
and Robinhood testnet chain 46630. Never use mainnet or real value for this path.

## Phase 3 release preparation

These local commands test and plan; they do not broadcast:

```powershell
npm run test:phase3
npm run release:prepare
npm run release:validate
npm run release:plan
```

Preparation uses the synthetic disabled policy and no image/evidence authorization.
A real `broadcast-approved` manifest must be created separately from a clean reviewed
commit with immutable image digests, external evidence, enabled bounded canary policy,
ticket, and two distinct approvals. Do not set the mainnet broadcast sentinel for a
local preview.

## Troubleshooting

- `ECONNREFUSED 5432/6379`: start the dependency or fix the URL.
- Auth fails across instances: ensure Redis is reachable and nonce mode is `redis`.
- Agent endpoint rejected: inspect the machine code; loopback/private URLs are
  intentionally blocked outside test mode.
- Paid call 503 ambiguous: do not retry blindly; run/observe worker by `call_id`.
- Worker starts from genesis: set exact `VELOSTRA_DEPLOYMENT_BLOCK`.
- Direct route 404 after static deploy: configure SPA rewrite to `/index.html`.
- Webhook remains pending: start the webhook worker and inspect receiver HTTPS/status,
  signature verification, delivery attempts, and worker heartbeat.
- IDEMPOTENCY_INDETERMINATE: inspect the call/resource first; never blindly repeat
  the mutation under a new key.
- Production startup fails: the message names the unsafe/missing guardrail; do not
  bypass it.

See [TESTING.md](./TESTING.md), [DEPLOYMENT.md](./DEPLOYMENT.md), and
[OPERATIONS.md](./OPERATIONS.md).
