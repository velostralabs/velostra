import 'dotenv/config'
import { pool } from '../db/client.js'
import { recordHeartbeat, type HeartbeatStatus } from '../lib/observability/heartbeats.js'

async function main(): Promise<void> {
  const service = process.argv[2]
  const status = (process.argv[3] ?? 'ok') as HeartbeatStatus
  if (!service || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(service)) {
    throw new Error('Heartbeat service must be a lowercase service identifier')
  }
  if (!['ok', 'degraded', 'failed'].includes(status)) {
    throw new Error('Heartbeat status must be ok, degraded, or failed')
  }
  await recordHeartbeat(service, status, { source: 'operator-command' })
  console.info('[heartbeat] recorded', { service, status })
}

main()
  .catch((error) => {
    console.error('[heartbeat] failed', error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
