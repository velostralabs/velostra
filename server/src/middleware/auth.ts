import type { Request, Response, NextFunction } from 'express'
import { verifyAuth, type AuthPayload } from '../lib/auth.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload
    }
  }
}

export async function attachAuth(req: Request, _res: Response, next: NextFunction) {
  req.auth = (await verifyAuth(req)) ?? undefined
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Sign in required' })
  next()
}

export function requireBuilder(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.is_builder) return res.status(403).json({ error: 'Builder account required' })
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.is_admin) return res.status(403).json({ error: 'Admin access required' })
  next()
}
