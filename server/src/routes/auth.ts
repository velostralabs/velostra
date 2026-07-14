import { Router } from 'express'
import { z } from 'zod'
import { generateAuthNonce, completeWalletLogin } from '../lib/auth.js'

export const authRouter = Router()

const nonceSchema = z.object({ walletAddress: z.string() })

authRouter.post('/nonce', (req, res) => {
  const parsed = nonceSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'walletAddress is required' })

  try {
    const { message, nonce } = generateAuthNonce(parsed.data.walletAddress)
    res.json({ message, nonce })
  } catch {
    res.status(400).json({ error: 'Invalid EVM wallet address' })
  }
})

const loginSchema = z.object({
  walletAddress: z.string(),
  signature: z.string(),
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'walletAddress and signature are required' })

  const result = await completeWalletLogin(
    parsed.data.walletAddress,
    parsed.data.signature as `0x${string}`
  )

  if ('error' in result) return res.status(401).json({ error: result.error })

  res
    .cookie('velostra_token', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    })
    .json(result)
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('velostra_token').json({ ok: true })
})

authRouter.get('/me', async (req, res) => {
  res.json({ auth: req.auth ?? null })
})
