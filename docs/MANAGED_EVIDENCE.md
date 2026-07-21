# Managed staging evidence

> Evidence captured: 2026-07-20.
> Scope: isolated US-only Robinhood testnet staging. This document records redacted
> operational truth; raw provider identifiers, wallet addresses, transaction hashes,
> credentials, and private operator identity remain below ignored artifacts.

## Current decision

The public Robinhood Chain testnet checkpoint is **PASS**. Bounded synthetic paid
writes are enabled at the canonical user surface; no mainnet or real-value authority
is implied. Raw provider identifiers, wallet addresses, transaction hashes,
credentials, and private operator identity remain outside tracked files.

| Evidence lane | Result | What it proves |
|---|---|---|
| Skipped-report reconciliation | PASS | A confirmed direct deposit missing from Postgres is backfilled from chain events without a user report. |
| Bounded real-wallet money path | PASS with reconciled completion | The synthetic top-up/paid-call/claim path reached exact chain and database state with idempotent recovery. |
| RPC fallback and repair | PASS | A primary-RPC fault fails over and normal reconciliation resumes without skipped ranges. |
| Private alert lifecycle | PASS | A critical backup-stale alert reached private Telegram, was acknowledged, healed, and resolved. |
| Provider-native PITR | PASS | A disposable past-point branch matched required tables, migrations, aggregates, constraints, and indexes. |
| Operator control readiness | PASS | Safe, role, signer-isolation, solvency, alert, region, and fail-closed checks are live and redacted. |
| One-hour reconciliation outage | PASS | Catch-up reached safe head with zero duplicate money, pending work, skipped range, or drift; scheduling returned enabled. |
| Public testnet opening | PASS | Immutable release, signer gas, deep readiness, bounded policy, live onboarding, and post-open repair/delivery/monitoring passed. |
| Minimum 72-hour soak | PASS_BY_OWNER_WAIVER | Execution `NOT_RUN`; explicit owner waiver accepted this checkpoint; no duration telemetry is claimed. |
| Independent third-party audit | NOT PERFORMED | No independent security or contract audit is claimed; required before mainnet. |

## Money and recovery truth

The durable direct-deposit proof deliberately omitted the top-up report endpoint. The
reconciliation worker decoded the confirmed event, created the missing Postgres
record, advanced only the confirmation-safe cursor, and remained a no-op on replay.

The bounded MetaMask canary used synthetic testnet value and a single approved
synthetic agent. The paid call and the builder claim were recovered to exact chain and
database state after the normal browser flow did not observe its expected terminal UI
state. The superseding read-only verifier proves one completed claim, one matching
chain receipt/event, exact builder totals, and disabled paid writes. The earlier
browser wrapper artifacts are intentionally retained with their failed UI assertion;
they are not rewritten into false passes.

The restricted signer was refilled from the official testnet faucet and now satisfies
the bounded operational gas target. Public opening rechecked this evidence before
changing paid-write mode; no signer address or source identity is tracked here.

## Alert and operator truth

The private Telegram channel has retained evidence for the complete injected
`backup_stale` lifecycle: critical creation, redacted delivery, named
acknowledgement, healthy backup heartbeat, and automatic resolution in timestamp
order. No bot token, channel identifier, or operator identity is tracked.

The read-only operator-control collector refreshed all three canonical Safe 1.4.1
2-of-3 authorities and verified disjoint owner policy, settlement signer isolation,
escrow role separation, unpaused state, solvency, private-alert evidence, US region,
testnet chain, bounded public-write policy, and fail-closed control state.

Secret rotation, Safe owner rotation, pause/unpause, and compromise recovery were not
broadcast. Their evidence flags remain false because those mutations require a
separate multi-operator custody approval. Readiness is PASS; live custody mutation is
not claimed.

## Provider-native restore truth

Neon history retention is currently six hours. The drill created a disposable
point-in-time branch in AWS us-east-1, connected to source and restored databases only
inside the authenticated operator session, and compared 30 public tables, nine
migrations, all row counts, financial aggregates, critical constraints, and indexes.
Every comparison passed; the integrity comparison took 12,059 ms. The disposable
branch was deleted immediately after verification. Connection strings were never
printed or written to tracked files.

## One-hour outage truth

The reconciliation Scheduler remained paused for 3,610,626 ms. Normal managed
reconciliation then reached the confirmation-safe target in 7,225 ms with zero
skipped ranges, duplicate debit/credit records, pending chain events, recoverable
outbox rows, or unexplained drift. The runner resumed Scheduler in `finally`, and a
separate provider-state read confirmed it is `ENABLED`. This proves a timed
reconciliation-schedule outage, not a destructive API/Postgres/Redis outage.

## Dependency and regression truth

The final regression includes web lint/build, browser accessibility/visual/layout/
routing/wallet/performance gates, server build/config/auth/SSRF/HTTP/secrets/signer/
KMS/authority/observability/resilience/money-unit tests, Phase 3, Phase 4 SDK/platform/
RBAC, contract E2E, staging deployment-policy tests, social assets, and privacy gates.

The server production dependency audit reports zero vulnerabilities. The web audit
retains six Moderate entries from the MetaMask `uuid` tree; the committed reachability
check confirms only `uuid.v4()` without caller buffers is used, so the affected
v3/v5/v6 buffer path is not reachable today. The contract package has an empty
production dependency tree. Ganache advisories belong to its test-only bundled
toolchain and do not ship in escrow bytecode or a production Node runtime.

The database-destructive money-loop suite was not pointed at managed staging. Its
current end-to-end result remains the previously retained CI/disposable-Postgres and
managed reconciliation evidence; this run repeated all safe unit, contract, browser,
and live read-only checks.

## Remaining mainnet release gates

- complete independent contract and focused backend review;
- freeze and sign the reviewed commit, image digests, deployment/constructor policy,
  production authorities, backup/restore capacity, alert ownership, and release packet;
- execute custody mutations only with separate named multi-operator approval;
- deploy mainnet with paid writes disabled and capture deterministic readiness;
- execute only a separately authorized low-value allowlisted mainnet canary;
- keep real value disabled until a distinct accountable expansion decision.

The 72-hour disposition is `PASS_BY_OWNER_WAIVER` with execution `NOT_RUN`; it is an
owner decision for the testnet checkpoint and contains no duration telemetry.
