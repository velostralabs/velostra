# Server test quick reference

> Last verified against server scripts and reconciliation coverage: 2026-07-15.
> Full setup, browser release QA, and remaining coverage gaps:
> [docs/TESTING.md](../../docs/TESTING.md).

Run from `server/`:

```bash
npm run build
npm run test:auth
npm run test:platform
npm run test:money
```

- `test:auth`: no DB/network; real EVM key signatures, replay, and spoof rejection.
- `test:platform`: requires running API, Postgres, Redis, mock agent on `:9099`, and
  `TEST_ADMIN_PK` matching `ADMIN_WALLET`.
- `test:money`: requires disposable Postgres with current schema. It starts its own
  Ganache, deploys contracts, starts API/mock agent, and runs reconciliation.

Prepare disposable money-loop DB before the test:

```bash
npm run db:push -- --force
npm run test:money
```

Reconciliation commands:

```bash
npm run reconcile
npm run reconcile -- --from-block=123456 --to-block=125000
npm run reconcile:worker
```

Coverage includes missed top-up/claim reports, forced DB rollback after confirmed
paid settlement, exact call recovery, idempotent retroactive rescan, drift check,
and concurrent live-request/worker finalization with exactly-once ledger effects.

Never point destructive schema setup or E2E suites at production data.
