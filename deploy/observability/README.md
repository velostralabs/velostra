# Velostra observability deployment contract

The API exposes shallow liveness at /health, dependency-aware readiness at /ready,
and Prometheus exposition at /metrics. Metrics require the managed scrape bearer
token. Readiness remains closed until PostgreSQL, Redis, the configured RPC, escrow
bytecode/solvency, operational tables, and reconciliation heartbeat are healthy.

The operational-monitor process evaluates the same state every 30 seconds, persists
deduplicated alerts in PostgreSQL, and sends actionable webhook notifications. Alert
state survives restarts and supports OPEN, ACKNOWLEDGED, and RESOLVED lifecycle.

## Deployment

1. Route JSON stdout/stderr to the managed log/error platform. Index timestamp,
   level, service, environment, release, event, requestId, rule, and alertId.
2. Configure Prometheus (or a compatible managed collector) to scrape /metrics using
   METRICS_AUTH_TOKEN without placing the token in its URL.
3. Import grafana-dashboard.json and prometheus-rules.yml, then replace datasource
   and runbook destinations through reviewed configuration.
4. Configure ALERT_WEBHOOK_URL, ALERT_WEBHOOK_TOKEN, and ALERT_RUNBOOK_BASE_URL.
5. Start one supervised operational-monitor process and prove every required rule
   reaches a real operator.
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
- create controlled ledger drift and receive financial_drift;
- lower the staging signer gas balance and receive signer_low_balance;
- reject or time out RPC requests and receive dependency_rpc/cursor_lag;
- exhaust database connections and receive dependency_postgres;
- suppress the backup heartbeat and receive backup_stale.

Record detection time, delivery time, acknowledgement, escalation, runbook action,
recovery time, and final RESOLVED state for the Phase 2 evidence packet.
