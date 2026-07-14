const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
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
