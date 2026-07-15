import { AppError } from '../errors.js'

export const PRODUCT_TELEMETRY_POLICY = {
  request_id: { classification: 'OPERATIONAL', retentionDays: 30 },
  route: { classification: 'OPERATIONAL', retentionDays: 30 },
  status_code: { classification: 'OPERATIONAL', retentionDays: 30 },
  duration_ms: { classification: 'OPERATIONAL', retentionDays: 30 },
  call_id: { classification: 'SENSITIVE', retentionDays: 30 },
} as const

export const PROHIBITED_TELEMETRY_FIELDS = new Set([
  'raw_prompt',
  'prompt',
  'input',
  'output',
  'private_key',
  'secret',
  'token',
  'authorization',
  'cookie',
  'signature',
])

export function sanitizeProductTelemetry(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (PROHIBITED_TELEMETRY_FIELDS.has(key.toLowerCase())) {
      throw new AppError(400, 'TELEMETRY_FIELD_PROHIBITED', `Telemetry field ${key} is prohibited`)
    }
    if (!(key in PRODUCT_TELEMETRY_POLICY)) {
      throw new AppError(400, 'TELEMETRY_FIELD_UNCLASSIFIED', `Telemetry field ${key} is not classified`)
    }
    if (typeof value === 'string' && value.length > 256) {
      sanitized[key] = value.slice(0, 256)
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
    } else {
      throw new AppError(400, 'TELEMETRY_VALUE_INVALID', `Telemetry field ${key} has an invalid value`)
    }
  }
  return sanitized
}
