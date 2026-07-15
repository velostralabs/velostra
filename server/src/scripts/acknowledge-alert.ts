import 'dotenv/config'
import { pool } from '../db/client.js'
import { acknowledgeAlert } from '../lib/observability/alerts.js'

async function main(): Promise<void> {
  const alert = process.argv[2]
  const operator = process.argv[3]
  if (!alert || !operator || operator.length < 3) {
    throw new Error('Usage: npm run alert:ack -- <alert-id-or-fingerprint> <operator>')
  }
  if (!(await acknowledgeAlert(alert, operator))) {
    throw new Error('Open alert was not found')
  }
  console.info('[alert] acknowledged', { alert, operator })
}

main()
  .catch((error) => {
    console.error('[alert] acknowledgement failed', error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
