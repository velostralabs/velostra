import assert from 'node:assert/strict'
import { evaluateAlerts } from '../src/lib/observability/alerts.js'
import {
  readinessFromSnapshot,
  type OperationalSnapshot,
} from '../src/lib/observability/operations.js'
import {
  renderPrometheus,
  setOperationalSnapshot,
} from '../src/lib/observability/metrics.js'

function snapshot(overrides: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    dependencies: {
      postgres: { ok: true, latencyMs: 2 },
      redis: { ok: true, latencyMs: 1 },
      rpc: { ok: true, latencyMs: 8 },
      contract: { ok: true, latencyMs: 4 },
      operational_state: { ok: true, latencyMs: 2 },
      drift: { ok: true, latencyMs: 2 },
      signer: { ok: true, latencyMs: 3 },
    },
    chain: {
      latestBlock: 10_100n,
      safeHeadBlock: 10_088n,
      cursorBlock: 10_080n,
      lagBlocks: 8n,
      pendingEvents: 0,
      solvent: true,
    },
    outbox: {
      byStatus: { APPLIED: 12, AMBIGUOUS: 0 },
      oldestRecoverableAgeSeconds: 0,
    },
    webhooks: { byStatus: { DELIVERED: 4, DEAD_LETTER: 0 }, oldestPendingAgeSeconds: 0 },
    drift: { available: true, exceedsThreshold: false, values: {} },
    signer: {
      address: '0x4444444444444444444444444444444444444444',
      balanceWei: 20_000_000_000_000_000n,
    },
    worker: { ageSeconds: 10 },
    webhookWorker: { ageSeconds: 8 },
    backup: { ageSeconds: 60 },
    ...overrides,
  }
}

const originalEnv = {
  READINESS_REQUIRE_WORKER: process.env.READINESS_REQUIRE_WORKER,
  ALERT_REQUIRE_BACKUP_HEARTBEAT: process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT,
}

try {
  process.env.READINESS_REQUIRE_WORKER = 'true'
  process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT = 'true'

  assert.equal(readinessFromSnapshot(undefined).ready, false)
  assert.equal(readinessFromSnapshot(snapshot()).ready, true)
  assert.equal(readinessFromSnapshot(snapshot({ worker: { ageSeconds: 120 } })).ready, false)
  assert.deepEqual(evaluateAlerts(snapshot()), [])

  const unhealthy = snapshot({
    dependencies: {
      ...snapshot().dependencies,
      rpc: { ok: false, latencyMs: 5, error: 'RpcError' },
    },
    chain: { ...snapshot().chain, lagBlocks: 3_000n, solvent: false },
    outbox: {
      byStatus: { AMBIGUOUS: 1 },
      oldestRecoverableAgeSeconds: 600,
    },
    drift: {
      available: true,
      exceedsThreshold: true,
      values: { earnings: '1.000000' },
    },
    signer: {
      address: '0x4444444444444444444444444444444444444444',
      balanceWei: 1n,
    },
    worker: { ageSeconds: 120 },
    webhookWorker: { ageSeconds: 121 },
    webhooks: { byStatus: { DEAD_LETTER: 2 }, oldestPendingAgeSeconds: 601 },
    backup: {},
  })
  const rules = new Set(evaluateAlerts(unhealthy).map((alert) => alert.rule))
  for (const rule of [
    'dependency_rpc',
    'worker_stale',
    'webhook_worker_stale',
    'webhook_dead_letter',
    'webhook_delivery_stale',
    'backup_stale',
    'cursor_lag',
    'outbox_stale',
    'financial_drift',
    'escrow_insolvent',
    'signer_low_balance',
  ]) {
    assert(rules.has(rule), 'missing alert rule ' + rule)
  }

  setOperationalSnapshot(snapshot())
  const metrics = renderPrometheus()
  assert.match(metrics, /velostra_dependency_up\{dependency="postgres"\} 1/)
  assert.match(metrics, /velostra_reconciliation_lag_blocks 8/)
  assert.match(metrics, /velostra_webhook_worker_heartbeat_age_seconds 8/)
  assert(metrics.includes('velostra_webhook_deliveries{status="DELIVERED"} 4'))
  assert.match(metrics, /velostra_signer_balance_wei 20000000000000000/)
  assert.match(metrics, /velostra_chain_solvent 1/)

  console.log('OBSERVABILITY READINESS, METRICS, AND ALERT RULES VERIFIED')
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
