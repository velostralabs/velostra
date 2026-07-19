import 'express-async-errors'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { attachAuth } from './middleware/auth.js'
import { authRouter } from './routes/auth.js'
import { agentsRouter } from './routes/agents.js'
import { builderRouter } from './routes/builder.js'
import { adminRouter } from './routes/admin.js'
import { dashboardRouter } from './routes/dashboard.js'
import { v1Router } from './routes/v1.js'
import {
  assertProductionConfiguration,
  isProduction,
  jsonBodyLimit,
  trustProxy,
  webOrigins,
} from './lib/config.js'
import { AppError } from './lib/errors.js'
import { metricsHandler, readinessHandler, requestObservability } from './lib/observability/http.js'
import { logger } from './lib/observability/logger.js'
import { apiV1Headers, legacyApiHeaders } from './lib/platform/http.js'
import { durableIdempotency } from './lib/platform/idempotency.js'

export function createApp(): express.Express {
  assertProductionConfiguration()
  const app = express()
  const allowedOrigins = new Set(webOrigins())

  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy())

  app.use((req, res, next) => {
    const supplied = req.header('x-request-id')
    req.requestId = supplied && /^[a-zA-Z0-9._:-]{1,128}$/.test(supplied)
      ? supplied
      : crypto.randomUUID()
    res.setHeader('X-Request-Id', req.requestId)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    if (isProduction()) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    next()
  })
  app.use(requestObservability)

  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true)
        return callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'))
      },
    })
  )
  app.use(express.json({ limit: jsonBodyLimit(), strict: true }))
  app.use(cookieParser())
  app.use(attachAuth)

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'velostra-api',
      environment: process.env.VELOSTRA_ENVIRONMENT ?? 'local',
      release: process.env.VELOSTRA_RELEASE ?? 'development',
      chain: 'Robinhood Chain',
      chainId: Number(process.env.ROBINHOOD_CHAIN_ID ?? 4663),
    })
  })
  app.get('/ready', readinessHandler)
  app.get('/metrics', metricsHandler)

  app.use('/api/v1', apiV1Headers, durableIdempotency, v1Router)

  app.use('/api/auth', legacyApiHeaders('/api/v1/auth'), authRouter)
  app.use('/api/agents', legacyApiHeaders('/api/v1/agents'), agentsRouter)
  app.use('/api/builder', legacyApiHeaders('/api/v1/builder'), builderRouter)
  app.use('/api/admin', legacyApiHeaders('/api/v1/admin'), adminRouter)
  app.use('/api/dashboard', legacyApiHeaders('/api/v1/dashboard'), dashboardRouter)

  app.use((_req, _res, next) => {
    next(new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found'))
  })

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const entityError = error as { type?: string; status?: number }
    const normalized = error instanceof AppError
      ? error
      : entityError.type === 'entity.too.large'
        ? new AppError(413, 'REQUEST_TOO_LARGE', 'Request body exceeds the configured limit')
        : error instanceof SyntaxError && entityError.status === 400
          ? new AppError(400, 'INVALID_JSON', 'Request body contains invalid JSON')
          : new AppError(500, 'INTERNAL_ERROR', 'Internal server error', { expose: false, cause: error })

    if (normalized.status >= 500) {
      logger.error('http_request_failed', {
        requestId: req.requestId,
        code: normalized.code,
        path: req.originalUrl,
        method: req.method,
        error,
      })
    }

    res.status(normalized.status).json({
      error: normalized.expose ? normalized.message : 'Internal server error',
      code: normalized.code,
      request_id: req.requestId,
      ...(normalized.expose && normalized.details !== undefined
        ? { details: normalized.details }
        : {}),
    })
  })

  return app
}

declare global {
  namespace Express {
    interface Request {
      requestId: string
    }
  }
}