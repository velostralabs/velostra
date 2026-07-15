import { Router } from 'express'
import { z } from 'zod'
import { generateAuthNonce, completeWalletLogin } from '../lib/auth.js'
import { authCookieOptions, clearAuthCookieOptions } from '../lib/config.js'

export const authRouter = Router()

const nonceSchema = z.object({ walletAddress: z.string() })

authRouter.post('/nonce', async (req, res) => {
  const parsed = nonceSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'walletAddress is required', code: 'INVALID_WALLET_INPUT' })

  try {
    const { message, nonce } = await generateAuthNonce(parsed.data.walletAddress)
    res.json({ message, nonce })
  } catch {
    res.status(400).json({ error: 'Invalid EVM wallet address', code: 'INVALID_WALLET_ADDRESS' })
  }
})

const loginSchema = z.object({
  walletAddress: z.string(),
  signature: z.string(),
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'walletAddress and signature are required', code: 'INVALID_LOGIN_INPUT' })

  const result = await completeWalletLogin(
    parsed.data.walletAddress,
    parsed.data.signature as `0x${string}`
  )

  if ('error' in result) return res.status(401).json({ error: result.error, code: 'AUTH_VERIFICATION_FAILED' })

  res
    .cookie('velostra_token', result.token, authCookieOptions())

    .json(result)
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('velostra_token', clearAuthCookieOptions()).json({ ok: true })
})

authRouter.get('/me', async (req, res) => {
  res.json({ auth: req.auth ?? null })
})
