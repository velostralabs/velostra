import fs from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

if (
  required('VELOSTRA_ALERT_EVIDENCE_APPROVAL') !== 'read-only-staging-alert-evidence' ||
  required('VELOSTRA_ENVIRONMENT') !== 'staging' ||
  required('PHASE3_PAID_WRITES_MODE') !== 'disabled'
) throw new Error('Alert evidence is locked to write-disabled staging')

const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 })
const outputPath = path.resolve(required('ALERT_EVIDENCE_OUTPUT'))

try {
  const [alertResult, heartbeatResult] = await Promise.all([
    pool.query(
      `select severity, status, occurrences, first_seen_at, last_notified_at,
              acknowledged_at, acknowledged_by, resolved_at
         from operational_alerts
        where rule = 'backup_stale'
        order by updated_at desc
        limit 1`
    ),
    pool.query(
      `select status, last_seen_at
         from operational_heartbeats
        where service_name = 'backup'
        limit 1`
    ),
  ])
  const alert = alertResult.rows[0]
  const heartbeat = heartbeatResult.rows[0]
  const firstSeen = alert?.first_seen_at instanceof Date ? alert.first_seen_at.getTime() : NaN
  const notified = alert?.last_notified_at instanceof Date ? alert.last_notified_at.getTime() : NaN
  const acknowledged = alert?.acknowledged_at instanceof Date ? alert.acknowledged_at.getTime() : NaN
  const resolved = alert?.resolved_at instanceof Date ? alert.resolved_at.getTime() : NaN
  const heartbeatSeen = heartbeat?.last_seen_at instanceof Date ? heartbeat.last_seen_at.getTime() : NaN
  const flags = {
    alertFound: Boolean(alert),
    criticalSeverity: alert?.severity === 'critical',
    telegramDeliveryRecorded: Number.isFinite(notified),
    operatorAcknowledged: Number.isFinite(acknowledged),
    namedOperatorRecorded:
      typeof alert?.acknowledged_by === 'string' && alert.acknowledged_by.trim().length >= 3,
    alertResolved: alert?.status === 'RESOLVED' && Number.isFinite(resolved),
    dedupeOccurrenceRecorded: Number(alert?.occurrences) >= 1,
    lifecycleOrderValid:
      Number.isFinite(firstSeen) && Number.isFinite(notified) &&
      Number.isFinite(acknowledged) && Number.isFinite(resolved) &&
      firstSeen <= notified && notified <= acknowledged && acknowledged <= resolved,
    backupHeartbeatHealthy: heartbeat?.status === 'ok' && Number.isFinite(heartbeatSeen),
    heartbeatPrecedesResolution:
      Number.isFinite(heartbeatSeen) && Number.isFinite(resolved) && heartbeatSeen <= resolved,
    heartbeatCurrentlyFresh:
      Number.isFinite(heartbeatSeen) && Date.now() - heartbeatSeen <= 86_400_000,
  }
  const evidence = {
    schemaVersion: 1,
    kind: 'velostra-staging-alert-lifecycle',
    environment: 'staging',
    region: 'us-east4',
    capturedAt: new Date().toISOString(),
    paidWritesDisabled: true,
    ...flags,
    passed: Object.values(flags).every(Boolean),
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = outputPath + '.tmp'
  await fs.writeFile(temporary, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temporary, outputPath)
  console.info(JSON.stringify(evidence))
} finally {
  await pool.end()
}
