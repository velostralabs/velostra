import type { CookieOptions } from 'express'
import {
  assertDeploymentConfiguration,
  deploymentProcessRole,
} from './deployment-config.js'

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
      throw new Error('WEB_ORIGIN contains an invalid origin: ' + origin)
    }
    if (isProduction() && parsed.protocol !== 'https:') {
      throw new Error('Production WEB_ORIGIN must use HTTPS: ' + origin)
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
    // The managed web and API are separate HTTPS origins. Production cookies
    // therefore need the explicit cross-site attribute or browsers will omit
    // the session on API requests made by the web application.
    sameSite: isProduction() ? 'none' : 'lax',
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
  if (!isProduction()) {
    webOrigins()
    return
  }
  const role = deploymentProcessRole()
  assertDeploymentConfiguration(role, role === 'api' ? webOrigins() : [])
}
