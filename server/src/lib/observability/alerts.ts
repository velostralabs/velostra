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

const TELEGRAM_BOT_TOKEN = /^\d{5,20}:[A-Za-z0-9_-]{30,}$/
const TELEGRAM_CHAT_ID = /^-100\d{5,16}$/
const SENSITIVE_DETAIL_KEY =
  /(authorization|cookie|credential|database.?url|dsn|email|mnemonic|password|phone|private|redis.?url|rpc.?url|secret|seed|token|webhook.?url)/i

interface AlertEnvelope {
  source: 'velostra'
  environment: string
  release: string
  alert_id: string
  rule: string
  severity: AlertCandidate['severity']
  summary: string
  details: unknown
  runbook?: string
}

type AlertTransport =
  | { kind: 'webhook'; url: URL; token?: string }
  | { kind: 'telegram'; botToken: string; chatId: string }

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

  const webhookWorkerMaxAge = threshold('ALERT_WEBHOOK_WORKER_MAX_AGE_SECONDS', 90)
  if (
    snapshot.webhookWorker.ageSeconds === undefined ||
    snapshot.webhookWorker.ageSeconds > webhookWorkerMaxAge
  ) {
    alerts.push({
      rule: 'webhook_worker_stale',
      severity: 'critical',
      summary: 'Webhook worker heartbeat is stale',
      details: { age_seconds: snapshot.webhookWorker.ageSeconds, threshold_seconds: webhookWorkerMaxAge },
    })
  }

  const deadLetters = snapshot.webhooks.byStatus.DEAD_LETTER ?? 0
  if (deadLetters > 0) {
    alerts.push({
      rule: 'webhook_dead_letter',
      severity: 'warning',
      summary: 'Webhook deliveries require operator replay',
      details: { deliveries: deadLetters },
    })
  }

  const webhookPendingThreshold = threshold('ALERT_WEBHOOK_MAX_PENDING_AGE_SECONDS', 300)
  if (
    snapshot.webhooks.oldestPendingAgeSeconds !== undefined &&
    snapshot.webhooks.oldestPendingAgeSeconds > webhookPendingThreshold
  ) {
    alerts.push({
      rule: 'webhook_delivery_stale',
      severity: 'critical',
      summary: 'A webhook delivery has exceeded the pending-age threshold',
      details: {
        age_seconds: snapshot.webhooks.oldestPendingAgeSeconds,
        threshold_seconds: webhookPendingThreshold,
      },
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

export function sanitizeAlertDetails(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') {
    return value.length > 256 ? value.slice(0, 253) + '...' : value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeAlertDetails(entry, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, entry]) => [
          key,
          SENSITIVE_DETAIL_KEY.test(key)
            ? '[REDACTED]'
            : sanitizeAlertDetails(entry, depth + 1),
        ])
    )
  }
  return value
}

function alertEnvelope(candidate: AlertCandidate, id: string): AlertEnvelope {
  return {
    source: 'velostra',
    environment: process.env.VELOSTRA_ENVIRONMENT ?? 'local',
    release: process.env.VELOSTRA_RELEASE ?? 'development',
    alert_id: id,
    rule: candidate.rule,
    severity: candidate.severity,
    summary: candidate.summary,
    details: sanitizeAlertDetails(candidate.details),
    runbook: process.env.ALERT_RUNBOOK_BASE_URL
      ? process.env.ALERT_RUNBOOK_BASE_URL.replace(/\/$/, '') + '#' + candidate.rule
      : undefined,
  }
}

export function formatTelegramAlert(candidate: AlertCandidate, id: string): string {
  const envelope = alertEnvelope(candidate, id)
  const details = JSON.stringify(envelope.details)
  const release = envelope.release.length > 12
    ? envelope.release.slice(0, 12)
    : envelope.release
  const lines = [
    'Velostra operational alert',
    '',
    'Severity: ' + envelope.severity.toUpperCase(),
    'Rule: ' + envelope.rule,
    'Summary: ' + envelope.summary,
    'Environment: ' + envelope.environment,
    'Release: ' + release,
    'Alert ID: ' + envelope.alert_id,
    ...(details && details !== '{}'
      ? ['', 'Details: ' + details]
      : []),
    ...(envelope.runbook ? ['', 'Runbook: ' + envelope.runbook] : []),
  ]
  const message = lines.join('\n')
  return message.length > 3_900
    ? message.slice(0, 3_886) + '\n[truncated]'
    : message
}

function alertTransportConfiguration(): AlertTransport | undefined {
  const kind = process.env.ALERT_TRANSPORT?.trim() || 'webhook'
  if (kind === 'telegram') {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
    if (!botToken || !TELEGRAM_BOT_TOKEN.test(botToken)) {
      throw new Error('TELEGRAM_BOT_TOKEN is invalid')
    }
    if (!chatId || !TELEGRAM_CHAT_ID.test(chatId)) {
      throw new Error('TELEGRAM_CHAT_ID is invalid')
    }
    return { kind, botToken, chatId }
  }
  if (kind !== 'webhook') throw new Error('ALERT_TRANSPORT is invalid')

  const raw = process.env.ALERT_WEBHOOK_URL?.trim()
  if (!raw) return undefined
  const url = new URL(raw)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Production ALERT_WEBHOOK_URL must use HTTPS')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ALERT_WEBHOOK_URL must not contain embedded credentials')
  }
  return {
    kind,
    url,
    token: process.env.ALERT_WEBHOOK_TOKEN?.trim() || undefined,
  }
}

export async function dispatchAlertNotification(
  candidate: AlertCandidate,
  id: string
): Promise<void> {
  const transport = alertTransportConfiguration()
  if (!transport) {
    logger.warn('alert_transport_unconfigured', { alertId: id, rule: candidate.rule })
    return
  }

  const isTelegram = transport.kind === 'telegram'
  const url = isTelegram
    ? 'https://api.telegram.org/bot' + transport.botToken + '/sendMessage'
    : transport.url
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS ?? 5_000)),
      headers: {
        'content-type': 'application/json',
        ...(!isTelegram && transport.token
          ? { authorization: 'Bearer ' + transport.token }
          : {}),
      },
      body: isTelegram
        ? JSON.stringify({
            chat_id: transport.chatId,
            text: formatTelegramAlert(candidate, id),
            disable_web_page_preview: true,
            disable_notification: candidate.severity === 'warning',
          })
        : JSON.stringify(alertEnvelope(candidate, id)),
    })
  } catch {
    throw new Error(
      (isTelegram ? 'Telegram alert transport' : 'Alert webhook') + ' request failed'
    )
  }
  if (!response.ok) {
    throw new Error(
      (isTelegram ? 'Telegram alert transport' : 'Alert webhook') +
      ' returned HTTP ' + response.status
    )
  }
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
         acknowledged_at = case
           when operational_alerts.status = 'RESOLVED' then null
           else operational_alerts.acknowledged_at
         end,
         acknowledged_by = case
           when operational_alerts.status = 'RESOLVED' then null
           else operational_alerts.acknowledged_by
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
      await dispatchAlertNotification(candidate, row.id)
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
