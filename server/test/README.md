# Server test quick reference

> Last verified: 2026-07-15. Full matrix: [docs/TESTING.md](../../docs/TESTING.md).

Run from repository root:

```bash
npm --prefix server run build
npm --prefix server run db:check
npm --prefix server run test:config
npm --prefix server run test:auth
npm --prefix server run test:ssrf
npm --prefix server run test:http-security
npm --prefix server run test:secrets
npm --prefix server run test:admin-policy
npm --prefix server run test:money-unit
npm test --prefix contracts
```

Disposable Postgres:

```bash
export DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/velostra_test
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm --prefix server run test:money
```

`test:money` starts its own Ganache, deploys the contract, starts the real API and
HMAC mock agent, and runs the real worker. It covers missed top-up/claim reports,
post-chain DB failure, exact call recovery, receipt ambiguity, lost broadcast
response without a DB hash, idempotent retroactive scan/cursor preservation, drift,
and concurrent live/worker exactly-once finalization.

`test:platform` is a legacy running-stack smoke and requires Postgres, Redis, API,
mock agent, and `TEST_ADMIN_PK` for a bootstrap/admin wallet. It is not part of the
self-contained money-loop gate.

Reconciliation:

```bash
npm --prefix server run reconcile
npm --prefix server run reconcile -- --from-block=123456 --to-block=125000
npm --prefix server run reconcile:worker
```

Never run integration schema/data setup against staging or production.