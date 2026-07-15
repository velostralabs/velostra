import 'dotenv/config'
import { createApp } from './app.js'

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error)
})

const port = process.env.PORT ? Number(process.env.PORT) : 8787
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const app = createApp()
app.listen(port, () => {
  console.log(`[velostra-server] listening on :${port} — Robinhood Chain (4663)`)
})