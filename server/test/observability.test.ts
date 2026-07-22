import assert from 'node:assert/strict'
import {
  dispatchAlertNotification,
  evaluateAlerts,
  formatTelegramAlert,
  sanitizeAlertDetails,
} from '../src/lib/observability/alerts.js'
import {
  executeOperationalReadsInSequence,
  readinessFromSnapshot,
  type OperationalSnapshot,
} from '../src/lib/observability/operations.js'
import {
  renderPrometheus,
  setOperationalSnapshot,
} from '../src/lib/observability/metrics.js'
import { startApiObservability } from '../src/lib/observability/runtime.js'

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

const originalFetch = globalThis.fetch
const originalEnv = {
  READINESS_REQUIRE_WORKER: process.env.READINESS_REQUIRE_WORKER,
  ALERT_REQUIRE_BACKUP_HEARTBEAT: process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT,
  ALERT_TRANSPORT: process.env.ALERT_TRANSPORT,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
}

try {
  process.env.READINESS_REQUIRE_WORKER = 'true'
  process.env.ALERT_REQUIRE_BACKUP_HEARTBEAT = 'true'

  assert.equal(readinessFromSnapshot(undefined).ready, false)
  assert.equal(readinessFromSnapshot(snapshot()).ready, true)
  assert.equal(readinessFromSnapshot(snapshot({ worker: { ageSeconds: 120 } })).ready, false)
  assert.deepEqual(evaluateAlerts(snapshot()), [])

  let activeReads = 0
  let maximumActiveReads = 0
  const readOrder: string[] = []
  const read = (label: string) => async () => {
    activeReads += 1
    maximumActiveReads = Math.max(maximumActiveReads, activeReads)
    await new Promise((resolve) => setTimeout(resolve, 1))
    readOrder.push(label)
    activeReads -= 1
  }
  await executeOperationalReadsInSequence([read('outbox'), read('heartbeats'), read('webhooks')])
  assert.equal(maximumActiveReads, 1, 'operational reads must not fan out across the small pool')
  assert.deepEqual(readOrder, ['outbox', 'heartbeats', 'webhooks'])

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

  const sanitized = sanitizeAlertDetails({
    latency_ms: 12,
    bot_token: 'must-not-leave-secret-manager',
    nested: {
      password: 'private',
      state: 'degraded',
    },
  })
  assert.deepEqual(sanitized, {
    latency_ms: 12,
    bot_token: '[REDACTED]',
    nested: {
      password: '[REDACTED]',
      state: 'degraded',
    },
  })
  const telegramMessage = formatTelegramAlert({
    rule: 'dependency_rpc',
    severity: 'critical',
    summary: 'rpc dependency is unavailable',
    details: sanitized as Record<string, unknown>,
  }, 'alert-test')
  assert.match(telegramMessage, /Velostra operational alert/)
  assert.match(telegramMessage, /Severity: CRITICAL/)
  assert.match(telegramMessage, /Rule: dependency_rpc/)
  assert(!telegramMessage.includes('must-not-leave-secret-manager'))
  assert(telegramMessage.length <= 3_900)

  const fakeBotToken = '123456789:' + 'a'.repeat(35)
  let telegramRequest: { url: string; init?: RequestInit } | undefined
  process.env.ALERT_TRANSPORT = 'telegram'
  process.env.TELEGRAM_BOT_TOKEN = fakeBotToken
  process.env.TELEGRAM_CHAT_ID = '-1001234567890'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    telegramRequest = { url: input.toString(), init }
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await dispatchAlertNotification({
    rule: 'dependency_rpc',
    severity: 'critical',
    summary: 'rpc dependency is unavailable',
    details: { token: 'never-send-this', latency_ms: 8 },
  }, 'delivery-test')
  assert.equal(
    telegramRequest?.url,
    'https://api.telegram.org/bot' + fakeBotToken + '/sendMessage'
  )
  assert.equal(telegramRequest?.init?.method, 'POST')
  const telegramHeaders = telegramRequest?.init?.headers as Record<string, string> | undefined
  assert(telegramHeaders)
  assert(!('authorization' in telegramHeaders))
  const telegramBody = JSON.parse(String(telegramRequest?.init?.body))
  assert.equal(telegramBody.chat_id, '-1001234567890')
  assert.match(telegramBody.text, /Rule: dependency_rpc/)
  assert(!telegramBody.text.includes('never-send-this'))
  globalThis.fetch = (async () => {
    throw new Error('network failure for ' + fakeBotToken)
  }) as typeof fetch
  await assert.rejects(
    () => dispatchAlertNotification({
      rule: 'dependency_rpc',
      severity: 'critical',
      summary: 'rpc dependency is unavailable',
      details: {},
    }, 'network-error-test'),
    (error: Error) => /request failed/.test(error.message) && !error.message.includes(fakeBotToken)
  )

  setOperationalSnapshot(snapshot())
  const metrics = renderPrometheus()
  assert.match(metrics, /velostra_dependency_up\{dependency="postgres"\} 1/)
  assert.match(metrics, /velostra_reconciliation_lag_blocks 8/)
  assert.match(metrics, /velostra_webhook_worker_heartbeat_age_seconds 8/)
  assert(metrics.includes('velostra_webhook_deliveries{status="DELIVERED"} 4'))
  assert.match(metrics, /velostra_signer_balance_wei 20000000000000000/)
  assert.match(metrics, /velostra_chain_solvent 1/)

  let releaseInitialCollection: (() => void) | undefined
  const initialCollectionGate = new Promise<void>((resolve) => {
    releaseInitialCollection = resolve
  })
  let initialCollectionStarted = false
  let runtimeResolved = false
  const runtimePromise = startApiObservability({
    intervalMs: 60_000,
    collectSnapshot: async () => {
      initialCollectionStarted = true
      await initialCollectionGate
      return snapshot()
    },
    heartbeat: async () => undefined,
  }).then((stop) => {
    runtimeResolved = true
    return stop
  })
  await Promise.resolve()
  assert.equal(initialCollectionStarted, true)
  assert.equal(runtimeResolved, false, 'runtime must not resolve before its first snapshot')
  releaseInitialCollection?.()
  const stopRuntime = await runtimePromise
  assert.equal(runtimeResolved, true)
  stopRuntime()
  console.log('OBSERVABILITY READINESS, METRICS, AND ALERT RULES VERIFIED')
} finally {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
