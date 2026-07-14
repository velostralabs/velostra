import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { attachAuth } from './middleware/auth.js'
import { authRouter } from './routes/auth.js'
import { agentsRouter } from './routes/agents.js'
import { builderRouter } from './routes/builder.js'
import { adminRouter } from './routes/admin.js'
import { dashboardRouter } from './routes/dashboard.js'

// Last-resort safety nets: log and keep serving other requests instead of
// taking the whole process down. Express route errors are handled by the
// error middleware below (via express-async-errors); these two catch
// anything outside the request/response lifecycle (e.g. a stray timer).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

const app = express()

app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  })
)
app.use(express.json())
app.use(cookieParser())
app.use(attachAuth)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', chain: 'Robinhood Chain', chainId: 4663 })
})

app.use('/api/auth', authRouter)
app.use('/api/agents', agentsRouter)
app.use('/api/builder', builderRouter)
app.use('/api/admin', adminRouter)
app.use('/api/dashboard', dashboardRouter)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787
app.listen(PORT, () => {
  console.log(`[velostra-server] listening on :${PORT} — Robinhood Chain (4663)`)
})
