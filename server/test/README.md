# Server test quick reference

> Last verified: 2026-07-17. Full matrix: [docs/TESTING.md](../../docs/TESTING.md).
> Evidence state: Phase 0-4 repository automation is complete; controlled mainnet
> execution and managed external evidence remain gated.

Run from repository root:

```bash
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
npm --prefix server run test:admin-policy
npm --prefix server run test:money-unit
npm --prefix server run test:phase3-canary
npm run test:phase4-unit
npm test --prefix contracts
```

Disposable Postgres:

```bash
export DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/velostra_test
npm --prefix server run db:migrate
npm --prefix server run test:migrations
npm --prefix server run test:observability-db
npm --prefix server run test:phase3-canary
npm run test:phase4-unit-db
npm --prefix server run test:money
```

`test:money` starts its own Ganache, deploys the contract, starts the real API and
HMAC mock agent, and runs the real worker. It covers missed top-up/claim reports,
post-chain DB failure, exact call recovery, receipt ambiguity, lost broadcast
response without a DB hash, idempotent retroactive scan/cursor preservation, drift,
concurrent live/worker exactly-once finalization, bounded concurrent load, a
long-range catch-up with replay, and snapshot/revert canonical reorg recovery.

`test:platform` is a legacy running-stack smoke and requires Postgres, the API,
mock agent, and `TEST_ADMIN_PK` for a bootstrap/admin wallet. Redis is required
under the production fail-closed policy; a test/development run can deliberately
exercise the documented fail-open quota fallback. It is not part of the
self-contained money-loop gate.

Reconciliation:

```bash
npm --prefix server run reconcile
npm --prefix server run reconcile -- --from-block=123456 --to-block=125000
npm --prefix server run reconcile:worker
```

Webhook delivery:

~~~bash
npm --prefix server run webhooks
npm --prefix server run webhooks:worker
~~~

The Phase 4 E2E suite uses disposable Postgres and covers v1 response/cursor/
idempotency contracts, revision publish races, analytics, concurrent webhook claims,
retry/dead-letter/replay, moderation races, privacy retention/anonymization,
telemetry fail-closed behavior, and zero financial/delivery drift.
Never run integration schema/data setup against staging or production.
