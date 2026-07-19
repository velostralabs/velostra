# Velostra documentation

> Last verified against the workspace and managed staging: 2026-07-19.

Start with [JOURNEY.md](./JOURNEY.md), [STATUS.md](./STATUS.md),
[ROADMAP.md](./ROADMAP.md), and
[PHASE_4_CONTRACT.md](./PHASE_4_CONTRACT.md). Phase 0-4 repository implementation
is complete and locally cleared. Phase 3 execution and closed-beta activation remain
gated on independent review, managed evidence, immutable release approval, and
explicit operator authorization; no mainnet deployment is recorded.
The static protocol preview remains live at [velostra.xyz](https://velostra.xyz/) and
separate from a deployed US-only Robinhood-testnet backend/escrow. The staging stack
is deep-readiness green with paid writes disabled; no closed beta, mainnet, or
real-value flow is live.

| Document | Purpose |
|---|---|
| [JOURNEY.md](./JOURNEY.md) | Chronological delivery record, completed work, open gates, and ordered handoff. |
| [PHASE_1_HANDOFF.md](./PHASE_1_HANDOFF.md) | Historical Phase 1 baseline, evidence, and original Phase 2 entry rules. |
| [STATUS.md](./STATUS.md) | Current truth, internal-audit clearance, and mainnet prerequisites. |
| [PHASE_4_CONTRACT.md](./PHASE_4_CONTRACT.md) | Frozen versioning, lifecycle, integration, trust/privacy, and exit contract. |
| [ROADMAP.md](./ROADMAP.md) | Completed phases, release prerequisites, and ordered next work. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Authority, outbox, exactly-once flow, worker, and failures. |
| [THREAT_MODEL.md](./THREAT_MODEL.md) | Assets, actors, invariants, threats, controls, residual risks. |
| [AUDIT_READINESS.md](./AUDIT_READINESS.md) | External scope, frozen decisions, commands, findings policy. |
| [OPERATIONS.md](./OPERATIONS.md) | Worker, incidents, one-hour catch-up, backups, secrets, successor. |
| [SECURITY.md](./SECURITY.md) | Implemented controls and remaining production gates. |
| [SMART_CONTRACT.md](./SMART_CONTRACT.md) | Roles, ABI behavior, solvency, migration, and test evidence. |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | 30 tables, money/platform invariants, nine migrations, indexes, restore. |
| [API_REFERENCE.md](./API_REFERENCE.md) | /api/v1, cursors/idempotency, builder, webhook, trust/privacy, RBAC, HMAC. |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production topology, configuration, release order, and gates. |
| [US staging runbook](../deploy/gcp/README.md) | Robinhood testnet 46630, Virginia-only providers, bounded GCP deployment, costs, secrets, and evidence order. |
| [TESTING.md](./TESTING.md) | Automated/CI matrix, money-loop, migration, and restore evidence. |
| [QUICKSTART.md](./QUICKSTART.md) | Safe local setup and verification commands. |
| [BUILDER_GUIDE.md](./BUILDER_GUIDE.md) | SDKs, revisions, probes, analytics, webhooks, HMAC, recovery, secrets. |
| [JavaScript SDK](../sdk/javascript/README.md) | Typed v1 client, retry/idempotency, signing verification. |
| [Python SDK](../sdk/python/README.md) | Dependency-free v1 client, pagination, signing verification. |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Crystal V visual system, interaction, motion, accessibility. |

## Source-of-truth order

1. `contracts/VelostraEscrow.sol` for onchain authority/state/events;
2. `server/src/db/schema.ts` and `server/drizzle` for persisted invariants;
3. `server/src/lib/gateway/settlement.ts` and `server/src/routes` for live effects;
4. `server/src/jobs/reconcile.ts` for chain repair/cursor/drift;
5. platform libraries, routes, and webhook worker for versioned interface, integration,
   moderation, privacy, and telemetry authority;
6. JavaScript and Python SDK source for public client contracts;
7. guarded Phase 3 deployment/canary runtime for release authority;
8. deploy/gcp/staging.config.json plus its policy and plan tests for the selected
   US-only non-mainnet staging deployment;
9. frontend source for wallet/provider and product behavior;
10. docs for reviewed explanation and operating policy.

Behavior changes require matching tests and updates to status/domain docs. Priority
or sequencing changes require a roadmap update.

## Scope statement

The repository has passed automated and internal engineering review for Phase 0-4,
which clears continued non-mainnet development. The static protocol preview is a
verified public deployment, and a separate managed US testnet contract/runtime is
also live. Three verified Safe authorities, a synthetic token and escrow, immutable
signer/API/web services, migration, scheduled jobs, scoped secrets, and private
Telegram delivery are active; deep readiness passes and paid writes remain disabled.
This is not an independent audit, closed-beta approval, mainnet deployment, or
real-value authorization. Real-wallet/repair evidence, full alert lifecycle,
rotation/pause/compromise drills, load/outage/PITR, and 72-hour soak remain pending.
Local completion never overrides activation gates.
