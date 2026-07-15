import type { Request, Response, NextFunction } from 'express'
import { verifyAuth, type AuthPayload } from '../lib/auth.js'
import {
  activeAdminRoles,
  rolesAllow,
  type AdminPermission,
  type AdminRole,
} from '../lib/admin.js'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload
      adminRoles?: AdminRole[]
    }
  }
}

export async function attachAuth(req: Request, _res: Response, next: NextFunction) {
  req.auth = (await verifyAuth(req)) ?? undefined
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: 'Sign in required', code: 'AUTH_REQUIRED' })
  }
  next()
}

export function requireBuilder(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.is_builder) {
    return res.status(403).json({ error: 'Builder account required', code: 'BUILDER_REQUIRED' })
  }
  next()
}

export function requireAdminPermission(permission: AdminPermission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Sign in required', code: 'AUTH_REQUIRED' })
    }
    const roles = await activeAdminRoles(req.auth.id)
    if (!rolesAllow(roles, permission)) {
      return res.status(403).json({ error: 'Admin permission required', code: 'ADMIN_FORBIDDEN' })
    }
    req.adminRoles = roles
    next()
  }
}
