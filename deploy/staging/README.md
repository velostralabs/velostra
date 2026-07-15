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
- `server.env` is delivered by the deployment secret store and is never committed.

## Deployment sequence

1. Provision isolated managed PostgreSQL with PITR, managed Redis, dedicated RPC,
   TLS ingress, image registry, and secret store.
2. Copy `server.env.example` into the platform secret/config store and replace every
   placeholder. Keep `NODE_ENV=production` so startup validation fails closed.
3. Apply versioned migrations with the release image:
   `docker compose --profile release -f deploy/staging/compose.yaml run --rm migration`.
4. Build immutable web/server images and scan them before publishing.
5. Set `VELOSTRA_WEB_IMAGE` and `VELOSTRA_SERVER_IMAGE`, then validate with
   `docker compose --env-file deployment.env -f deploy/staging/compose.yaml config`.
6. Start API and worker, verify `/health`, then run the Phase 2 deep-readiness and
   synthetic smoke gates before exposing staging to testers.

The compose manifest is also a portable topology specification. A managed platform
may translate each service into its native service definition as long as the listed
invariants and resource boundaries remain intact and the translated configuration is
captured in the release evidence packet.
