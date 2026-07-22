# Velostra threat model

> Threat review refreshed 2026-07-22 against current public-testnet trust boundaries,
> recovery paths, platform controls, and isolated mainnet-preparation inputs.
> Phase state: Phase 0-4 repository preparation is complete and has passed internal
> engineering/CI audit; continued development is clear. Managed-staging evidence
> remains a mainnet release prerequisite.
> Scope: Phase 1-2 foundation, Phase 3 release controls, and Phase 4 platform/integration controls.
> The 2026-07-20 wallet/recovery, RPC fallback, private-alert, timed-outage, PITR, and
> read-only control results are recorded in [MANAGED_EVIDENCE.md](./MANAGED_EVIDENCE.md).
> They do not replace destructive fault testing, custody approval, or independent review.

## Security objective

Velostra must never create, lose, duplicate, or hide a financial effect because an
HTTP process, database transaction, Redis instance, or RPC request failed at the
wrong moment. A browser or builder endpoint must not gain backend, signer,
governance, or treasury authority.

## Assets

1. settlement tokens held by `VelostraEscrow`;
2. builder claimable earnings and platform revenue;
3. user spendable credits and reservations in Postgres;
4. restricted remote-signer authority, authentication, nonce, and gas;
5. governance, treasury, and pause authority;
6. wallet-auth sessions and one-time challenges;
7. per-agent HMAC secrets;
8. durable call output, settlement attempts, event ledger, and sync cursor;
9. operator audit evidence, backups, and migration history;
10. immutable release manifest, approval packet, image digests, and canary exposure ledger;
11. API idempotency state, immutable agent revisions, notifications, and analytics;
12. webhook subscription secrets, exact payloads, delivery/attempt/dead-letter history;
13. moderation evidence/history, privacy requests/exports, and telemetry policy registry;
14. canonical domain, static frontend bundle, social metadata, and deployment identity.

Raw agent input/output may contain user-sensitive data. It is an application asset,
but it is not required for chain accounting after a result has been durably linked
to its call.

## Actors and trust boundaries

| Actor / dependency | Trusted for | Never trusted for |
|---|---|---|
| Netlify static hosting/CDN | delivering the reviewed public bundle and domain TLS | backend authority, secrets, API readiness, financial truth |
| User wallet | user-approved signatures and transactions | server identity without signature verification |
| Browser provider | transporting wallet requests | private keys, final receipt truth, chain configuration |
| Builder endpoint | agent output after HMAC-authenticated request | internal network access, pricing, settlement, user balance |
| Express API | product orchestration and durable intent creation | unilateral custody or governance |
| Postgres | spendable credit and product state | token custody |
| Redis | nonce storage, rate limits, fast quotas | financial truth |
| EVM RPC | access to canonical chain data | a single unconfirmed response |
| Escrow contract | token custody and onchain liabilities | offchain user credit or agent metadata |
| Reconciliation worker | deterministic repair from chain evidence | creating new business intent |
| Webhook worker | delivering existing stable events with conditional ownership | inventing events or authorizing business transitions |
| Webhook receiver | acknowledging delivery and deduplicating event IDs | platform financial/product authority |
| Governance multisig | delayed role administration and unpause | hot-path settlement |
| Settler signer | correlated earnings credit only | fee, pause, treasury, default admin |
| Treasury | platform withdrawal and successor liquidity migration | settlement, pause, fee, admin |
| Pause guardian | emergency pause only | unpause or fund movement |

## Security invariants

### Contract

- `tokenBalance >= totalBuilderLiability + platformRevenueAvailable` before and
  after every settlement, claim, withdrawal, and migration.
- A non-zero `callId` can settle once.
- Only `SETTLER_ROLE` can create new earnings liabilities.
- Claims stay available while paused.
- Declaring a successor permanently disables deposits and new settlements.
- Liquidity migration can transfer only `balance - totalLiabilities` to the declared
  successor. Existing liabilities remain fully backed in the predecessor.
- The token is immutable, exactly 6 decimals, and fee-on-transfer deposits fail.

### Database and chain boundary

- Money decisions use canonical 6-decimal integer arithmetic, not JS float.
- `balance_usd >= 0`, `reserved_usd >= 0`, and `reserved_usd <= balance_usd`.
- Paid intent, reservation, and outbox row commit before builder HTTP or chain RPC.
- No SQL transaction remains open during builder execution or receipt waiting.
- Live request and worker share conditional `PROCESSING -> SUCCESS`; only the
  winner may apply debit, credit, agent totals, and ledger insertion.
- Raw events are unique by `(tx_hash, log_index)`; transaction and claim hashes are
  unique; one paid call has one `onchain_call_id` and one ledger link.
- A correlated `EarningsCredited` event with exact builder and amounts may replace
  an ambiguous candidate hash. The successful contract event is authoritative.
- Manual retroactive scans never jump the persistent normal catch-up cursor.
- Mainnet paid writes default disabled and every canary admission is bound to the exact release, manifest, policy, subject, and amount.
- Canary capacity read/check/insert is serialized in the same transaction as call/reservation/outbox creation.
- Claims and reconciliation remain live during a canary stop; rollback is forward repair, never destructive database rollback.
- Idempotency keys bind actor/operation/fingerprint; expired uncertain PROCESSING
  state cannot be reclaimed blindly.
- Published revisions are immutable; every call records its execution revision.
- Webhook events/deliveries are unique, attempts append history, and only a conditional
  worker claim or audited dead-letter replay can transition delivery state.
- Personal deletion cannot remove required financial, settlement, security, or audit
  evidence; telemetry cannot collect prohibited/unclassified fields.

### Authentication and secrets

- Challenges bind wallet, domain, URI, chain ID, nonce, issue time, and expiry.
- Redis consumes a challenge atomically; concurrent instances produce one winner.
- Production rejects memory nonce storage and Redis fail-open mode.
- Protected browser state requires the server session wallet to match the active
  account on the configured chain; account/chain drift hides prior wallet data.
- Agent HMAC secrets use AES-256-GCM envelopes with key IDs and rotation overlap.
- Production startup rejects plaintext secret rows.
- Admin actions require database RBAC and produce append-only audit entries.
- The final active `SUPER_ADMIN` cannot be revoked.

## Threats and controls

| Threat | Control | Residual risk / next gate |
|---|---|---|
| Settler key compromise | no raw production key; restricted remote signer; least privilege; revoke/rotate runbook | managed KMS rotation/compromise drill evidence pending |
| Governance compromise | canonical Safe contract, disjoint 2-of-3 testnet owners, live owner/threshold/version checks, 2-day default-admin transfer delay | synthetic testnet custody is single-operator; accountable mainnet owners and external review remain mandatory |
| Insolvent credit creation | contract liquidity guard and explicit liabilities | chosen token behavior must be audited |
| Duplicate paid settlement | onchain callId replay guard + DB uniqueness + conditional finalize + local reorg/race drill | deep-reorg behavior beyond confirmation window requires incident handling |
| Crash after onchain success | outbox, raw event ledger, worker, authoritative callId | catch-up time depends on RPC availability |
| Lost RPC response after broadcast | AMBIGUOUS state, reservation retention, correlated event recovery | signed-raw-tx persistence is a future resilience option |
| Live/worker race | shared conditional transition inside one DB transaction | proven by concurrent E2E |
| SSRF / DNS rebinding | pinned resolved address, blocked ranges, redirect revalidation, port/scheme policy, caps | infrastructure egress firewall still required |
| Large/slow builder response | absolute deadline, socket timeout, and byte cap | builder availability remains external |
| Auth replay / multi-instance race | Redis atomic compare-and-delete | Redis outage fails closed in production |
| Stale session after wallet/chain switch | active-wallet/chain binding, immediate protected-state gate, synchronized auth refresh | a compromised browser/session remains an endpoint-security concern |
| Ambiguous paid-call browser retry | one idempotency key plus owner-scoped status polling; no automatic resubmission | user must keep wallet/session access to observe private recovery state |
| Admin privilege abuse | granular roles, audit log, last-admin guard | approval quorum is not implemented |
| Secret disclosure in DB | authenticated encryption, response omission, managed-injection startup guard | actual managed custody/rotation evidence pending |
| Event reorg | confirmation-depth policy and canonical replacement drill | no rollback engine beyond confirmed window; managed-chain policy must be approved |
| RPC rate limit | primary/fallback endpoints, bounded chunks, adaptive split, retry/backoff, cursor commit per range | failure across every provider extends catch-up time |
| Manual cursor misuse | retroactive scans preserve cursor unless starting exactly at next block | production RBAC around job execution still needed |
| Backup corruption | versioned migrations, pg_dump/restore comparison of exact aggregates and invariants | managed PITR must be configured and drilled |
| Release manifest tamper/cross-release replay | canonical self-hash, clean commit, file/image/policy/evidence hashes, stage-specific validation | operator custody of approved artifacts remains external |
| Canary cap race | transaction-scoped advisory lock plus durable unique admission row before reservation | initial design intentionally serializes one release/policy admission stream |
| Unsafe canary expansion | disabled default, bounded window/subjects/exposure, automatic STOP, hash-bound PASS evidence, separate approval | human approval and real operator response remain external |
| Duplicate/conflicting API retry | durable actor/operation/fingerprint idempotency; exact replay; indeterminate fail-closed state | clients must inspect state before new intent after indeterminate response |
| Revision publish race/history rewrite | advisory serialization, conditional DRAFT publish, immutable published rows | authorized content quality still needs moderation |
| Webhook forgery/replay | one-time secret, exact-body HMAC, timestamp, stable event ID | receiver clock/secret custody/idempotency remain external |
| Webhook endpoint outage | durable attempt history, bounded retry, dead-letter, audited replay | delivery SLO depends on receiver/network |
| Moderation race/evidence leak | classified bounded evidence, conditional transitions, append-only actions, RBAC/audit | human decision quality and legal review remain external |
| Privacy/telemetry overcollection | allowlist/classification/retention/owner controls, prohibited-field fail closed, anonymization | managed storage access and jurisdictional policy require review |

## Abuse and privacy

- Public browsing may degrade during Redis trouble; paid execution and auth-sensitive
  operations fail closed when required abuse/nonce dependencies are unavailable.
- Logs and telemetry must never include private keys, JWTs, HMAC/webhook plaintext
  secrets, cookies, signatures, raw private prompts, or raw sensitive outputs.
- Report evidence is classified and bounded. Privacy export/delete has explicit
  workflow, retained-evidence policy, anonymization, RBAC, audit, and notification.
- Telemetry requires registered classification, purpose, owner, retention, and
  enabled state; prohibited or unclassified fields are rejected.

## Assumptions

- The settlement token is a standard audited 6-decimal ERC-20 without rebasing,
  blacklist surprises, callbacks, or fee-on-transfer behavior.
- Initial production runs one supervised worker and one logical restricted remote-signer writer.
- RPC and database credentials come from a managed secret store, not repository or
  image layers.
- No mainnet or real-value contract may deploy until independent audit findings and
  accountable governance ownership are closed. The live zero-value chain-46630
  deployment uses synthetic 2-of-3 Safe custody and does not satisfy that release gate.
- The public Netlify preview contains no managed API or contract build values and is not
  treated as an activated product runtime.

## Review status

Phase 0-4 repository controls/adversarial tests have passed internal
engineering/CI review. This document is still an internal threat model, not an
independent audit. Managed-staging evidence and independent contract/focused-backend
review remain mandatory before real-value/mainnet release, but do not block continued
development; Phase 3 execution remains gated; see [STATUS.md](./STATUS.md) and
[AUDIT_READINESS.md](./AUDIT_READINESS.md).
