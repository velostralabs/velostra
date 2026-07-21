import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point to a migrated disposable Postgres database')
}

process.env.NODE_ENV = 'test'
process.env.WEB_ORIGIN = 'http://127.0.0.1'
process.env.AUTH_PUBLIC_URI = 'http://127.0.0.1'
process.env.JWT_SECRET = 'phase4-e2e-jwt-secret-with-at-least-32-characters'
process.env.PLATFORM_CURSOR_SECRET = 'phase4-e2e-cursor-secret-with-at-least-32-characters'
process.env.AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64')
process.env.AGENT_SECRET_ENCRYPTION_KEY_ID = 'phase4-e2e'
process.env.AGENT_SSRF_TEST_ALLOW_LOOPBACK = 'true'
process.env.AGENT_TIMEOUT_MS = '2000'
process.env.AGENT_MAX_RESPONSE_BYTES = '65536'
process.env.REDIS_CONNECT_TIMEOUT_MS = '50'
process.env.REDIS_FAILURE_MODE = 'open'
process.env.WEBHOOK_MAX_ATTEMPTS = '2'
process.env.WEBHOOK_RETRY_BASE_MS = '1'
process.env.WEBHOOK_RETRY_MAX_MS = '2'
process.env.WEBHOOK_LOCK_MS = '1000'

interface CapturedWebhook {
  body: string
  headers: http.IncomingHttpHeaders
}

const captured: CapturedWebhook[] = []
const target = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    if (req.url === '/agent') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ output: { verified: true } }))
      return
    }
    if (req.url === '/webhook') {
      captured.push({ body, headers: req.headers })
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'planned closed-beta delivery failure' }))
  })
})
await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
const targetAddress = target.address()
if (!targetAddress || typeof targetAddress === 'string') throw new Error('target server did not bind')
process.env.AGENT_ALLOWED_PORTS = String(targetAddress.port)
const targetBase = `http://127.0.0.1:${targetAddress.port}`

const [{ createApp }, { pool }, { signJWT }, { processWebhookBatch }, { signWebhookBody }] = await Promise.all([
  import('../src/app.js'),
  import('../src/db/client.js'),
  import('../src/lib/auth.js'),
  import('../src/jobs/webhooks.js'),
  import('../src/lib/platform/webhooks.js'),
])

const appServer = http.createServer(createApp())
await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve))
const appAddress = appServer.address()
if (!appAddress || typeof appAddress === 'string') throw new Error('API server did not bind')
const apiBase = `http://127.0.0.1:${appAddress.port}`

type JsonObject = Record<string, any>
interface ApiResponse {
  status: number
  body: JsonObject
  headers: Headers
}

let keyCounter = 0
async function request(
  token: string,
  path: string,
  input: { method?: string; body?: unknown; key?: string } = {}
): Promise<ApiResponse> {
  const method = input.method ?? 'GET'
  const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const response = await fetch(apiBase + path, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: `velostra_token=${token}`,
      ...(mutation ? { 'idempotency-key': input.key ?? `phase4-key-${++keyCounter}` } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as JsonObject,
    headers: response.headers,
  }
}

function pass(message: string): void {
  console.log('PASS:', message)
}

const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
const ids = {
  builderUser: `p4-builder-user-${suffix}`,
  builder: `p4-builder-${suffix}`,
  builderEarnings: `p4-earnings-${suffix}`,
  user: `p4-user-${suffix}`,
  admin: `p4-admin-${suffix}`,
  adminRole: `p4-admin-role-${suffix}`,
  balance: `p4-balance-${suffix}`,
  callSuccess: `p4-call-success-${suffix}`,
  callFailure: `p4-call-failure-${suffix}`,
  transaction: `p4-transaction-${suffix}`,
  claim: `p4-claim-${suffix}`,
}
function testWallet(role: string): string {
  return '0x' + crypto.createHash('sha256').update(role + suffix).digest('hex').slice(0, 40)
}
const wallets = {
  builder: testWallet('builder'),
  user: testWallet('user'),
  admin: testWallet('admin'),
}

try {
  await pool.query(
    `insert into users (id, wallet_address, display_name, email, avatar_url)
     values ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10), ($11,$12,$13,$14,$15)`,
    [
      ids.builderUser, wallets.builder, 'Phase 4 Builder', `builder-${suffix}@example.test`, 'https://example.test/builder.png',
      ids.user, wallets.user, 'Phase 4 User', `user-${suffix}@example.test`, 'https://example.test/user.png',
      ids.admin, wallets.admin, 'Phase 4 Admin', `admin-${suffix}@example.test`, 'https://example.test/admin.png',
    ]
  )
  await pool.query(
    `insert into builders (id, user_id, wallet_address, display_name, bio, website_url)
     values ($1,$2,$3,$4,$5,$6)`,
    [ids.builder, ids.builderUser, wallets.builder, 'Phase 4 Builder', 'Closed-beta builder profile', 'https://example.test']
  )
  await pool.query(
    'insert into builder_earnings (id, builder_id) values ($1,$2)',
    [ids.builderEarnings, ids.builder]
  )
  await pool.query(
    'insert into admin_role_assignments (id, user_id, role) values ($1,$2,$3)',
    [ids.adminRole, ids.admin, 'SUPER_ADMIN']
  )
  await pool.query(
    'insert into credit_balances (id, user_id, balance_usd) values ($1,$2,$3)',
    [ids.balance, ids.user, '10.000000']
  )

  const [builderToken, userToken, adminToken] = await Promise.all([
    signJWT({ id: ids.builderUser, wallet_address: wallets.builder, display_name: 'Phase 4 Builder', is_builder: true, is_admin: false }),
    signJWT({ id: ids.user, wallet_address: wallets.user, display_name: 'Phase 4 User', is_builder: false, is_admin: false }),
    signJWT({ id: ids.admin, wallet_address: wallets.admin, display_name: 'Phase 4 Admin', is_builder: false, is_admin: true, admin_roles: ['SUPER_ADMIN'] }),
  ])

  const successSubscription = await request(builderToken, '/api/v1/builder/webhooks', {
    method: 'POST',
    body: {
      url: `${targetBase}/webhook`,
      description: 'successful closed-beta receiver',
      event_types: ['agent.revision.published'],
    },
  })
  assert.equal(successSubscription.status, 201)
  const successSecret = successSubscription.body.data.secret as string
  assert.equal(typeof successSecret, 'string')

  const createAgent = await request(builderToken, '/api/v1/builder/agents', {
    method: 'POST',
    body: {
      name: `Phase Four Agent ${suffix}`,
      description: 'A closed-beta agent used for the complete Phase 4 reliability journey.',
      category: 'PRODUCTIVITY',
      endpoint_url: `${targetBase}/agent`,
      price_per_call: 4,
      tags: ['phase4', 'closed-beta'],
    },
  })
  assert.equal(createAgent.status, 200)
  const agent = createAgent.body.data.agent as JsonObject
  assert.equal(agent.status, 'PENDING')
  assert.ok(agent.active_revision_id)

  const approval = await request(adminToken, `/api/v1/admin/agents/${agent.id}/decision`, {
    method: 'POST',
    body: { decision: 'APPROVE', reason: 'Closed-beta Phase 4 verification' },
  })
  assert.equal(approval.status, 200)
  pass('builder submission and governed approval work through the versioned API')

  const revisionBody = { change_summary: 'Concurrent idempotency verification', price_per_call: 4.25 }
  const revisionKey = `revision-race-${suffix}`
  const concurrentRevisionResponses = await Promise.all([
    request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions`, { method: 'POST', body: revisionBody, key: revisionKey }),
    request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions`, { method: 'POST', body: revisionBody, key: revisionKey }),
  ])
  assert(concurrentRevisionResponses.every((response) => [201, 409].includes(response.status)))
  const replay = await request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions`, {
    method: 'POST', body: revisionBody, key: revisionKey,
  })
  assert.equal(replay.status, 201)
  assert.equal(replay.headers.get('idempotency-replayed'), 'true')
  const draft = replay.body.data.revision as JsonObject
  const revisionCount = await pool.query(
    'select count(*)::int as count from agent_revisions where agent_id=$1 and change_summary=$2',
    [agent.id, revisionBody.change_summary]
  )
  assert.equal(revisionCount.rows[0].count, 1)
  const conflict = await request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions`, {
    method: 'POST', body: { ...revisionBody, price_per_call: 9 }, key: revisionKey,
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT')
  pass('concurrent idempotency produces one mutation, exact replay, and payload-conflict rejection')

  const staleKey = `revision-stale-${suffix}`
  const staleBody = { change_summary: 'Indeterminate crash protection', price_per_call: 4.5 }
  const staleFirst = await request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions`, {
    method: 'POST', body: staleBody, key: staleKey,
  })
  assert.equal(staleFirst.status, 201)
  await pool.query(
    `update api_idempotency_records
        set status='PROCESSING', response_status=null, response_body=null,
            locked_until=now() - interval '1 second'
      where user_id=$1 and idempotency_key=$2`,
    [ids.builderUser, staleKey]
  )
  const beforeIndeterminate = await pool.query('select count(*)::int as count from agent_revisions where agent_id=$1', [agent.id])
  const indeterminate = await request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions`, {
    method: 'POST', body: staleBody, key: staleKey,
  })
  const afterIndeterminate = await pool.query('select count(*)::int as count from agent_revisions where agent_id=$1', [agent.id])
  assert.equal(indeterminate.status, 409)
  assert.equal(indeterminate.body.code, 'IDEMPOTENCY_INDETERMINATE')
  assert.equal(afterIndeterminate.rows[0].count, beforeIndeterminate.rows[0].count)
  pass('expired unknown outcomes fail closed instead of blindly duplicating a committed mutation')

  const publishResults = await Promise.all([
    request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions/${draft.id}/publish`, { method: 'POST', body: {} }),
    request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions/${draft.id}/publish`, { method: 'POST', body: {} }),
  ])
  assert.deepEqual(publishResults.map((result) => result.status).sort(), [200, 409])
  await assert.rejects(
    pool.query('update agent_revisions set name=$1 where id=$2', ['Mutated after publish', draft.id]),
    /published agent revisions are immutable/
  )
  const publishedEvent = await pool.query(
    `select e.id, count(d.id)::int as deliveries
       from webhook_events e left join webhook_deliveries d on d.event_id=e.id
      where e.dedupe_key=$1 group by e.id`,
    [`agent.revision.published:${agent.id}:${draft.id}`]
  )
  assert.equal(publishedEvent.rowCount, 1)
  assert.equal(publishedEvent.rows[0].deliveries, 1)
  const deliveryRace = await Promise.all([processWebhookBatch(), processWebhookBatch()])
  assert.equal(deliveryRace.reduce((sum, item) => sum + item.claimed, 0), 1)
  const revisionCapture = captured.find((entry) => entry.headers['x-velostra-event-id'] === publishedEvent.rows[0].id)
  assert(revisionCapture)
  const revisionTimestamp = String(revisionCapture.headers['x-velostra-timestamp'])
  assert.equal(
    revisionCapture.headers['x-velostra-signature'],
    signWebhookBody(successSecret, revisionTimestamp, publishedEvent.rows[0].id, revisionCapture.body)
  )
  pass('revision publish race has one winner and one signed webhook delivery across concurrent workers')

  await pool.query(
    `insert into agent_calls
       (id,agent_id,user_id,agent_revision_id,input,output,status,price_charged,builder_earned,platform_earned,execution_ms,completed_at)
     values
       ($1,$2,$3,$4,$5,$6,'SUCCESS','4.000000','3.600000','0.400000',100,now()),
       ($7,$2,$3,$4,$8,$9,'FAILED','0.000000','0.000000','0.000000',300,now())`,
    [
      ids.callSuccess, agent.id, ids.user, draft.id, 'private successful input', JSON.stringify({ secretResult: true }),
      ids.callFailure, 'private failed input', JSON.stringify({ partial: true }),
    ]
  )
  await pool.query(
    `insert into transactions
       (id,credit_balance_id,agent_call_id,type,amount,tx_hash,wallet_address,chain_id,contract_address,event_name,status,confirmed_at)
     values ($1,$2,$3,'AGENT_CALL','4.000000',$4,$5,4663,$6,'EarningsCredited','CONFIRMED',now())`,
    [ids.transaction, ids.balance, ids.callSuccess, `0x${'a'.repeat(58)}${suffix.slice(-6)}`, wallets.user, '0x4000000000000000000000000000000000000004']
  )
  const ownedCallStatus = await request(userToken, `/api/v1/dashboard/calls/${ids.callSuccess}`)
  assert.equal(ownedCallStatus.status, 200)
  assert.equal(ownedCallStatus.body.data.call.id, ids.callSuccess)
  assert.equal(ownedCallStatus.body.data.call.status, 'SUCCESS')
  assert.deepEqual(ownedCallStatus.body.data.call.output, { secretResult: true })
  const foreignCallStatus = await request(builderToken, `/api/v1/dashboard/calls/${ids.callSuccess}`)
  assert.equal(foreignCallStatus.status, 404)
  const invalidCallStatus = await request(userToken, '/api/v1/dashboard/calls/not%20safe')
  assert.equal(invalidCallStatus.status, 400)
  pass('call recovery status is owner-scoped and exposes completed output without cross-wallet leakage')
  await pool.query(
    `insert into earnings_claims (id,builder_id,amount,status,tx_hash,wallet_address,chain_id,completed_at)
     values ($1,$2,'1.200000','COMPLETED',$3,$4,4663,now())`,
    [ids.claim, ids.builder, `0x${'b'.repeat(58)}${suffix.slice(-6)}`, wallets.builder]
  )
  const analytics = await request(builderToken, '/api/v1/builder/analytics')
  assert.equal(analytics.status, 200)
  assert.deepEqual(analytics.body.data.summary, {
    calls: 2,
    successes: 1,
    errors: 1,
    success_rate: 0.5,
    gross_volume: 4,
    builder_earnings: 3.6,
    claims: 1,
    claimed_amount: 1.2,
    average_latency_ms: 200,
  })
  pass('builder analytics exactly reconcile calls, failures, volume, earnings, claims, and latency')

  const failureSubscription = await request(builderToken, '/api/v1/builder/webhooks', {
    method: 'POST',
    body: {
      url: `${targetBase}/webhook-fail`,
      description: 'dead-letter closed-beta receiver',
      event_types: ['report.created'],
    },
  })
  assert.equal(failureSubscription.status, 201)
  const failureSubscriptionId = failureSubscription.body.data.subscription.id as string
  const failureSecret = failureSubscription.body.data.secret as string

  const unsafeReport = await request(userToken, `/api/v1/trust/agents/${agent.id}/reports`, {
    method: 'POST',
    body: {
      reason: 'NOT_WORKING',
      description: 'This report deliberately contains unsafe evidence.',
      evidence: { raw_prompt: 'must never be persisted' },
    },
  })
  assert.equal(unsafeReport.status, 400)
  const reportResponse = await request(userToken, `/api/v1/trust/agents/${agent.id}/reports`, {
    method: 'POST',
    body: {
      reason: 'NOT_WORKING',
      description: 'The correlated execution did not match the documented behavior.',
      evidence: { call_id: ids.callSuccess, content_hash: 'c'.repeat(64) },
    },
  })
  assert.equal(reportResponse.status, 201)
  const reportId = reportResponse.body.data.report.id as string
  await processWebhookBatch()
  await new Promise((resolve) => setTimeout(resolve, 5))
  await processWebhookBatch()
  const deadLetter = await pool.query(
    `select d.id,d.status,d.attempt_count,e.id as event_id
       from webhook_deliveries d join webhook_events e on e.id=d.event_id
      where d.subscription_id=$1 and e.aggregate_id=$2`,
    [failureSubscriptionId, reportId]
  )
  assert.equal(deadLetter.rows[0].status, 'DEAD_LETTER')
  assert.equal(deadLetter.rows[0].attempt_count, 2)
  const replayRace = await Promise.all([
    request(adminToken, `/api/v1/admin/webhooks/deliveries/${deadLetter.rows[0].id}/replay`, { method: 'POST', body: {} }),
    request(adminToken, `/api/v1/admin/webhooks/deliveries/${deadLetter.rows[0].id}/replay`, { method: 'POST', body: {} }),
  ])
  assert.deepEqual(replayRace.map((result) => result.status).sort(), [200, 409])
  await pool.query('update webhook_subscriptions set url=$1 where id=$2', [`${targetBase}/webhook`, failureSubscriptionId])
  await processWebhookBatch()
  const recoveredDelivery = await pool.query(
    'select status,attempt_count from webhook_deliveries where id=$1',
    [deadLetter.rows[0].id]
  )
  assert.equal(recoveredDelivery.rows[0].status, 'DELIVERED')
  assert.equal(recoveredDelivery.rows[0].attempt_count, 1)
  const attempts = await pool.query(
    'select attempt_number from webhook_delivery_attempts where delivery_id=$1 order by attempt_number',
    [deadLetter.rows[0].id]
  )
  assert.deepEqual(attempts.rows.map((row) => row.attempt_number), [1, 2, 3])
  const recoveredCapture = captured.find((entry) => entry.headers['x-velostra-event-id'] === deadLetter.rows[0].event_id)
  assert(recoveredCapture)
  assert.equal(
    recoveredCapture.headers['x-velostra-signature'],
    signWebhookBody(
      failureSecret,
      String(recoveredCapture.headers['x-velostra-timestamp']),
      deadLetter.rows[0].event_id,
      recoveredCapture.body
    )
  )
  pass('webhook failure retries, dead-letters, single-winner replay, and recovers with preserved attempt history')

  const moderationRace = await Promise.all([
    request(adminToken, `/api/v1/admin/reports/${reportId}/resolve`, {
      method: 'POST', body: { status: 'REVIEWED', note: 'First concurrent moderation decision.' },
    }),
    request(adminToken, `/api/v1/admin/reports/${reportId}/resolve`, {
      method: 'POST', body: { status: 'REVIEWED', note: 'Second concurrent moderation decision.' },
    }),
  ])
  assert.deepEqual(moderationRace.map((result) => result.status).sort(), [200, 409])
  const moderationCount = await pool.query(
    "select count(*)::int as count from moderation_actions where report_id=$1 and action='report.resolve'",
    [reportId]
  )
  assert.equal(moderationCount.rows[0].count, 1)
  pass('evidence-safe reporting and concurrent moderation produce one accountable state transition')

  const firstRevisionPage = await request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions?limit=1`)
  assert.equal(firstRevisionPage.status, 200)
  assert.equal(firstRevisionPage.body.data.length, 1)
  assert.equal(firstRevisionPage.body.page.has_more, true)
  const cursor = firstRevisionPage.body.page.next_cursor as string
  const nextRevisionPage = await request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions?limit=1&cursor=${encodeURIComponent(cursor)}`)
  assert.equal(nextRevisionPage.status, 200)
  assert.notEqual(nextRevisionPage.body.data[0].id, firstRevisionPage.body.data[0].id)
  const tamperedCursor = await request(builderToken, `/api/v1/builder/agents/${agent.id}/revisions?limit=1&cursor=${encodeURIComponent(cursor + 'x')}`)
  assert.equal(tamperedCursor.status, 400)
  pass('cursor pagination is stable, non-overlapping, and tamper-evident')

  const exportRequest = await request(userToken, '/api/v1/privacy/requests', {
    method: 'POST', body: { type: 'EXPORT', reason: 'Closed-beta portability verification' },
  })
  assert.equal(exportRequest.status, 201)
  const exportId = exportRequest.body.data.request.id as string
  assert.equal((await request(adminToken, `/api/v1/admin/privacy/requests/${exportId}/process`, { method: 'POST', body: { action: 'START' } })).status, 200)
  assert.equal((await request(adminToken, `/api/v1/admin/privacy/requests/${exportId}/process`, { method: 'POST', body: { action: 'COMPLETE' } })).status, 200)
  const exportDownload = await request(userToken, `/api/v1/privacy/requests/${exportId}/export`)
  assert.equal(exportDownload.status, 200)
  assert.equal(exportDownload.headers.get('cache-control'), 'no-store, private')
  assert.equal(exportDownload.body.data.request_id, exportId)
  assert(exportDownload.body.data.export.calls.some((call: JsonObject) => call.id === ids.callSuccess))

  const deleteRequest = await request(userToken, '/api/v1/privacy/requests', {
    method: 'POST', body: { type: 'DELETE', reason: 'Closed-beta erasure verification' },
  })
  assert.equal(deleteRequest.status, 201)
  const deleteId = deleteRequest.body.data.request.id as string
  assert.equal((await request(adminToken, `/api/v1/admin/privacy/requests/${deleteId}/process`, { method: 'POST', body: { action: 'START' } })).status, 200)
  assert.equal((await request(adminToken, `/api/v1/admin/privacy/requests/${deleteId}/process`, { method: 'POST', body: { action: 'COMPLETE' } })).status, 200)
  const privacyState = await pool.query(
    `select u.wallet_address,u.display_name,u.email,c.input,c.output,t.tx_hash,t.amount
       from users u join agent_calls c on c.user_id=u.id
       join transactions t on t.agent_call_id=c.id
      where u.id=$1 and c.id=$2`,
    [ids.user, ids.callSuccess]
  )
  assert.equal(privacyState.rows[0].wallet_address, wallets.user)
  assert.equal(privacyState.rows[0].display_name, null)
  assert.equal(privacyState.rows[0].email, null)
  assert.equal(privacyState.rows[0].input, '[redacted by completed privacy deletion request]')
  assert.equal(privacyState.rows[0].output, null)
  assert.equal(privacyState.rows[0].amount, '4.000000')
  assert.ok(privacyState.rows[0].tx_hash)
  pass('privacy export works and deletion erases personal content while retaining financial and chain evidence')

  const prohibitedTelemetry = await request(adminToken, '/api/v1/admin/telemetry/fields/raw_prompt', {
    method: 'PUT',
    body: {
      classification: 'PROHIBITED',
      purpose: 'This field must remain disabled.',
      owner: 'Security',
      retention_days: 0,
      enabled: true,
    },
  })
  assert.equal(prohibitedTelemetry.status, 409)
  const telemetryState = await pool.query("select enabled from telemetry_field_registry where field_name='raw_prompt'")
  assert.equal(telemetryState.rows[0].enabled, false)
  pass('prohibited telemetry remains fail-closed through both API policy and database invariant')

  const aggregateAudit = await pool.query(
    `select
       (select count(*)::int from agent_revisions where agent_id=$1 and change_summary=$2) as idempotent_revisions,
       (select count(*)::int from webhook_events where dedupe_key=$3) as revision_events,
       (select count(*)::int from webhook_deliveries d join webhook_events e on e.id=d.event_id where e.dedupe_key=$3) as revision_deliveries,
       (select count(*)::int from reports where id=$4) as reports,
       (select count(*)::int from moderation_actions where report_id=$4 and action='report.resolve') as resolutions`,
    [agent.id, revisionBody.change_summary, `agent.revision.published:${agent.id}:${draft.id}`, reportId]
  )
  assert.deepEqual(aggregateAudit.rows[0], {
    idempotent_revisions: 1,
    revision_events: 1,
    revision_deliveries: 1,
    reports: 1,
    resolutions: 1,
  })
  pass('closed-beta journey exits with zero duplicate platform mutations or delivery drift')
  console.log('\nPHASE 4 PLATFORM DATABASE, RACE, DELIVERY, TRUST, AND PRIVACY E2E VERIFIED\n')
} finally {
  await Promise.all([
    new Promise<void>((resolve) => appServer.close(() => resolve())),
    new Promise<void>((resolve) => target.close(() => resolve())),
  ])
  await pool.end()
}
