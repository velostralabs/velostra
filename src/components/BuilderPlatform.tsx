import { useCallback, useEffect, useMemo, useState } from 'react'
import { v1 } from '../lib/api'
import './BuilderPlatform.css'

interface BuilderAgent {
  id: string
  name: string
  status: string
}

interface Analytics {
  summary: {
    calls: number
    successes: number
    errors: number
    success_rate: number
    gross_volume: number
    builder_earnings: number
    claims: number
    claimed_amount: number
    average_latency_ms: number
  }
}

interface Notification {
  id: string
  type: string
  title: string
  body: string
  read_at: string | null
  created_at: string
}

interface Revision {
  id: string
  revision_number: number
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  endpoint_url: string
  price_per_call: number
  change_summary: string | null
  created_at: string
}

interface WebhookSubscription {
  id: string
  url: string
  description: string | null
  event_types: string[]
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED'
  secret_hint: string
  last_delivery_at: string | null
}

const webhookEvents = [
  'agent.revision.published',
  'agent.revision.rolled_back',
  'agent.approved',
  'agent.rejected',
  'call.settled',
  'claim.confirmed',
  'report.created',
  'report.resolved',
]

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The platform request failed.'
}

export default function BuilderPlatform({ agents }: { agents: BuilderAgent[] }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [webhooks, setWebhooks] = useState<WebhookSubscription[]>([])
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id ?? '')
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [changeSummary, setChangeSummary] = useState('')
  const [revisionEndpoint, setRevisionEndpoint] = useState('')
  const [revisionPrice, setRevisionPrice] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['call.settled', 'claim.confirmed'])
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agents.some((agent) => agent.id === selectedAgent)) setSelectedAgent(agents[0]?.id ?? '')
  }, [agents, selectedAgent])

  const loadCore = useCallback(async () => {
    setError(null)
    try {
      const [nextAnalytics, nextNotifications, nextWebhooks] = await Promise.all([
        v1.get<Analytics>('/builder/analytics'),
        v1.get<Notification[]>('/builder/notifications?limit=8'),
        v1.get<WebhookSubscription[]>('/builder/webhooks?limit=20'),
      ])
      setAnalytics(nextAnalytics.data)
      setNotifications(nextNotifications.data)
      setWebhooks(nextWebhooks.data)
    } catch (caught) {
      setError(message(caught))
    }
  }, [])

  const loadRevisions = useCallback(async () => {
    if (!selectedAgent) {
      setRevisions([])
      return
    }
    try {
      const response = await v1.get<Revision[]>(`/builder/agents/${selectedAgent}/revisions?limit=25`)
      setRevisions(response.data)
    } catch (caught) {
      setError(message(caught))
    }
  }, [selectedAgent])

  useEffect(() => { void loadCore() }, [loadCore])
  useEffect(() => { void loadRevisions() }, [loadRevisions])

  const unread = useMemo(() => notifications.filter((item) => !item.read_at).length, [notifications])

  async function action(key: string, operation: () => Promise<void>) {
    setBusy(key)
    setError(null)
    try {
      await operation()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(null)
    }
  }

  async function createRevision() {
    if (!selectedAgent || !changeSummary.trim()) return
    await action('revision-create', async () => {
      await v1.post(`/builder/agents/${selectedAgent}/revisions`, {
        change_summary: changeSummary.trim(),
        ...(revisionEndpoint.trim() ? { endpoint_url: revisionEndpoint.trim() } : {}),
        ...(revisionPrice ? { price_per_call: Number(revisionPrice) } : {}),
      })
      setChangeSummary('')
      setRevisionEndpoint('')
      setRevisionPrice('')
      await Promise.all([loadRevisions(), loadCore()])
    })
  }

  async function revisionAction(revision: Revision, mode: 'test' | 'publish' | 'rollback') {
    await action(`${mode}-${revision.id}`, async () => {
      await v1.post(`/builder/agents/${selectedAgent}/revisions/${revision.id}/${mode}`, {})
      await Promise.all([loadRevisions(), loadCore()])
    })
  }

  async function markRead(notification: Notification) {
    if (notification.read_at) return
    await action(`notification-${notification.id}`, async () => {
      await v1.patch(`/builder/notifications/${notification.id}/read`, {})
      await loadCore()
    })
  }

  async function createWebhook() {
    if (!webhookUrl || selectedEvents.length === 0) return
    await action('webhook-create', async () => {
      const response = await v1.post<{ subscription: WebhookSubscription; secret: string }>(
        '/builder/webhooks',
        { url: webhookUrl, event_types: selectedEvents, description: 'Builder Studio subscription' }
      )
      setOneTimeSecret(response.data.secret)
      setWebhookUrl('')
      await loadCore()
    })
  }

  async function updateWebhook(subscription: WebhookSubscription, actionName: 'PAUSE' | 'RESUME' | 'ROTATE') {
    await action(`webhook-${subscription.id}`, async () => {
      if (actionName === 'ROTATE') {
        const response = await v1.post<{ subscription: WebhookSubscription; secret: string }>(
          `/builder/webhooks/${subscription.id}/rotate-secret`,
          {}
        )
        setOneTimeSecret(response.data.secret)
      } else {
        await v1.patch(`/builder/webhooks/${subscription.id}/status`, { action: actionName })
      }
      await loadCore()
    })
  }

  return (
    <section className="platform-studio" aria-labelledby="platform-studio-title">
      <div className="panel-heading">
        <div>
          <span className="mono">PHASE 4 CONTROL PLANE</span>
          <h2 id="platform-studio-title">Builder operations</h2>
        </div>
        <span className="badge badge--success">{unread} unread</span>
      </div>

      {error && <p className="form-message form-message--error" role="alert">{error}</p>}

      <div className="platform-metrics" aria-label="Builder analytics">
        {[
          ['Calls', analytics?.summary.calls ?? 0],
          ['Success', `${((analytics?.summary.success_rate ?? 0) * 100).toFixed(1)}%`],
          ['Gross', `$${(analytics?.summary.gross_volume ?? 0).toFixed(2)}`],
          ['Earnings', `$${(analytics?.summary.builder_earnings ?? 0).toFixed(2)}`],
          ['Latency', `${Math.round(analytics?.summary.average_latency_ms ?? 0)} ms`],
        ].map(([label, value]) => (
          <div key={String(label)}><span>{label}</span><strong className="mono">{value}</strong></div>
        ))}
      </div>

      <div className="platform-columns">
        <article className="panel platform-card">
          <div className="platform-card__heading"><div><span className="mono">IMMUTABLE HISTORY</span><h3>Agent revisions</h3></div></div>
          <label className="field-row">
            <span>Agent</span>
            <select value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value)}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.status}</option>)}
            </select>
          </label>
          <div className="platform-form-grid">
            <label className="field-row"><span>Change summary</span><input value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} placeholder="What changed and why" /></label>
            <label className="field-row"><span>Endpoint override</span><input value={revisionEndpoint} onChange={(event) => setRevisionEndpoint(event.target.value)} placeholder="https://agent.example/run" /></label>
            <label className="field-row"><span>Price override</span><input inputMode="decimal" value={revisionPrice} onChange={(event) => setRevisionPrice(event.target.value)} placeholder="0.20" /></label>
          </div>
          <button type="button" className="btn btn--primary btn--small" onClick={() => void createRevision()} disabled={!selectedAgent || !changeSummary.trim() || busy !== null}>Create draft revision</button>
          <div className="platform-list">
            {revisions.map((revision) => (
              <div key={revision.id} className="platform-list__row">
                <div><strong>Revision {revision.revision_number}</strong><span>{revision.change_summary ?? 'No summary'} · ${revision.price_per_call.toFixed(2)}</span></div>
                <div className="table-actions">
                  <span className={`badge ${revision.status === 'PUBLISHED' ? 'badge--success' : 'badge--warn'}`}>{revision.status}</span>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => void revisionAction(revision, 'test')} disabled={busy !== null}>Test</button>
                  {revision.status === 'DRAFT' ? (
                    <button type="button" className="btn btn--primary btn--small" onClick={() => void revisionAction(revision, 'publish')} disabled={busy !== null}>Publish</button>
                  ) : (
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => void revisionAction(revision, 'rollback')} disabled={busy !== null}>Rollback</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel platform-card">
          <div className="platform-card__heading"><div><span className="mono">SIGNED DELIVERY</span><h3>Webhooks</h3></div></div>
          <label className="field-row"><span>HTTPS endpoint</span><input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://builder.example/webhooks/velostra" /></label>
          <div className="event-grid">
            {webhookEvents.map((eventName) => (
              <label key={eventName}>
                <input type="checkbox" checked={selectedEvents.includes(eventName)} onChange={(event) => setSelectedEvents((current) => event.target.checked ? [...current, eventName] : current.filter((item) => item !== eventName))} />
                <span>{eventName}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn btn--primary btn--small" onClick={() => void createWebhook()} disabled={!webhookUrl || selectedEvents.length === 0 || busy !== null}>Create subscription</button>
          {oneTimeSecret && <div className="secret-note" role="status"><strong>Copy this secret now.</strong><code className="mono secret-block">{oneTimeSecret}</code><button type="button" className="btn btn--ghost btn--small" onClick={() => setOneTimeSecret(null)}>I saved it</button></div>}
          <div className="platform-list">
            {webhooks.map((subscription) => (
              <div key={subscription.id} className="platform-list__row">
                <div><strong>{subscription.url}</strong><span>{subscription.event_types.length} events · secret …{subscription.secret_hint}</span></div>
                <div className="table-actions">
                  <span className={`badge ${subscription.status === 'ACTIVE' ? 'badge--success' : 'badge--warn'}`}>{subscription.status}</span>
                  {subscription.status !== 'REVOKED' && <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => void updateWebhook(subscription, subscription.status === 'ACTIVE' ? 'PAUSE' : 'RESUME')}>{subscription.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>}
                  {subscription.status !== 'REVOKED' && <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => void updateWebhook(subscription, 'ROTATE')}>Rotate</button>}
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="panel platform-card platform-card--wide">
        <div className="platform-card__heading"><div><span className="mono">DURABLE INBOX</span><h3>Notifications</h3></div><button type="button" className="btn btn--ghost btn--small" onClick={() => void loadCore()} disabled={busy !== null}>Refresh</button></div>
        <div className="platform-list">
          {notifications.length === 0 && <div className="empty-state">No builder notifications yet.</div>}
          {notifications.map((notification) => (
            <button key={notification.id} type="button" className={`notification-row ${notification.read_at ? '' : 'notification-row--unread'}`} onClick={() => void markRead(notification)} disabled={busy !== null}>
              <span><strong>{notification.title}</strong><small>{notification.body}</small></span>
              <time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleDateString()}</time>
            </button>
          ))}
        </div>
      </article>
    </section>
  )
}
