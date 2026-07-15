import crypto from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { logger } from './logger.js'
import {
  getOperationalSnapshot,
  observeRequest,
  renderPrometheus,
} from './metrics.js'
import { readinessFromSnapshot } from './operations.js'

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  )
}

export function requestObservability(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const started = performance.now()
  res.once('finish', () => {
    if (req.path === '/health' || req.path === '/metrics') return
    logger.info('http_request_completed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      userAgent: req.header('user-agent'),
    })
  })
  observeRequest(req, res, next)
}

export const readinessHandler: RequestHandler = (_req, res) => {
  const readiness = readinessFromSnapshot(getOperationalSnapshot())
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    environment: process.env.VELOSTRA_ENVIRONMENT ?? 'local',
    release: process.env.VELOSTRA_RELEASE ?? 'development',
    ...readiness,
  })
}

export const metricsHandler: RequestHandler = (req, res) => {
  const configured = process.env.METRICS_AUTH_TOKEN?.trim()
  const supplied = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (
    (process.env.NODE_ENV === 'production' && !configured) ||
    (configured && !constantTimeEqual(configured, supplied))
  ) {
    res.status(401).json({ error: 'Unauthorized', code: 'METRICS_AUTH_REQUIRED' })
    return
  }
  res.type('text/plain; version=0.0.4; charset=utf-8').send(renderPrometheus())
}
