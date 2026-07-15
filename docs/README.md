# Velostra documentation

> Last verified against the workspace: 2026-07-15.

Start with [STATUS.md](./STATUS.md), then [ROADMAP.md](./ROADMAP.md). Phase 1 code is
locally complete; independent audit remains the release gate. No mainnet deployment
is recorded.

| Document | Purpose |
|---|---|
| [STATUS.md](./STATUS.md) | Current truth, evidence, and blockers. |
| [ROADMAP.md](./ROADMAP.md) | Ordered phases and granular Phase 1 completion. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Authority, outbox, exactly-once flow, worker, and failures. |
| [THREAT_MODEL.md](./THREAT_MODEL.md) | Assets, actors, invariants, threats, controls, residual risks. |
| [AUDIT_READINESS.md](./AUDIT_READINESS.md) | External scope, frozen decisions, commands, findings policy. |
| [OPERATIONS.md](./OPERATIONS.md) | Worker, incidents, one-hour catch-up, backups, secrets, successor. |
| [SECURITY.md](./SECURITY.md) | Implemented controls and remaining production gates. |
| [SMART_CONTRACT.md](./SMART_CONTRACT.md) | Roles, ABI behavior, solvency, migration, and test evidence. |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | 17 tables, money/outbox invariants, migrations, indexes, restore. |
| [API_REFERENCE.md](./API_REFERENCE.md) | Current HTTP routes, RBAC, errors, and HMAC protocol. |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production topology, configuration, release order, and gates. |
| [TESTING.md](./TESTING.md) | Automated/CI matrix, money-loop, migration, and restore evidence. |
| [QUICKSTART.md](./QUICKSTART.md) | Safe local setup and verification commands. |
| [BUILDER_GUIDE.md](./BUILDER_GUIDE.md) | Builder onboarding, HMAC, egress, recovery, secret lifecycle. |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Crystal V visual system, interaction, motion, accessibility. |

## Source-of-truth order

1. `contracts/VelostraEscrow.sol` for onchain authority/state/events;
2. `server/src/db/schema.ts` and `server/drizzle` for persisted invariants;
3. `server/src/lib/gateway/settlement.ts` and `server/src/routes` for live effects;
4. `server/src/jobs/reconcile.ts` for chain repair/cursor/drift;
5. frontend source for wallet/provider and product behavior;
6. docs for reviewed explanation and operating policy.

Behavior changes require matching tests and updates to status/domain docs. Priority
or sequencing changes require a roadmap update.

## Scope statement

Local passing tests do not equal an independent audit or production approval.
Managed infrastructure, KMS, alert delivery, real-wallet automation, load/chaos/
reorg evidence, and staging soak are explicitly Phase 2.