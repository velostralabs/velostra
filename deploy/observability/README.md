# Velostra observability deployment contract

> Deployment status (2026-07-18): this is a target runtime contract. No managed
> monitor, reconciliation, webhook, metrics, or alerting service is live. The public
> `velostra.xyz` Netlify preview is static and has no worker/backend authority.

The API exposes shallow liveness at /health, dependency-aware readiness at /ready,
and Prometheus exposition at /metrics. Metrics require the managed scrape bearer
token. Readiness remains closed until PostgreSQL, Redis, the configured RPC, escrow
bytecode/solvency, operational tables, reconciliation heartbeat, and configured webhook-worker heartbeat are healthy.

The operational-monitor role persists deduplicated alerts in PostgreSQL and sends
actionable notifications. The selected US staging transport sends bounded, redacted
plain-text messages directly to a private Telegram channel using separately injected
bot-token and channel-ID secrets. Generic HTTPS webhooks remain supported. Continuous production may evaluate every 30
seconds. The low-cost US staging target invokes a one-shot monitor job every 15
minutes and therefore uses a 20-minute heartbeat/staleness threshold. Alert state
survives restarts and supports OPEN, ACKNOWLEDGED, and RESOLVED lifecycle.

## Deployment

1. Route JSON stdout/stderr to the managed log/error platform. Index timestamp,
   level, service, environment, release, event, requestId, rule, and alertId.
2. Configure Prometheus (or a compatible managed collector) to scrape /metrics using
   METRICS_AUTH_TOKEN without placing the token in its URL.
3. Import grafana-dashboard.json and prometheus-rules.yml, then replace datasource
   and runbook destinations through reviewed configuration.
4. For selected staging, set ALERT_TRANSPORT=telegram and inject TELEGRAM_BOT_TOKEN,
   TELEGRAM_CHAT_ID, and ALERT_RUNBOOK_BASE_URL. For a generic receiver, set
   ALERT_TRANSPORT=webhook and inject ALERT_WEBHOOK_URL plus ALERT_WEBHOOK_TOKEN.
5. Start supervised reconciliation/webhook/monitor roles in production. In the
   selected US staging target, deploy their separate staggered one-task Cloud Run
   Jobs from deploy/gcp/deploy-runtime.ps1. Prove every required rule reaches a real
   operator.
6. Have the managed backup/PITR job record a successful heartbeat:

       npm run heartbeat:record --prefix server -- backup ok

7. Acknowledge an open alert by ID or fingerprint and operator identity:

       npm run alert:ack --prefix server -- <alert> <operator>

Acknowledgement suppresses repeat notifications while the condition remains visible.
Resolution happens automatically only after the monitor observes the condition clear.
The database remains the alert audit record; provider-side acknowledgement does not
replace it.

## Required injected-failure evidence

- stop the reconciliation worker and receive worker_stale;
- stop the webhook worker and receive webhook_worker_stale;
- age a pending webhook delivery and receive webhook_delivery_stale;
- create controlled ledger drift and receive financial_drift;
- lower the staging signer gas balance and receive signer_low_balance;
- reject or time out RPC requests and receive dependency_rpc/cursor_lag;
- exhaust database connections and receive dependency_postgres;
- suppress the backup heartbeat and receive backup_stale.

Record detection time, delivery time, acknowledgement, escalation, runbook action,
recovery time, and final `RESOLVED` state. Summarize all required scenarios in the
`alerts` artifact, bind it to the same environment/release, hash it in the Phase 2
manifest, and retain provider delivery IDs outside the public repository. Local rule
and lifecycle tests prove implementation behavior but do not prove real operator
receipt.
