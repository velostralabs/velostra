import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: positiveInteger('DATABASE_POOL_MAX', 10),
  connectionTimeoutMillis: positiveInteger('DATABASE_CONNECTION_TIMEOUT_MS', 5_000),
  idleTimeoutMillis: positiveInteger('DATABASE_IDLE_TIMEOUT_MS', 30_000),
  application_name:
    `velostra-${process.env.VELOSTRA_ENVIRONMENT ?? 'local'}-${process.env.VELOSTRA_PROCESS_ROLE ?? 'api'}`,
})

export const db = drizzle(pool, { schema })
export { pool }
