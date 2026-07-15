## What changed

Describe the product behavior, authority boundary, schema, or invariant changed by
this pull request.

## Verification

- [ ] Frontend lint/build passed when affected
- [ ] Backend build and relevant security/unit suites passed
- [ ] Contract tests passed when contract/ABI/deployment behavior changed
- [ ] `db:check`, fresh/upgrade migration, and restore impact were considered
- [ ] Paid-call reservation/outbox/reconciliation failure paths were considered
- [ ] Financial arithmetic, idempotency, and live/worker race safety were considered
- [ ] Threat model, status, roadmap, and domain documentation were updated
- [ ] Phase 1 baseline/re-review impact or Phase 2 exit evidence was recorded when relevant
- [ ] No secrets, personal data, `.env`, dumps, build output, or local paths were added

## Risk and rollback

Describe security, settlement, migration, chain irreversibility, operational alerts,
and rollback implications. A database/application rollback never reverses a
confirmed chain effect; state how reconciliation remains active.

## External review

If this changes the frozen Phase 1 contract or security scope, state whether
re-review is required and update `docs/AUDIT_READINESS.md` plus
`docs/PHASE_1_HANDOFF.md`. Phase 2 work must name the affected roadmap exit evidence.
