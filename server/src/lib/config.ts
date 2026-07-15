import type { CookieOptions } from 'express'

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function webOrigins(): string[] {
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (origins.length === 0) throw new Error('WEB_ORIGIN must contain at least one origin')

  for (const origin of origins) {
    const parsed = new URL(origin)
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      throw new Error(`WEB_ORIGIN contains an invalid origin: ${origin}`)
    }
    if (isProduction() && parsed.protocol !== 'https:') {
      throw new Error(`Production WEB_ORIGIN must use HTTPS: ${origin}`)
    }
  }
  return origins
}

export function jsonBodyLimit(): string {
  return process.env.JSON_BODY_LIMIT ?? '64kb'
}

export function trustProxy(): boolean | number | string {
  const value = process.env.TRUST_PROXY
  if (!value || value === 'false') return false
  if (value === 'true') return true
  if (/^\d+$/.test(value)) return Number(value)
  return value
}

export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  }
}

export function clearAuthCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...options } = authCookieOptions()
  return options
}

export function assertProductionConfiguration(): void {
  webOrigins()
  if (!isProduction()) return

  const jwtSecret = process.env.JWT_SECRET ?? ''
  if (jwtSecret.length < 32 || jwtSecret === 'dev-secret-change-me') {
    throw new Error('Production JWT_SECRET must be at least 32 characters and non-default')
  }
  if (!process.env.REDIS_URL) throw new Error('Production REDIS_URL is required')
  if (process.env.REDIS_FAILURE_MODE === 'open') {
    throw new Error('Production REDIS_FAILURE_MODE cannot be open')
  }
  if (!process.env.AGENT_SECRET_ENCRYPTION_KEY) {
    throw new Error('Production AGENT_SECRET_ENCRYPTION_KEY is required')
  }
}