# Velostra threat model

> Last verified against the workspace: 2026-07-15.
> Scope: pre-mainnet Phase 1 design freeze.

## Security objective

Velostra must never create, lose, duplicate, or hide a financial effect because an
HTTP process, database transaction, Redis instance, or RPC request failed at the
wrong moment. A browser or builder endpoint must not gain backend, signer,
governance, or treasury authority.

## Assets

1. settlement tokens held by `VelostraEscrow`;
2. builder claimable earnings and platform revenue;
3. user spendable credits and reservations in Postgres;
4. the backend `SETTLER_ROLE` key;
5. governance, treasury, and pause authority;
6. wallet-auth sessions and one-time challenges;
7. per-agent HMAC secrets;
8. durable call output, settlement attempts, event ledger, and sync cursor;
9. operator audit evidence, backups, and migration history.

Raw agent input/output may contain user-sensitive data. It is an application asset,
but it is not required for chain accounting after a result has been durably linked
to its call.

## Actors and trust boundaries

| Actor / dependency | Trusted for | Never trusted for |
|---|---|---|
| User wallet | user-approved signatures and transactions | server identity without signature verification |
| Browser provider | transporting wallet requests | private keys, final receipt truth, chain configuration |
| Builder endpoint | agent output after HMAC-authenticated request | internal network access, pricing, settlement, user balance |
| Express API | product orchestration and durable intent creation | unilateral custody or governance |
| Postgres | spendable credit and product state | token custody |
| Redis | nonce storage, rate limits, fast quotas | financial truth |
| EVM RPC | access to canonical chain data | a single unconfirmed response |
| Escrow contract | token custody and onchain liabilities | offchain user credit or agent metadata |
| Reconciliation worker | deterministic repair from chain evidence | creating new business intent |
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

### Authentication and secrets

- Challenges bind wallet, domain, URI, chain ID, nonce, issue time, and expiry.
- Redis consumes a challenge atomically; concurrent instances produce one winner.
- Production rejects memory nonce storage and Redis fail-open mode.
- Agent HMAC secrets use AES-256-GCM envelopes with key IDs and rotation overlap.
- Production startup rejects plaintext secret rows.
- Admin actions require database RBAC and produce append-only audit entries.
- The final active `SUPER_ADMIN` cannot be revoked.

## Threats and controls

| Threat | Control | Residual risk / next gate |
|---|---|---|
| Settler key compromise | least-privilege role; immediate revoke/rotate; no treasury/admin role | KMS/restricted signer and drill in Phase 2 |
| Governance compromise | multisig contract; 2-day default-admin transfer delay | multisig policy and signer roster require external review |
| Insolvent credit creation | contract liquidity guard and explicit liabilities | chosen token behavior must be audited |
| Duplicate paid settlement | onchain callId replay guard + DB uniqueness + conditional finalize | reorg simulation remains Phase 2 |
| Crash after onchain success | outbox, raw event ledger, worker, authoritative callId | catch-up time depends on RPC availability |
| Lost RPC response after broadcast | AMBIGUOUS state, reservation retention, correlated event recovery | signed-raw-tx persistence is a future resilience option |
| Live/worker race | shared conditional transition inside one DB transaction | proven by concurrent E2E |
| SSRF / DNS rebinding | pinned resolved address, blocked ranges, redirect revalidation, port/scheme policy, caps | infrastructure egress firewall still required |
| Large/slow builder response | absolute deadline, socket timeout, and byte cap | builder availability remains external |
| Auth replay / multi-instance race | Redis atomic compare-and-delete | Redis outage fails closed in production |
| Admin privilege abuse | granular roles, audit log, last-admin guard | approval quorum is not implemented |
| Secret disclosure in DB | authenticated encryption and response omission | encryption key still needs managed custody |
| Event reorg | configurable confirmation delay | no rollback engine; staging reorg drill required |
| RPC rate limit | bounded chunks, adaptive split, retry/backoff, cursor commit per range | sustained 429 extends catch-up time |
| Manual cursor misuse | retroactive scans preserve cursor unless starting exactly at next block | production RBAC around job execution still needed |
| Backup corruption | versioned migrations, pg_dump/restore comparison of exact aggregates and invariants | managed PITR must be configured and drilled |

## Abuse and privacy

- Public browsing may degrade during Redis trouble; paid execution must fail closed
  when its abuse/nonce dependency is unavailable.
- Logs must never include private keys, JWTs, HMAC plaintext, cookies, signatures,
  or raw user prompts/outputs.
- Agent input/output retention, deletion, export, and field-level encryption policy
  remain a product/privacy task before broad external beta.

## Assumptions

- The settlement token is a standard audited 6-decimal ERC-20 without rebasing,
  blacklist surprises, callbacks, or fee-on-transfer behavior.
- Initial production runs one supervised worker and one logical signer writer.
- RPC and database credentials come from a managed secret store, not repository or
  image layers.
- The contract remains undeployed until independent audit findings are closed.

## Review status

The implementation and adversarial local tests are complete for Phase 1 sections
1.1-1.3. This document is an internal threat model, not an independent audit.
External contract and focused backend review remain the final Phase 1 sign-off; see
[AUDIT_READINESS.md](./AUDIT_READINESS.md).