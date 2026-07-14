import crypto from 'crypto'

const GATEWAY_SECRET = process.env.GATEWAY_HMAC_SECRET ?? ''

// ─────────────────────────────────────────
// GENERATE SIGNATURE (platform → builder)
// ─────────────────────────────────────────

export function generateRequestSignature(
  body: string,
  timestamp: string,
  agentSecretKey: string
): string {
  return crypto.createHmac('sha256', agentSecretKey).update(`${timestamp}.${body}`).digest('hex')
}

// ─────────────────────────────────────────
// VERIFY SIGNATURE (builder → platform, for callbacks)
// ─────────────────────────────────────────

export function verifyInboundSignature(body: string, signature: string, timestamp: string): boolean {
  if (!GATEWAY_SECRET) return false

  const now = Math.floor(Date.now() / 1000)
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts) || Math.abs(now - ts) > 300) return false

  const expected = crypto.createHmac('sha256', GATEWAY_SECRET).update(`${timestamp}.${body}`).digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// ─────────────────────────────────────────
// BUILD SIGNED HEADERS for outbound requests to a builder's agent endpoint
// ─────────────────────────────────────────

export function buildGatewayHeaders(
  body: string,
  agentId: string,
  agentSecretKey: string
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = generateRequestSignature(body, timestamp, agentSecretKey)

  return {
    'Content-Type': 'application/json',
    'X-Velostra-Signature': signature,
    'X-Velostra-Agent-Id': agentId,
    'X-Velostra-Timestamp': timestamp,
  }
}
