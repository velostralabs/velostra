import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from '../db/client.js'
import { assertProductionConfiguration } from '../lib/config.js'

async function main(): Promise<void> {
  assertProductionConfiguration()
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const migrationsFolder = path.resolve(moduleDirectory, '../../drizzle')

  console.info('[migration] applying versioned migrations', {
    environment: process.env.VELOSTRA_ENVIRONMENT ?? 'local',
    release: process.env.VELOSTRA_RELEASE ?? 'development',
  })
  await migrate(db, { migrationsFolder })
  console.info('[migration] complete')
}

main()
  .catch((error) => {
    console.error('[migration] fatal', error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
