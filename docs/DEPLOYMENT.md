# Deployment and operations

> Last verified against build/deploy scripts: 2026-07-16.
> Phase state: Phase 2 repository scope is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> No production or mainnet deployment is recorded.

## Release gates

Phase 1 and Phase 2 repository scopes are complete and have passed internal
engineering/CI audit; continued development and Phase 3 preparation are clear.
Independent contract/backend review and the managed-staging evidence packet remain
mainnet release gates. Provision only isolated non-mainnet-value staging, execute the
real-wallet/alert/outage/PITR/72-hour drills, and pass the signed evidence validator.
Do not deploy mainnet value before both external gates close.

## Target topology

```mermaid
flowchart LR
    CDN["Static frontend + CDN"] --> API["Express API"]
    API --> PG[(Managed PostgreSQL + PITR)]
    API --> REDIS[(Managed Redis)]
    API --> RPC["Dedicated HTTPS RPC"]
    WORKER["Supervised reconciliation worker"] --> PG
    WORKER --> RPC
    API --> ESCROW["VelostraEscrow"]
    WALLETS["User wallets"] --> ESCROW
    SECRETS["Secret manager / restricted signer"] --> API
```

Initial topology has one logical signer writer and one continuous worker. API read
traffic may scale only after signer nonce behavior is isolated/tested.

## Database release

Use reviewed migrations, never `db:push` against persistent data:

```bash
npm ci --prefix server
npm --prefix server run db:check
npm --prefix server run db:migrate
```

Release order is backup, migration, verification, then application rollout. Enable
encrypted PITR/WAL and complete the restore procedure in
[OPERATIONS.md](./OPERATIONS.md).

## API and worker build

```bash
npm --prefix server run build
node server/dist/index.js
node server/dist/jobs/reconcile.js --watch
```

Both processes run strict production configuration validation.

## Required production environment

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL URL from secret manager |
| `REDIS_URL` | Redis/rediss URL; production mode fails closed |
| `REDIS_FAILURE_MODE` | `closed` or omitted |
| `AUTH_NONCE_STORE` | `redis` or omitted |
| `JWT_SECRET` | non-default, at least 32 characters |
| `AUTH_PUBLIC_URI` | canonical HTTPS frontend origin |
| `WEB_ORIGIN` | comma-separated exact HTTPS origins including auth URI |
| `TRUST_PROXY` | exact edge proxy trust policy |
| `GATEWAY_HMAC_SECRET` | non-default, at least 32 characters |
| `AGENT_SECRET_ENCRYPTION_KEY` | exactly 32 bytes, base64 or 64 hex |
| `AGENT_SECRET_ENCRYPTION_KEY_ID` | stable key ID |
| `AGENT_SECRET_DECRYPTION_KEYS` | optional JSON old-key map during rotation |
| `ADMIN_BOOTSTRAP_WALLETS` | initial governance wallets only |
| `VELOSTRA_ESCROW_ADDRESS` | non-zero deployed escrow |
| `BACKEND_SIGNER_PRIVATE_KEY` | forbidden in production; startup rejects it |
| `SETTLEMENT_SIGNER_MODE` | exactly `remote` |
| `SETTLEMENT_SIGNER_URL` | restricted HTTPS signer endpoint |
| `SETTLEMENT_SIGNER_AUTH_TOKEN` | managed secret, at least 32 characters |
| `SETTLEMENT_SIGNER_ADDRESS` | non-zero authorized settler |
| `ONCHAIN_SETTLEMENT_MODE` | exactly `required` |
| `ROBINHOOD_CHAIN_ID` | `4663` |
| `SETTLEMENT_TOKEN_DECIMALS` | `6` |
| `ROBINHOOD_RPC_URL` | dedicated primary HTTPS endpoint |
| `ROBINHOOD_RPC_FALLBACK_URLS` | optional comma-separated credential-free HTTPS fallbacks |
| `VELOSTRA_DEPLOYMENT_BLOCK` | positive exact deployment block |

Operational tuning is documented in `server/.env.example`: HTTP size/proxy, Redis
timeout, agent egress caps, RPC timeout, reconciliation interval/range/
confirmations/retries/backoff/drift, and outbox grace.

Before traffic, production startup also verifies there are no plaintext agent
secrets and at least one active/bootstrappable super admin.

## Contract deployment

```bash
npm ci --prefix contracts
npm test --prefix contracts
npm --prefix contracts run deploy:robinhood
```

Inputs:

- `DEPLOYER_PRIVATE_KEY`: funded deployment-only wallet;
- `SETTLEMENT_TOKEN`: independently reviewed 6-decimal token;
- `PLATFORM_FEE_BPS`: final fee;
- `ADMIN_ADDRESS`: deployed governance multisig contract;
- `SETTLER_ADDRESS`, `TREASURY_ADDRESS`, `PAUSE_GUARDIAN_ADDRESS`: distinct roles;
- `ROBINHOOD_RPC_URL`: chain 4663 RPC.

The script verifies chain ID, token decimals, role separation, admin bytecode, and
writes local `contracts/deployment.json` (ignored; publish only reviewed public
metadata). Record source verification, bytecode, compiler/optimizer, constructor
args, transaction hash, block, and role grants.

## Frontend deployment

```bash
npm ci
npm run lint
npm run build
```

Build-time public values:

- `VITE_API_URL`;
- `VITE_ESCROW_ADDRESS`;
- `VITE_SETTLEMENT_TOKEN`.

Serve `dist/` behind TLS/CDN with SPA fallback to `/index.html`, no-cache/short cache
for HTML, immutable cache for hashed assets, CSP appropriate to wallet/RPC/API
origins, and no server secret in `VITE_*`.

## Release sequence

1. freeze audited commit and constructor parameters;
2. backup database and apply migrations;
3. deploy and verify contract;
4. configure API/worker with address and deployment block;
5. start worker, catch up, require zero drift;
6. deploy API with write traffic closed;
7. deploy frontend with write actions closed;
8. run read/auth/wallet smoke;
9. enable low-value allowlisted canary;
10. verify deposit, paid call, claim, balances, liabilities, cursor, alerts, and
    recovery; only then expand.

Rollback of API/frontend never reverts chain effects. Keep the worker active.
Contract incidents use pause, settler revoke/rotation, and successor procedure from
[OPERATIONS.md](./OPERATIONS.md).

## One-hour catch-up

Correctness is safe because failed ranges do not advance the cursor. Default 2,000
block chunks, retry/backoff, adaptive splitting, and ordered multi-RPC failover let the
worker resume a large gap without skipping. The local 27-block drill passed with zero
drift; sustained failure across every provider can still delay recovery. Freeze no
one-hour SLO until the managed-staging outage artifact passes.
