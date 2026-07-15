# Isolated staging topology

This directory is the reviewable deployment contract for Phase 2. It connects the
Velostra containers to externally managed PostgreSQL, Redis, RPC, TLS ingress, and
secret storage. It deliberately does not provision or embed those vendor-specific
resources.

## Invariants

- staging has its own accounts, database, Redis namespace, RPC credentials, chain
  deployment, signer, treasury, and alert destinations;
- no mainnet contract, production secret, or real-value wallet may be referenced;
- ingress terminates TLS before forwarding to the loopback-bound web/API ports;
- PostgreSQL and Redis are reachable only from the backend network/service identity;
- the API and reconciliation worker use separate supervised processes and the worker
  has a single active logical signer writer;
- image references are immutable tags or digests generated from a reviewed commit;
- role-specific common/api/worker/monitor env files are materialized from separate
  secret scopes and never committed.

## Deployment sequence

1. Provision isolated managed PostgreSQL with PITR, managed Redis, dedicated RPC,
   TLS ingress, image registry, and secret store.
2. Materialize `common.env` plus only the role-specific `api.env`, `worker.env`, or
   `monitor.env` from the platform secret/config store. Replace every placeholder and
   keep `NODE_ENV=production` so startup validation fails closed.
3. Apply versioned migrations with the release image:
   `docker compose --profile release -f deploy/staging/compose.yaml run --rm migration`.
4. Build immutable web/server images and scan them before publishing.
5. Set `VELOSTRA_WEB_IMAGE` and `VELOSTRA_SERVER_IMAGE`, then validate with
   `docker compose --env-file deployment.env -f deploy/staging/compose.yaml config`.
6. Start API and worker, verify `/health`, then run the Phase 2 deep-readiness and
   synthetic smoke gates before exposing staging to testers.

## Phase 2 evidence run

Freeze `VELOSTRA_RELEASE` to the full 40-character reviewed commit and use only a
synthetic user/agent/value. The guarded runners read secrets from environment
injection and refuse production/mainnet targets:

```bash
PHASE2_DRILL_APPROVED=isolated-staging-only \
PHASE2_BASE_URL=https://staging.example \
PHASE2_EXPECTED_ENVIRONMENT=staging-isolated \
PHASE2_SESSION_COOKIE='<synthetic-session-cookie>' \
PHASE2_AGENT_SLUG=<synthetic-agent> npm run phase2:load

PHASE2_SOAK_APPROVED=isolated-staging-72h \
PHASE2_BASE_URL=https://staging.example \
PHASE2_EXPECTED_ENVIRONMENT=staging-isolated \
PHASE2_METRICS_TOKEN='<managed-token>' \
PHASE2_SESSION_COOKIE='<synthetic-session-cookie>' \
PHASE2_AGENT_SLUG=<synthetic-agent> \
PHASE2_WORKER_RESTART_EVIDENCE_PATH=<restart.json> \
PHASE2_FINDINGS_EVIDENCE_PATH=<findings.json> npm run phase2:soak
```

Complete every artifact listed in
`config/phase2-evidence-manifest.example.json`, compute its SHA-256, add accountable
operator sign-off, and run:

```bash
npm run phase2:evidence -- --manifest=artifacts/phase2/evidence-manifest.json
```

Passing local tests or starting the compose topology does not close Phase 2. The
managed outage/PITR, real-wallet, alert-delivery, restart, 72-hour soak, findings,
configuration, dashboard, dependency, and sign-off records must all be present.

The compose manifest is also a portable topology specification. A managed platform
may translate each service into its native service definition as long as the listed
invariants and resource boundaries remain intact and the translated configuration is
captured in the release evidence packet.
