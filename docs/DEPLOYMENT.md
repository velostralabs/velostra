# Deployment and operations

> Last verified against build/deploy scripts: 2026-07-16.
> Phase state: Phase 0-3 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> No production or mainnet deployment is recorded.

## Release gates

Phase 0-3 repository preparation is complete and has passed internal engineering/CI
audit. This is not deployment authorization. Independent contract/backend review,
the managed-staging evidence packet, an immutable approved release manifest, and an
explicit operator broadcast remain mainnet release gates. Provision only isolated
non-mainnet-value staging, execute the real-wallet/alert/outage/PITR/72-hour drills,
and pass every signed validator. Do not deploy mainnet value until all gates close.

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
| `PHASE3_MAINNET_STARTUP_APPROVAL` | exactly `explicitly-approved` for mainnet-like processes |
| `PHASE3_RELEASE_MANIFEST` | mounted deployed manifest path |
| `PHASE3_RELEASE_MANIFEST_SHA256` | exact lowercase canonical manifest hash |
| `PHASE3_PAID_WRITES_MODE` | `disabled` initially; `canary` only after readiness; `public` only after exit approval |

Operational tuning is documented in `server/.env.example`: HTTP size/proxy, Redis
timeout, agent egress caps, RPC timeout, reconciliation interval/range/
confirmations/retries/backoff/drift, and outbox grace.

Before traffic, production startup also verifies there are no plaintext agent
secrets and at least one active/bootstrappable super admin.

## Phase 3 preparation and contract deployment

Preparation is safe to run repeatedly and cannot broadcast:

```bash
npm ci
npm ci --prefix contracts
npm run test:phase3
npm run release:prepare
npm run release:validate
npm run release:plan
```

For a real release, replace the preparation input with reviewed image digests,
Phase 2 and independent-review evidence, enabled bounded canary policy, accountable
ticket, and two distinct approvals. Recreate and validate the
`broadcast-approved` manifest from a clean frozen commit.

The contract command is inert without every guard:

```bash
PHASE3_MAINNET_BROADCAST=explicitly-approved PHASE3_RELEASE_MANIFEST=artifacts/phase3/release-manifest.json PHASE3_RELEASE_MANIFEST_SHA256=<canonical-sha256> PHASE3_RELEASE_APPROVAL_TICKET=<approved-ticket> VELOSTRA_RELEASE=<full-commit> npm --prefix contracts run deploy:robinhood -- --broadcast
```

It verifies chain 4663, manifest/ticket/release, deployer, exact constructor, token
decimals, role separation, admin code, and reproducible artifact before sending.
After confirmation:

```bash
npm run release:finalize
npm --prefix contracts run verify:robinhood
```

Store the deployed manifest and verification artifact in the evidence mount. The
verification command checks receipt, runtime code with immutable slots, settlement
token, fee, pause/solvency/successor, and role ownership. Local
`contracts/deployment.json` remains ignored and is never sufficient release evidence.

## Readiness and bounded canary

Keep `PHASE3_PAID_WRITES_MODE=disabled` while collecting the final pre-canary
snapshot:

```bash
npm --prefix server run phase3:snapshot
npm run release:readiness
```

Only a `GO` permits an operator to change mode to `canary`. Supply the exact enabled
policy hash and start timestamp. The API then enforces immutable subjects and
duration/call/wallet/total exposure inside the reservation transaction.

At the end of the bounded window:

```bash
npm --prefix server run phase3:canary-summary
npm run release:canary
```

Any failed check returns `STOP`: disable new paid writes, preserve claims, keep
reconciliation running, page the owner, and forward-repair. A pass returns
`PASS_AWAITING_OPERATOR` and `expansionAuthorized: false`. Public mode additionally
requires the exact passing decision file/hash and
`PHASE3_CANARY_EXIT_APPROVAL=explicitly-approved`.

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
