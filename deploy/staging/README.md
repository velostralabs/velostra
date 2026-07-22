# Isolated staging topology

This directory is the reviewable managed-staging, Phase 3 release, and Phase 4 platform topology. It connects the
Velostra containers to externally managed PostgreSQL, Redis, RPC, TLS ingress, and
secret storage. It deliberately does not embed credentials or provider outputs.

This Compose topology remains the portable/local specification. The selected managed
staging implementation is the [US-only GCP runbook](../gcp/README.md): Robinhood
testnet 46630, GCP us-east4, Neon aws-us-east-1, Upstash GCP us-east4, and a
USD 35 envelope. The managed API, signer, data plane, workers, Scheduler, synthetic
agent, verified token, and escrow are live. The Netlify browser at `velostra.xyz`
is a separate delivery/authority domain connected to that bounded testnet runtime;
it never satisfies backend readiness or financial evidence by itself.

## Invariants

- staging has its own accounts, database, Redis namespace, RPC credentials, chain
  deployment, signer, treasury, and alert destinations;
- no mainnet contract, production secret, or real-value wallet may be referenced;
- ingress terminates TLS before forwarding to the loopback-bound web/API ports;
- PostgreSQL and Redis are reachable only from the backend network/service identity;
- the API, reconciliation worker, webhook worker, and operational monitor are separate
  supervised processes; the reconciliation path has one active logical signer writer;
- role-specific API/reconciliation/webhook/monitor secrets are isolated; webhook
  delivery has bounded retry/lock settings and no signer authority;
- image references are immutable digests generated from the exact reviewed commit;
- role-specific common/api/worker/webhook/monitor env files are materialized from separate
  secret scopes and never committed;
- the immutable Phase 3 input packet is mounted read-only, while readiness/canary
  evidence is written only to the dedicated evidence volume.

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
6. Validate the immutable Phase 3 release manifest and deployment plan against the
   exact full commit and image digests.
7. Start API, reconciliation worker, webhook worker, and monitor; verify /health and
   /ready, then run the Phase 2 deep-readiness and
   synthetic smoke gates before exposing staging to testers.
8. Capture Phase 3 readiness, one-hour catch-up, and bounded canary evidence into the
   writable evidence mount. Never write back into the immutable input packet.

## Phase 4 platform roles

- api.env supplies PLATFORM_CURSOR_SECRET and requires fresh reconciliation and
  webhook-worker heartbeats in readiness.
- webhook.env supplies only webhook batch, attempt, backoff, lock, and interval bounds.
- monitor.env requires webhook heartbeat and pending-age alert policy in addition to
  the existing financial/reconciliation rules.
- common.env contains shared database/environment/release values, never role-specific
  signer or alert secrets.
- Migration 0008 must be present in the immutable image and applied before any Phase 4
  API or worker starts.

Before closed-beta activation, prove subscription create/rotate/pause, exact signature,
receiver deduplication, retry/dead-letter, audited replay, stale-worker alert delivery,
privacy retention processing, and zero financial/delivery drift in this same isolated
environment.

## Phase 2 evidence run

Freeze `VELOSTRA_RELEASE` to the full 40-character reviewed commit and use only a
synthetic user/agent/value. The guarded runners read secrets from environment
injection and refuse production/mainnet targets:

```bash
PHASE2_DRILL_APPROVED=isolated-staging-only \
PHASE2_BASE_URL=https://staging.example \
PHASE2_EXPECTED_ENVIRONMENT=staging \
PHASE2_SESSION_COOKIE='<synthetic-session-cookie>' \
PHASE2_AGENT_SLUG=<synthetic-agent> npm run phase2:load

PHASE2_SOAK_APPROVED=isolated-staging-72h \
PHASE2_BASE_URL=https://staging.example \
PHASE2_EXPECTED_ENVIRONMENT=staging \
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

Passing local tests or starting the compose topology does not authorize Phase 3
mainnet execution. The
managed outage/PITR, real-wallet, alert-delivery, restart, 72-hour soak, findings,
configuration, dashboard, dependency, and sign-off records must all be present.

The compose manifest is also a portable topology specification. A managed platform
may translate each service into its native service definition as long as the listed
invariants and resource boundaries remain intact and the translated configuration is
captured in the release evidence packet.
