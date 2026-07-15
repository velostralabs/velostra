export interface PageInfo {
  next_cursor: string | null
  has_more: boolean
}

export interface AgentSummary {
  id: string
  name: string
  slug: string
  description: string
  category: string
  price_per_call: number
  price_tier: string
  logo_url: string | null
  total_calls: number
  avg_rating: number | null
  builder: { display_name: string; verified: boolean }
}

export interface AgentPage {
  items: AgentSummary[]
  page: PageInfo
}

export interface VelostraClientOptions {
  baseUrl?: string
  token?: string
  fetch?: typeof fetch
  retries?: number
}

export class VelostraApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string
  readonly details?: unknown

  constructor(input: { status: number; code: string; message: string; requestId?: string; details?: unknown }) {
    super(input.message)
    this.name = 'VelostraApiError'
    this.status = input.status
    this.code = input.code
    this.requestId = input.requestId
    this.details = input.details
  }
}

interface ApiEnvelope<T> {
  data: T
  page?: PageInfo
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function queryString(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? '?' + encoded : ''
}

export class VelostraClient {
  readonly baseUrl: string
  private readonly fetcher: typeof fetch
  private readonly retries: number
  private token?: string

  constructor(options: VelostraClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.velostra.xyz').replace(/\/$/, '')
    this.token = options.token
    this.fetcher = options.fetch ?? globalThis.fetch
    this.retries = Math.max(0, Math.min(5, options.retries ?? 2))
    if (!this.fetcher) throw new Error('A Fetch API implementation is required')
  }

  setToken(token: string | undefined): void {
    this.token = token
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {}
  ): Promise<ApiEnvelope<T>> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await this.fetcher(this.baseUrl + '/api/v1' + path, {
          method,
          credentials: 'include',
          headers: {
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(this.token ? { authorization: 'Bearer ' + this.token } : {}),
            ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
          },
          body,
        })
      } catch (error) {
        if (attempt >= this.retries || (method !== 'GET' && !options.idempotencyKey)) throw error
        await delay(100 * 2 ** attempt)
        continue
      }

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (response.ok) return payload as unknown as ApiEnvelope<T>

      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt < this.retries && (method === 'GET' || options.idempotencyKey)) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 100 * 2 ** attempt)
        continue
      }
      throw new VelostraApiError({
        status: response.status,
        code: typeof payload.code === 'string' ? payload.code : 'REQUEST_FAILED',
        message: typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`,
        requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
        details: payload.details,
      })
    }
  }

  async authenticateWallet(
    walletAddress: string,
    signMessage: (message: string) => Promise<string>
  ): Promise<{ token: string; user: unknown }> {
    const nonce = await this.request<{ message: string; nonce: string }>('POST', '/auth/nonce', {
      body: { walletAddress },
    })
    const signature = await signMessage(nonce.data.message)
    const login = await this.request<{ token: string; user: unknown }>('POST', '/auth/login', {
      body: { walletAddress, signature },
    })
    this.token = login.data.token
    return login.data
  }

  async listAgents(input: {
    category?: string
    q?: string
    limit?: number
    cursor?: string
  } = {}): Promise<AgentPage> {
    const response = await this.request<AgentSummary[]>('GET', '/agents' + queryString(input))
    return {
      items: response.data,
      page: response.page ?? { next_cursor: null, has_more: false },
    }
  }

  async *iterateAgents(input: Omit<Parameters<VelostraClient['listAgents']>[0], 'cursor'> = {}) {
    let cursor: string | undefined
    do {
      const result = await this.listAgents({ ...input, cursor })
      for (const agent of result.items) yield agent
      cursor = result.page.next_cursor ?? undefined
    } while (cursor)
  }

  async getAgent(slug: string): Promise<unknown> {
    const response = await this.request<{ agent: unknown }>('GET', '/agents/' + encodeURIComponent(slug))
    return response.data.agent
  }

  async runAgent(slug: string, input: string, idempotencyKey: string): Promise<unknown> {
    const response = await this.request<unknown>('POST', '/agents/' + encodeURIComponent(slug) + '/run', {
      body: { input },
      idempotencyKey,
    })
    return response.data
  }

  async createReport(
    agentId: string,
    report: { reason: string; description: string; evidence?: Record<string, unknown> },
    idempotencyKey: string
  ): Promise<unknown> {
    return (await this.request('POST', '/trust/agents/' + encodeURIComponent(agentId) + '/reports', {
      body: report,
      idempotencyKey,
    })).data
  }
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function signGatewayRequest(secret: string, timestamp: string, body: string): Promise<string> {
  return hmacHex(secret, timestamp + '.' + body)
}

export function signWebhook(secret: string, timestamp: string, eventId: string, body: string): Promise<string> {
  return hmacHex(secret, timestamp + '.' + eventId + '.' + body)
}

export async function verifyWebhook(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
  suppliedSignature: string
): Promise<boolean> {
  const expected = await signWebhook(secret, timestamp, eventId, body)
  if (expected.length !== suppliedSignature.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ suppliedSignature.charCodeAt(index)
  }
  return difference === 0
}
