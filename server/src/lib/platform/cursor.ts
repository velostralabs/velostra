import crypto from 'node:crypto'
import { AppError } from '../errors.js'

interface CursorPayload {
  v: 1
  scope: string
  created_at: string
  id: string
}

function signingSecret(): string {
  const configured = process.env.PLATFORM_CURSOR_SECRET?.trim()
  if (configured) {
    if (configured.length < 32) throw new Error('PLATFORM_CURSOR_SECRET must contain at least 32 characters')
    return configured
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PLATFORM_CURSOR_SECRET is required in production')
  }
  return 'velostra-local-cursor-secret-not-for-production'
}

function signature(encoded: string): Buffer {
  return crypto.createHmac('sha256', signingSecret()).update(encoded).digest()
}

export function cursorScope(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function encodeCursor(boundary: { createdAt: Date; id: string }, scope: string): string {
  const payload: CursorPayload = {
    v: 1,
    scope,
    created_at: boundary.createdAt.toISOString(),
    id: boundary.id,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return encoded + '.' + signature(encoded).toString('base64url')
}

export function decodeCursor(cursor: string, expectedScope: string): { createdAt: Date; id: string } {
  const [encoded, supplied, ...extra] = cursor.split('.')
  if (!encoded || !supplied || extra.length > 0) throw invalidCursor()

  let suppliedSignature: Buffer
  try {
    suppliedSignature = Buffer.from(supplied, 'base64url')
  } catch {
    throw invalidCursor()
  }
  const expected = signature(encoded)
  if (suppliedSignature.length !== expected.length || !crypto.timingSafeEqual(suppliedSignature, expected)) {
    throw invalidCursor()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor()
  }
  if (!parsed || typeof parsed !== 'object') throw invalidCursor()
  const payload = parsed as Partial<CursorPayload>
  if (
    payload.v !== 1 ||
    payload.scope !== expectedScope ||
    typeof payload.created_at !== 'string' ||
    typeof payload.id !== 'string' ||
    payload.id.length < 1 ||
    payload.id.length > 128
  ) {
    throw invalidCursor()
  }
  const createdAt = new Date(payload.created_at)
  if (!Number.isFinite(createdAt.getTime())) throw invalidCursor()
  return { createdAt, id: payload.id }
}

function invalidCursor(): AppError {
  return new AppError(400, 'INVALID_CURSOR', 'Cursor is invalid or does not match this query')
}
