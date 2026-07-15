import 'dotenv/config'
import { createApp } from './app.js'
import { pool } from './db/client.js'
import { assertSecurityReadiness } from './lib/security-readiness.js'
import { closeRedis } from './lib/redis.js'
import { logger } from './lib/observability/logger.js'
import { startApiObservability } from './lib/observability/runtime.js'

process.on('unhandledRejection', (reason) => {
  logger.error('process_unhandled_rejection', { reason })
})
process.on('uncaughtException', (error) => {
  logger.error('process_uncaught_exception', { error })
})

async function main(): Promise<void> {
  const port = process.env.PORT ? Number(process.env.PORT) : 8787
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  await assertSecurityReadiness()
  const app = createApp()
  const stopObservability = startApiObservability()
  const server = app.listen(port, () => {
    logger.info('api_listening', { port, chain: 'Robinhood Chain', chainId: 4663 })
  })

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    logger.info('api_shutdown_started', { signal })
    stopObservability()
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('HTTP server shutdown timed out')),
        Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 20_000)
      )
      server.close((error) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      })
    })
    await closeRedis()
    await pool.end()
    logger.info('api_shutdown_complete')
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.error('startup_fatal', { error })
  process.exitCode = 1
})
