import type { NextFunction, Request, Response } from 'express'
import type { OperationalSnapshot } from './operations.js'

const startedAt = Date.now()
let inFlight = 0
const requests = new Map<string, number>()
const durationMs = new Map<string, { count: number; sum: number }>()
let latestSnapshot: OperationalSnapshot | undefined

function label(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function number(value: bigint | number | undefined): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return '0'
}

export function observeRequest(req: Request, res: Response, next: NextFunction): void {
  const started = performance.now()
  inFlight += 1
  res.once('finish', () => {
    inFlight = Math.max(0, inFlight - 1)
    const route = req.route?.path ? String(req.route.path) : req.path
    const key = JSON.stringify([req.method, route, String(res.statusCode)])
    requests.set(key, (requests.get(key) ?? 0) + 1)
    const durationKey = JSON.stringify([req.method, route])
    const current = durationMs.get(durationKey) ?? { count: 0, sum: 0 }
    current.count += 1
    current.sum += performance.now() - started
    durationMs.set(durationKey, current)
  })
  next()
}

export function setOperationalSnapshot(snapshot: OperationalSnapshot): void {
  latestSnapshot = snapshot
}

export function getOperationalSnapshot(): OperationalSnapshot | undefined {
  return latestSnapshot
}

export function renderPrometheus(): string {
  const lines = [
    '# HELP velostra_process_uptime_seconds Process uptime in seconds.',
    '# TYPE velostra_process_uptime_seconds gauge',
    'velostra_process_uptime_seconds ' + ((Date.now() - startedAt) / 1_000).toFixed(3),
    '# HELP velostra_http_requests_in_flight Active HTTP requests.',
    '# TYPE velostra_http_requests_in_flight gauge',
    'velostra_http_requests_in_flight ' + inFlight,
    '# HELP velostra_http_requests_total Completed HTTP requests.',
    '# TYPE velostra_http_requests_total counter',
  ]
  for (const [key, value] of requests) {
    const [method, route, status] = JSON.parse(key) as string[]
    lines.push(
      `velostra_http_requests_total{method="${label(method)}",route="${label(route)}",status="${label(status)}"} ${value}`
    )
  }
  lines.push(
    '# HELP velostra_http_request_duration_milliseconds_sum Aggregate request duration.',
    '# TYPE velostra_http_request_duration_milliseconds_sum counter'
  )
  for (const [key, value] of durationMs) {
    const [method, route] = JSON.parse(key) as string[]
    const labels = `method="${label(method)}",route="${label(route)}"`
    lines.push(`velostra_http_request_duration_milliseconds_sum{${labels}} ${value.sum.toFixed(3)}`)
    lines.push(`velostra_http_request_duration_milliseconds_count{${labels}} ${value.count}`)
  }

  const snapshot = latestSnapshot
  if (snapshot) {
    lines.push(
      '# HELP velostra_dependency_up Whether an operational dependency is reachable.',
      '# TYPE velostra_dependency_up gauge'
    )
    for (const [dependency, check] of Object.entries(snapshot.dependencies)) {
      lines.push(`velostra_dependency_up{dependency="${label(dependency)}"} ${check.ok ? 1 : 0}`)
      lines.push(
        `velostra_dependency_latency_milliseconds{dependency="${label(dependency)}"} ${number(check.latencyMs)}`
      )
    }
    lines.push(
      'velostra_reconciliation_cursor_block ' + number(snapshot.chain.cursorBlock),
      'velostra_reconciliation_safe_head_block ' + number(snapshot.chain.safeHeadBlock),
      'velostra_reconciliation_lag_blocks ' + number(snapshot.chain.lagBlocks),
      'velostra_chain_pending_events ' + number(snapshot.chain.pendingEvents),
      'velostra_outbox_oldest_recoverable_age_seconds ' +
        number(snapshot.outbox.oldestRecoverableAgeSeconds),
      'velostra_worker_heartbeat_age_seconds ' + number(snapshot.worker.ageSeconds),
      'velostra_webhook_worker_heartbeat_age_seconds ' + number(snapshot.webhookWorker.ageSeconds),
      'velostra_webhook_oldest_pending_age_seconds ' + number(snapshot.webhooks.oldestPendingAgeSeconds),
      'velostra_webhook_dead_letter_total ' + number(snapshot.webhooks.byStatus.DEAD_LETTER),
      'velostra_backup_heartbeat_age_seconds ' + number(snapshot.backup.ageSeconds),
      'velostra_chain_solvent ' + (snapshot.chain.solvent === true ? 1 : 0),
      'velostra_reconciliation_drift ' + (snapshot.drift.exceedsThreshold ? 1 : 0),
      'velostra_signer_balance_wei ' + number(snapshot.signer.balanceWei)
    )
    for (const [status, count] of Object.entries(snapshot.outbox.byStatus)) {
      lines.push(`velostra_outbox_rows{status="${label(status)}"} ${count}`)
    }

    for (const [status, count] of Object.entries(snapshot.webhooks.byStatus)) {
      lines.push(`velostra_webhook_deliveries{status="${label(status)}"} ${count}`)
    }  }
  return lines.join('\n') + '\n'
}
