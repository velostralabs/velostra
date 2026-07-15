const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string
  readonly details?: unknown

  constructor(input: { status: number; code: string; message: string; requestId?: string; details?: unknown }) {
    super(input.message)
    this.name = 'ApiError'
    this.status = input.status
    this.code = input.code
    this.requestId = input.requestId
    this.details = input.details
  }
}

export interface PageInfo {
  next_cursor: string | null
  has_more: boolean
}

export interface V1Envelope<T> {
  data: T
  page?: PageInfo
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: typeof data.code === 'string' ? data.code : 'REQUEST_FAILED',
      message: typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      requestId: typeof data.request_id === 'string' ? data.request_id : undefined,
      details: data.details,
    })
  }
  return data as T
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: 'DELETE' }),
}

function idempotentHeaders(key?: string): HeadersInit {
  return key ? { 'Idempotency-Key': key } : {}
}

export const v1 = {
  get: <T>(path: string) => request<V1Envelope<T>>('/api/v1' + path),
  post: <T>(path: string, body: unknown, idempotencyKey = createIdempotencyKey()) =>
    request<V1Envelope<T>>('/api/v1' + path, {
      method: 'POST',
      headers: idempotentHeaders(idempotencyKey),
      body: JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown, idempotencyKey = createIdempotencyKey()) =>
    request<V1Envelope<T>>('/api/v1' + path, {
      method: 'PATCH',
      headers: idempotentHeaders(idempotencyKey),
      body: JSON.stringify(body),
    }),
  put: <T>(path: string, body: unknown, idempotencyKey = createIdempotencyKey()) =>
    request<V1Envelope<T>>('/api/v1' + path, {
      method: 'PUT',
      headers: idempotentHeaders(idempotencyKey),
      body: JSON.stringify(body),
    }),
  delete: <T>(path: string, idempotencyKey = createIdempotencyKey()) =>
    request<V1Envelope<T>>('/api/v1' + path, {
      method: 'DELETE',
      headers: idempotentHeaders(idempotencyKey),
    }),
}

// ─────────────────────────────────────────
// Types (mirrors server responses)
// ─────────────────────────────────────────

export interface Auth {
  id: string
  wallet_address: string
  display_name?: string
  is_builder: boolean
  is_admin: boolean
}

export interface AgentSummary {
  id: string
  name: string
  slug: string
  description: string
  category: string
  price_per_call: number
  price_tier: string
  logo_url?: string | null
  total_calls: number
  avg_rating?: number | null
  builder: { display_name: string; verified: boolean }
}
