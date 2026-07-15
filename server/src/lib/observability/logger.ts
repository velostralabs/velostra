type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

const sensitiveKey = /authorization|cookie|secret|token|password|private.?key|signature/i

function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]'
  if (depth > 4) return '[TRUNCATED]'
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: value.stack }),
    }
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, key, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Fields)
        .slice(0, 100)
        .map(([nestedKey, nestedValue]) => [
          nestedKey,
          sanitize(nestedValue, nestedKey, depth + 1),
        ])
    )
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' && value.length > 2_000) return value.slice(0, 2_000) + '…'
  return value
}

function emit(level: LogLevel, event: string, fields: Fields = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: process.env.VELOSTRA_PROCESS_ROLE ?? 'api',
    environment: process.env.VELOSTRA_ENVIRONMENT ?? 'local',
    release: process.env.VELOSTRA_RELEASE ?? 'development',
    event,
    ...(sanitize(fields) as Fields),
  }
  const line = JSON.stringify(record)
  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const logger = {
  debug: (event: string, fields?: Fields) => emit('debug', event, fields),
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
}
