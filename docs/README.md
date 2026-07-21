# Velostra documentation

> Workspace verification refreshed 2026-07-21; latest managed public-testnet evidence
> remains the 2026-07-20 checkpoint until this local commit set is published.

Start with [JOURNEY.md](./JOURNEY.md), [STATUS.md](./STATUS.md),
[ROADMAP.md](./ROADMAP.md), and
[PHASE_4_CONTRACT.md](./PHASE_4_CONTRACT.md). Phase 0-4 repository implementation
and the public Robinhood Chain testnet checkpoint are complete. The canonical
`https://velostra.xyz/testnet` experience is connected to the managed US testnet
runtime with bounded synthetic paid writes enabled. No mainnet deployment or
real-value authorization is recorded.

| Document | Purpose |
|---|---|
| [JOURNEY.md](./JOURNEY.md) | Chronological delivery record, completed work, open gates, and ordered handoff. |
| [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md) | Redacted 2026-07-20 wallet, recovery, alert, outage, PITR, control, and regression truth. |
| [PHASE_1_HANDOFF.md](./PHASE_1_HANDOFF.md) | Historical Phase 1 baseline, evidence, and original Phase 2 entry rules. |
| [STATUS.md](./STATUS.md) | Current truth, internal-audit clearance, and mainnet prerequisites. |
| [PHASE_4_CONTRACT.md](./PHASE_4_CONTRACT.md) | Frozen versioning, lifecycle, integration, trust/privacy, and exit contract. |
| [ROADMAP.md](./ROADMAP.md) | Completed phases, release prerequisites, and ordered next work. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Authority, outbox, exactly-once flow, worker, and failures. |
| [THREAT_MODEL.md](./THREAT_MODEL.md) | Assets, actors, invariants, threats, controls, residual risks. |
| [AUDIT_READINESS.md](./AUDIT_READINESS.md) | External scope, frozen decisions, commands, findings policy. |
| [MAINNET_READINESS.md](./MAINNET_READINESS.md) | Deterministic plan-only mainnet packet, current blockers, authority boundary, and commands. |
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
7. the fail-closed mainnet readiness packet for audit, custody, operations, and approval gates;
8. guarded Phase 3 deployment/canary runtime for release authority;
9. deploy/gcp/staging.config.json plus its policy and plan tests for the selected
   US-only non-mainnet staging deployment;
10. frontend source for wallet/provider and product behavior;
11. docs for reviewed explanation and operating policy.

Behavior changes require matching tests and updates to status/domain docs. Priority
or sequencing changes require a roadmap update.

## Scope statement

The repository has passed automated and internal engineering review for Phase 0-4,
and the user-accessible testnet checkpoint is **PASS**. The canonical public frontend
is connected to the managed US testnet contract/runtime. Three verified Safe
authorities, a synthetic token and escrow, immutable signer/API/web services,
migrations, scheduled reconciliation/webhook/monitor jobs, scoped secrets, and
private Telegram delivery are active. Deep readiness is 8/8; bounded public paid
writes and user onboarding are enabled; signer funding passes; and the post-open
worker sweep reports zero unexplained drift.

The 2026-07-21 workspace release candidate completes the remaining product hardening:
active-wallet/chain session binding, synchronized auth gates, owner-scoped paid-call
recovery without resubmission, deep-readiness UI truth, bounded transaction inputs,
and explorer-linked proofs. These additions become public deployment evidence only
after owner-approved publication and post-deploy smoke.

This is not an independent audit, mainnet deployment, or real-value authorization.
The 72-hour item is recorded as `PASS_BY_OWNER_WAIVER` with execution `NOT_RUN`; no
duration telemetry is claimed. Independent review, a frozen signed mainnet release,
production custody and recovery capacity, and an explicitly authorized low-value
mainnet canary remain required. Local or testnet completion never overrides those
mainnet gates.

The tracked mainnet-readiness templates and validator now turn those prerequisites
into a SHA-256-bound packet. Its current deterministic decision is `NO_GO`; all
mainnet broadcast, canary, and expansion authorization fields are immutably false.
