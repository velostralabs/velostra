import crypto from 'node:crypto'
import type { RequestHandler } from 'express'
import { createId } from '@paralleldrive/cuid2'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { apiIdempotencyRecords } from '../../db/schema.js'
import { AppError } from '../errors.js'

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/
const LOCK_MS = 5 * 60 * 1000
const RETENTION_MS = 24 * 60 * 60 * 1000

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map((key) => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}'
}

function requestHash(req: Parameters<RequestHandler>[0]): string {
  return crypto
    .createHash('sha256')
    .update(canonical({ method: req.method, path: req.baseUrl + req.path, body: req.body ?? null }))
    .digest('hex')
}

export const durableIdempotency: RequestHandler = async (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || req.path.startsWith('/auth/')) {
    return next()
  }
  if (!req.auth) return next()

  const key = req.header('idempotency-key')?.trim()
  if (!key || !KEY_PATTERN.test(key)) {
    return next(new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must contain 8-128 safe characters'))
  }

  const operation = req.method + ':' + req.baseUrl + req.path
  const hash = requestHash(req)
  const now = new Date()
  const id = createId()
  const [inserted] = await db
    .insert(apiIdempotencyRecords)
    .values({
      id,
      user_id: req.auth.id,
      operation,
      idempotency_key: key,
      request_hash: hash,
      locked_until: new Date(now.getTime() + LOCK_MS),
      expires_at: new Date(now.getTime() + RETENTION_MS),
    })
    .onConflictDoNothing()
    .returning({ id: apiIdempotencyRecords.id })

  if (!inserted) {
    const [existing] = await db
      .select()
      .from(apiIdempotencyRecords)
      .where(
        and(
          eq(apiIdempotencyRecords.user_id, req.auth.id),
          eq(apiIdempotencyRecords.operation, operation),
          eq(apiIdempotencyRecords.idempotency_key, key)
        )
      )
      .limit(1)
    if (!existing) return next(new AppError(409, 'IDEMPOTENCY_RACE', 'Idempotency state is not yet visible'))
    if (existing.request_hash !== hash) {
      return next(new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for a different request'))
    }
    if (existing.status === 'PROCESSING') {
      res.setHeader('Retry-After', '2')
      return next(new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The original request is still processing'))
    }
    res.setHeader('Idempotency-Replayed', 'true')
    return res.status(existing.response_status ?? 500).json(existing.response_body)
  }

  const originalJson = res.json.bind(res)
  let persisted = false
  res.json = ((body: unknown) => {
    if (persisted) return originalJson(body)
    persisted = true
    const responseStatus = res.statusCode
    void db
      .update(apiIdempotencyRecords)
      .set({
        status: responseStatus >= 500 ? 'FAILED' : 'COMPLETED',
        response_status: responseStatus,
        response_body: body,
        updated_at: new Date(),
      })
      .where(eq(apiIdempotencyRecords.id, id))
      .then(() => originalJson(body))
      .catch(next)
    return res
  }) as typeof res.json
  next()
}
