import crypto from 'node:crypto'
import { createId } from '@paralleldrive/cuid2'
import { pool } from '../../db/client.js'
import type { OperationalSnapshot } from './operations.js'
import { logger } from './logger.js'

export interface AlertCandidate {
  rule: string
  severity: 'warning' | 'critical'
  summary: string
  details: Record<string, unknown>
}

function threshold(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(name + ' must be non-negative')
  return parsed
}

function bigintThreshold(name: string, fallback: bigint): bigint {
  try {
    const parsed = BigInt(process.env[name] ?? fallback)
    if (parsed < 0n) throw new Error()
    return parsed
  } catch {
    throw new Error(name + ' must be a non-negative integer')
  }
}
export function evaluateAlerts(snapshot: OperationalSnapshot): AlertCandidate[] {
  const alerts: AlertCandidate[] = []
  for (const dependency of ['postgres', 'redis', 'rpc', 'contract', 'operational_state']) {
    if (snapshot.dependencies[dependency]?.ok !== true) {
      alerts.push({
        rule: 'dependency_' + dependency,
        severity: dependency === 'postgres' || dependency === 'contract' ? 'critical' : 'warning',
        summary: dependency + ' dependency is unavailable',
        details: { latency_ms: snapshot.dependencies[dependency]?.latencyMs },
      })
    }
  }

  const workerMaxAge = threshold('ALERT_WORKER_MAX_AGE_SECONDS', 90)
  if (
    snapshot.worker.ageSeconds === undefined ||
    snapshot.worker.ageSeconds > workerMaxAge
  ) {
    alerts.push({
      rule: 'worker_stale',
      severity: 'critical',
      summary: 'Reconciliation worker heartbeat is stale',
      details: { age_seconds: snapshot.worker.ageSeconds, threshold_seconds: workerMaxAge },
    })
  }

  if (process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT === 'true') {
    const backupMaxAge = threshold('ALERT_BACKUP_MAX_AGE_SECONDS', 86_400)
    if (
      snapshot.backup.ageSeconds === undefined ||
      snapshot.backup.ageSeconds > backupMaxAge
    ) {
      alerts.push({
        rule: 'backup_stale',
        severity: 'critical',
        summary: 'Managed backup/PITR heartbeat is stale',
        details: { age_seconds: snapshot.backup.ageSeconds, threshold_seconds: backupMaxAge },
      })
    }
  }

  const lagThreshold = BigInt(Math.floor(threshold('ALERT_CURSOR_LAG_BLOCKS', 2_000)))
  if (
    snapshot.chain.lagBlocks !== undefined &&
    snapshot.chain.lagBlocks > lagThreshold
  ) {
    alerts.push({
      rule: 'cursor_lag',
      severity: 'warning',
      summary: 'Reconciliation cursor exceeds the block-lag threshold',
      details: {
        lag_blocks: snapshot.chain.lagBlocks,
        threshold_blocks: lagThreshold,
      },
    })
  }

  const outboxThreshold = threshold('ALERT_OUTBOX_MAX_AGE_SECONDS', 300)
  if (
    snapshot.outbox.oldestRecoverableAgeSeconds !== undefined &&
    snapshot.outbox.oldestRecoverableAgeSeconds > outboxThreshold
  ) {
    alerts.push({
      rule: 'outbox_stale',
      severity: 'critical',
      summary: 'A recoverable settlement outbox row is stale',
      details: {
        age_seconds: snapshot.outbox.oldestRecoverableAgeSeconds,
        threshold_seconds: outboxThreshold,
      },
    })
  }

  if (snapshot.drift.exceedsThreshold) {
    alerts.push({
      rule: 'financial_drift',
      severity: 'critical',
      summary: 'Onchain and PostgreSQL financial ledgers have drifted',
      details: snapshot.drift.values,
    })
  }
  if (snapshot.chain.solvent === false) {
    alerts.push({
      rule: 'escrow_insolvent',
      severity: 'critical',
      summary: 'Escrow liabilities exceed token collateral',
      details: {},
    })
  }

  const signerMinimum = bigintThreshold(
    'ALERT_SIGNER_MIN_BALANCE_WEI',
    10_000_000_000_000_000n
  )
  if (
    snapshot.signer.balanceWei !== undefined &&
    snapshot.signer.balanceWei < signerMinimum
  ) {
    alerts.push({
      rule: 'signer_low_balance',
      severity: 'critical',
      summary: 'Settlement signer native gas balance is below threshold',
      details: {
        balance_wei: snapshot.signer.balanceWei,
        threshold_wei: signerMinimum,
      },
    })
  }

  return alerts
}

function fingerprint(rule: string): string {
  return crypto.createHash('sha256').update('velostra:' + rule).digest('hex')
}

function webhookConfiguration(): { url: URL; token?: string } | undefined {
  const raw = process.env.ALERT_WEBHOOK_URL?.trim()
  if (!raw) return undefined
  const url = new URL(raw)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Production ALERT_WEBHOOK_URL must use HTTPS')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ALERT_WEBHOOK_URL must not contain embedded credentials')
  }
  return { url, token: process.env.ALERT_WEBHOOK_TOKEN?.trim() || undefined }
}

async function notify(candidate: AlertCandidate, id: string): Promise<void> {
  const webhook = webhookConfiguration()
  if (!webhook) {
    logger.warn('alert_transport_unconfigured', { alertId: id, rule: candidate.rule })
    return
  }
  const response = await fetch(webhook.url, {
    method: 'POST',
    signal: AbortSignal.timeout(Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS ?? 5_000)),
    headers: {
      'content-type': 'application/json',
      ...(webhook.token ? { authorization: 'Bearer ' + webhook.token } : {}),
    },
    body: JSON.stringify({
      source: 'velostra',
      environment: process.env.VELOSTRA_ENVIRONMENT ?? 'local',
      release: process.env.VELOSTRA_RELEASE ?? 'development',
      alert_id: id,
      rule: candidate.rule,
      severity: candidate.severity,
      summary: candidate.summary,
      details: candidate.details,
      runbook: process.env.ALERT_RUNBOOK_BASE_URL
        ? process.env.ALERT_RUNBOOK_BASE_URL.replace(/\/$/, '') + '#' + candidate.rule
        : undefined,
    }, (_key, value) => typeof value === 'bigint' ? value.toString() : value),
  })
  if (!response.ok) throw new Error('Alert webhook returned HTTP ' + response.status)
}

export async function persistAndDispatchAlerts(
  snapshot: OperationalSnapshot
): Promise<AlertCandidate[]> {
  const candidates = evaluateAlerts(snapshot)
  const activeFingerprints = candidates.map((candidate) => fingerprint(candidate.rule))
  const repeatSeconds = threshold('ALERT_REPEAT_SECONDS', 1_800)

  for (const candidate of candidates) {
    const id = createId()
    const alertFingerprint = fingerprint(candidate.rule)
    const result = await pool.query<{
      id: string
      status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
    }>(
      `insert into operational_alerts
         (id, fingerprint, rule, severity, status, summary, details)
       values ($1, $2, $3, $4, 'OPEN', $5, $6::jsonb)
       on conflict (fingerprint) do update set
         severity = excluded.severity,
         status = case
           when operational_alerts.status = 'RESOLVED' then 'OPEN'
           else operational_alerts.status
         end,
         summary = excluded.summary,
         details = excluded.details,
         occurrences = operational_alerts.occurrences + 1,
         last_seen_at = now(),
         last_notified_at = case
           when operational_alerts.status = 'RESOLVED' then null
           else operational_alerts.last_notified_at
         end,
         resolved_at = null,
         updated_at = now()
       returning id, last_notified_at, status`,
      [
        id,
        alertFingerprint,
        candidate.rule,
        candidate.severity,
        candidate.summary,
        JSON.stringify(candidate.details, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        ),
      ]
    )
    const row = result.rows[0]
    if (!row || row.status === 'ACKNOWLEDGED') continue
    const claim = await pool.query(
      `update operational_alerts
       set last_notified_at = now(), updated_at = now()
       where id = $1 and status = 'OPEN'
         and (last_notified_at is null or last_notified_at <= now() - ($2 * interval '1 second'))
       returning id`,
      [row.id, repeatSeconds]
    )
    if ((claim.rowCount ?? 0) !== 1) continue
    try {
      await notify(candidate, row.id)
    } catch (error) {
      await pool.query(
        'update operational_alerts set last_notified_at = null, updated_at = now() where id = $1',
        [row.id]
      )
      logger.error('alert_delivery_failed', { alertId: row.id, rule: candidate.rule, error })
    }
  }

  if (activeFingerprints.length === 0) {
    await pool.query(
      `update operational_alerts
       set status = 'RESOLVED', resolved_at = now(), updated_at = now()
       where status <> 'RESOLVED'`
    )
  } else {
    await pool.query(
      `update operational_alerts
       set status = 'RESOLVED', resolved_at = now(), updated_at = now()
       where status <> 'RESOLVED' and not (fingerprint = any($1::text[]))`,
      [activeFingerprints]
    )
  }
  return candidates
}

export async function acknowledgeAlert(fingerprintOrId: string, operator: string): Promise<boolean> {
  const result = await pool.query(
    `update operational_alerts
     set status = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by = $2,
         updated_at = now()
     where (id = $1 or fingerprint = $1) and status = 'OPEN'`,
    [fingerprintOrId, operator]
  )
  return (result.rowCount ?? 0) === 1
}
