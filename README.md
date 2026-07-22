<p align="center">
  <a href="https://velostra.xyz">
    <img src="./docs/assets/velostra-hero.svg" width="100%" alt="Velostra - Verified AI Execution Market" />
  </a>
</p>

<h1 align="center">Velostra</h1>

<p align="center">
  <strong>The verified execution market for AI agents.</strong><br />
  Deploy specialized intelligence, price every call, and route earnings through recoverable onchain settlement.
</p>

<p align="center">
  <a href="https://velostra.xyz/testnet"><img alt="Public testnet: live" src="https://img.shields.io/badge/public_testnet-live-c9ff5f?style=flat-square&labelColor=090c11" /></a>
  <a href="./docs/STATUS.md"><img alt="Status: pre-mainnet" src="https://img.shields.io/badge/status-pre--mainnet-c9ff5f?style=flat-square&labelColor=090c11" /></a>
  <a href="./docs/SMART_CONTRACT.md"><img alt="EVM settlement" src="https://img.shields.io/badge/settlement-EVM-8fe9dc?style=flat-square&labelColor=090c11" /></a>
  <a href="./docs/ARCHITECTURE.md"><img alt="Builder share: 90%" src="https://img.shields.io/badge/builder_share-90%25-d6b684?style=flat-square&labelColor=090c11" /></a>
  <a href="./.github/workflows/ci.yml"><img alt="Product verification" src="https://img.shields.io/github/actions/workflow/status/velostralabs/velostra/ci.yml?branch=main&style=flat-square&label=verification&labelColor=090c11" /></a>
</p>

---

## Public deployment

The public Robinhood Chain testnet is live at
[velostra.xyz/testnet](https://velostra.xyz/testnet). Netlify builds `main` with
Node.js 22, runs `npm run build`, and publishes only `dist/` through the tracked
[`netlify.toml`](./netlify.toml). `www.velostra.xyz` redirects to the TLS-protected
apex domain.

The production frontend is bound to the managed US testnet API, verified synthetic
settlement token, and VelostraEscrow on chain 46630. Users can connect MetaMask or a
compatible EIP-6963 wallet, obtain test ETH from the official faucet, mint bounded
synthetic USDG, explore approved agents, execute paid test calls, inspect receipts,
and exercise claims. Protected views are bound to the active wallet and chain;
ambiguous paid calls recover by polling the original owner-scoped call instead of
submitting a second charge. The live badge requires deep dependency/worker readiness,
and confirmed settlement actions retain explorer proof. No real funds or mainnet
value are used.

## Execution should leave evidence

Most AI marketplaces stop at discovery. Velostra continues through execution,
pricing, settlement, and recovery. Every paid call gets a durable database identity
and a correlated `bytes32` identifier onchain, so confirmed chain evidence can
repair the exact database row after process, RPC, or database failure.

| Product layer | What Velostra provides |
|---|---|
| **Experience** | Crystal V identity, premium marketplace, agent pages, user dashboard, builder and governance consoles, explicit MetaMask/injected wallet access. |
| **Gateway** | Bound EIP-191 auth, HMAC-signed agent requests, SSRF-safe egress, quotas, rate limits, and receipt verification. |
| **Settlement** | Role-separated 6-decimal ERC-20 escrow with collateral guards, deterministic fee routing, pause, rotation, and successor controls. |
| **Recovery** | Credit reservation, durable outbox, four-event indexer, persistent cursor, idempotent backfill, ambiguity recovery, and drift warnings. |
| **Platform** | Versioned API, typed JS/Python SDKs, immutable agent revisions, analytics, notifications, reliable signed webhooks, moderation, privacy, and telemetry governance. |
| **Release safety** | Immutable release identity, inert deployment planning, deployment verification, deterministic readiness, serialized low-value canary, and non-destructive stop controls. |

<p align="center">
  <img src="./docs/assets/settlement-flow.svg" width="100%" alt="Animated Velostra settlement and reconciliation flow" />
</p>

## Product surface

- `/` - institutional landing experience with adaptive WebGL execution artifact;
- `/system`, `/proof`, `/economics` - semantic product sections;
- `/marketplace` - query-synchronized agent discovery;
- `/agents/:slug` - agent details and verified execution;
- `/dashboard` - credits, top-up, reservations, and call history;
- `/builder` - registration, agent submission, secret lifecycle, earnings, claim;
- `/admin` - RBAC moderation, roles, audit, and statistics;
- `/docs` - in-product protocol overview;
- `/testnet` - public testnet onboarding, faucet, synthetic mint, and execution path.

The managed public testnet includes four deterministic demo playbooks in `/marketplace`: Flowbook
Trader, Wallet Sentinel, TokenScope, and Contract Lens. A scenario link uses
`/agents/:slug?scenario=:id` to prefill a safe synthetic prompt; it never runs or
charges automatically. The stateless service returns correlated public-testnet proof,
declares input non-retention, and rejects unknown profile paths. The immutable US
testnet runtime, idempotent catalog seed, live browser catalog, and a dedicated
MetaMask paid-call smoke passed on 2026-07-22.


Wallet access always uses an explicit picker. MetaMask is first-class, while
EIP-6963/injected discovery keeps Rainbow, Coinbase, and compatible browser wallets
available without silently selecting a provider.

## Architecture

```mermaid
flowchart LR
    Wallet["User / builder wallet"] --> Web["React experience"]
    Web --> API["Express gateway"]
    API --> Agent["Builder agent"]
    API --> DB[(PostgreSQL)]
    API --> Redis[(Redis)]
    Web --> Escrow["VelostraEscrow"]
    API --> Escrow
    Worker["Reconciliation worker"] --> RPC["EVM RPC"]
    RPC --- Escrow
    Worker --> DB
    Hooks["Webhook worker"] --> DB
    Hooks --> BuilderHook["Builder webhook"]
```

Authority is intentionally split:

- escrow owns token custody and onchain liabilities;
- Postgres owns spendable/reserved call credit and product state;
- confirmed events are durable recovery evidence;
- Redis owns no financial truth;
- governance, settler, treasury, and pause guardian are separate roles.

Read [Architecture](./docs/ARCHITECTURE.md) and the
[Threat model](./docs/THREAT_MODEL.md).

## Exactly-once financial effects

A chain and Postgres cannot share one transaction. Velostra uses explicit durable
states:

1. atomically create a `PROCESSING` call, reserve exact credit, and create a
   `PREPARED` settlement attempt;
2. call the builder without holding a database transaction;
3. persist the result and move the attempt to `READY`;
4. broadcast `creditBuilderEarnings(builder,gross,keccak256(call_id))`;
5. persist a returned hash before receipt polling, or keep a hashless
   `AMBIGUOUS` attempt when the broadcast response is lost;
6. let live path and worker compete through the same conditional
   `PROCESSING -> SUCCESS` transition;
7. allow only the winner to debit, credit, update stats, and insert the ledger;
8. reconcile raw events unique by `(tx_hash, log_index)` and report chain/DB drift.

The expanded local-EVM suite proves normal flow, missed deposit/claim reports,
post-chain DB rollback, receipt timeout, lost broadcast response, retroactive scan,
and concurrent live/worker finalization.

## Repository

```text
.
|-- src/                  React + TypeScript product experience
|-- server/               Express API, exact ledger, outbox, migrations, worker
|-- contracts/            VelostraEscrow, MockUSD, build/deploy/test scripts
|-- deploy/               Portable topology plus US-only managed staging automation
|-- sdk/                  Typed JavaScript and Python platform clients
|-- docs/                 Journey, status, architecture, security, audit, operations
|-- public/               Brand and static delivery assets
`-- .github/              CI and repository metadata
```

Only product source, public docs/tests/examples, and brand assets belong here.
Credentials, `.env`, local paths, dumps, deployment artifacts, caches, and generated
builds are excluded.

## Run locally

Requirements: Node.js 22+, npm, PostgreSQL 14+, and Redis 7 for the shared auth/
rate path.

```bash
# API
cp server/.env.example server/.env
npm install --prefix server
npm --prefix server run db:migrate
npm --prefix server run dev

# web - separate terminal
cp .env.example .env
npm install
npm run dev
```

Defaults: web `http://localhost:5173`, API health
`http://localhost:8787/health`. See [Quickstart](./docs/QUICKSTART.md).

## Reconciliation

```bash
npm --prefix server run reconcile
npm --prefix server run reconcile -- --from-block=123456 --to-block=125000
npm --prefix server run reconcile:worker
```

Normal scans advance a persistent confirmation-delayed cursor. Retroactive scans
are idempotent and cannot move that cursor over an unscanned gap. RPC ranges are
bounded, retried with backoff, and adaptively split.

## Verify

```bash
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
npm --prefix server run test:authority
npm --prefix server run test:resilience
npm --prefix server run test:observability
npm --prefix server run test:phase3-canary
npm --prefix server run test:admin-policy
npm --prefix server run test:money-unit

npm test --prefix contracts

# disposable migrated PostgreSQL
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm --prefix server run test:observability-db
npm --prefix server run test:phase3-canary-db
npm run test:phase4-db
npm --prefix server run test:money
```

CI additionally performs production dependency audits, browser/accessibility/
performance verification, evidence-validator tamper tests, and PostgreSQL
dump/restore verification. See [Testing](./docs/TESTING.md).

Guarded Phase 2 staging runners are available only for an approved isolated
environment:

```bash
PHASE2_DRILL_APPROVED=isolated-staging-only \
PHASE2_BASE_URL=https://staging.example \
PHASE2_EXPECTED_ENVIRONMENT=staging \
PHASE2_SESSION_COOKIE='<synthetic-session-cookie>' \
PHASE2_AGENT_SLUG=<synthetic-agent> npm run phase2:load

PHASE2_SOAK_APPROVED=isolated-staging-72h \
PHASE2_BASE_URL=https://staging.example \
PHASE2_EXPECTED_ENVIRONMENT=staging \
PHASE2_METRICS_TOKEN='<managed-token>' \
PHASE2_SESSION_COOKIE='<synthetic-session-cookie>' \
PHASE2_AGENT_SLUG=<synthetic-agent> \
PHASE2_WORKER_RESTART_EVIDENCE_PATH=<restart.json> \
PHASE2_FINDINGS_EVIDENCE_PATH=<findings.json> npm run phase2:soak

npm run phase2:evidence -- --manifest=artifacts/phase2/evidence-manifest.json
```

The load and soak commands require their documented approval sentinels. The final
validator hashes every required artifact and fails closed if evidence is missing,
tampered, cross-release, or unsigned.

## US-only managed staging

The selected low-cost staging path uses Robinhood testnet chain 46630 and Virginia
regions only: GCP us-east4, Neon aws-us-east-1, and Upstash GCP us-east4. It includes
guarded bootstrap, HSM-backed secp256k1 signing, immutable image builds, a private
signer, bounded web/API services, and staggered one-task jobs:

    powershell -NoProfile -File deploy/gcp/test-staging-policy.ps1
    powershell -NoProfile -File deploy/gcp/test-deployment-plan.ps1
    powershell -NoProfile -File deploy/gcp/bootstrap-staging.ps1 -ProjectId velostra-production

The applied US foundation, managed data plane, scoped secrets, Safe authorities,
synthetic token, VelostraEscrow, immutable signer/API/web services, migrations, and
scheduled jobs are live on Robinhood Chain testnet. The canonical Netlify frontend
is connected to the managed API. Deep readiness is 8/8, signer gas is healthy,
anonymous signer access is rejected, and bounded public synthetic paid writes are
enabled. See the [US staging runbook](./deploy/gcp/README.md). This path cannot
target mainnet.

## Controlled release tooling

Phase 3 repository preparation is complete but mainnet execution is gated:

```bash
# creates/verifies immutable preparation evidence; never broadcasts
npm run release:prepare
npm run release:validate
npm run release:plan

# after an authorized deployment, collect and evaluate evidence
npm --prefix server run phase3:snapshot
npm run release:readiness
npm --prefix server run phase3:canary-summary
npm run release:canary
```

Mainnet-like startup requires the exact deployed manifest. Paid writes default to
`disabled`. Canary admission is bounded and serialized in Postgres; the passing
decision still cannot authorize expansion without a separate operator approval.
Contract broadcast additionally requires `--broadcast` and the explicit release
sentinel. See [Deployment](./docs/DEPLOYMENT.md).

## Documentation

| Read | Purpose |
|---|---|
| [Journey](./docs/JOURNEY.md) | Chronological delivery record, current checkpoint, open gates, and ordered next work. |
| [Phase 1 handoff](./docs/PHASE_1_HANDOFF.md) | Historical verified Phase 1 baseline and original Phase 2 entry rules. |
| [Phase 4 contract](./docs/PHASE_4_CONTRACT.md) | Versioning, lifecycle, webhook, trust/privacy, and exit compatibility baseline. |
| [Status](./docs/STATUS.md) | Current implementation truth, audit clearance, and mainnet prerequisites. |
| [Roadmap](./docs/ROADMAP.md) | Phase completion and ordered next work. |
| [Architecture](./docs/ARCHITECTURE.md) | Authority, outbox, exactly-once flow, worker. |
| [Threat model](./docs/THREAT_MODEL.md) | Assets, threats, controls, residual risks. |
| [Audit readiness](./docs/AUDIT_READINESS.md) | External scope, frozen decisions, findings policy. |
| [Operations](./docs/OPERATIONS.md) | Incidents, catch-up, backups, secrets, successor. |
| [Smart contract](./docs/SMART_CONTRACT.md) | Roles, solvency, migration, ABI behavior. |
| [API](./docs/API_REFERENCE.md) | HTTP routes, RBAC, stable errors, HMAC. |
| [Security](./docs/SECURITY.md) | Implemented controls and release gates. |
| [Deployment](./docs/DEPLOYMENT.md) | Production topology and release order. |
| [US staging](./deploy/gcp/README.md) | Virginia-only testnet stack, cost policy, secrets, deployment, and evidence sequence. |

## Status

The complete chronological handoff - what shipped, what remains external, and the
exact next sequence - is maintained in [Journey](./docs/JOURNEY.md).

Phase 0-4 repository preparation and the public testnet checkpoint are complete.
The canonical Netlify frontend is connected to the immutable US-only Robinhood Chain
testnet runtime: three verified Safe authorities, a verified synthetic token and
escrow, private signer, API, migrations, reconciliation/webhook/monitor jobs,
staggered Scheduler triggers, scoped secrets, and private Telegram alert delivery.
Deep readiness is 8/8, bounded public paid writes are enabled, signer gas satisfies
the operational gate, and a post-open worker sweep finished with zero unexplained
drift.

The 72-hour duration requirement was accepted for this checkpoint by explicit owner
waiver: disposition `PASS_BY_OWNER_WAIVER`, execution `NOT_RUN`. No 72-hour telemetry
is claimed. No mainnet deployment or real-value authorization is recorded. Mainnet
still requires independent contract/backend review, a frozen signed release packet,
production custody/backup/alert capacity, and a separately authorized low-value
canary. A passing canary returns `PASS_AWAITING_OPERATOR` and never expands traffic by
itself.

## Security

Never post private keys, tokens, personal data, private prompts, or exploit details
in a public issue. Use GitHub's private security advisory flow for the repository.

Public metadata uses only the Velostra brand and US locale. It does not claim a
legal office or incorporation address. Personal names, personal mailbox addresses,
operator locations, local filesystem paths, account identifiers, and credentials
must never be committed or published.

---

<p align="center">
  <sub>Designed and engineered by <strong>Velostra</strong> &middot; Verified execution, recoverable settlement.</sub>
</p>
