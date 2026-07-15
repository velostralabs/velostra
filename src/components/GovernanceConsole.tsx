import { useCallback, useEffect, useState } from 'react'
import { v1 } from '../lib/api'
import './GovernanceConsole.css'

interface ReportRow {
  id: string
  reason: string
  description: string
  status: string
  agent_name: string
  created_at: string
}

interface DeadLetter {
  id: string
  event_type: string
  subscription_url: string
  attempt_count: number
  last_error: string | null
}

interface PrivacyRequest {
  id: string
  user_id: string
  type: 'EXPORT' | 'DELETE'
  status: string
  requested_at: string
}

interface TelemetryField {
  field_name: string
  classification: 'PUBLIC' | 'OPERATIONAL' | 'SENSITIVE' | 'FINANCIAL' | 'PROHIBITED'
  purpose: string
  owner: string
  retention_days: number
  enabled: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Governance action failed.'
}

export default function GovernanceConsole() {
  const [reports, setReports] = useState<ReportRow[]>([])
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([])
  const [privacy, setPrivacy] = useState<PrivacyRequest[]>([])
  const [telemetry, setTelemetry] = useState<TelemetryField[]>([])
  const [note, setNote] = useState('Reviewed against the published moderation policy.')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const results = await Promise.allSettled([
      v1.get<ReportRow[]>('/admin/reports?status=PENDING&limit=20'),
      v1.get<DeadLetter[]>('/admin/webhooks/dead-letter?limit=20'),
      v1.get<PrivacyRequest[]>('/admin/privacy/requests?status=PENDING&limit=20'),
      v1.get<{ fields: TelemetryField[] }>('/admin/telemetry/fields'),
    ])
    const [reportResult, deadResult, privacyResult, telemetryResult] = results
    if (reportResult.status === 'fulfilled') setReports(reportResult.value.data)
    if (deadResult.status === 'fulfilled') setDeadLetters(deadResult.value.data)
    if (privacyResult.status === 'fulfilled') setPrivacy(privacyResult.value.data)
    if (telemetryResult.status === 'fulfilled') setTelemetry(telemetryResult.value.data.fields)
    if (results.every((result) => result.status === 'rejected')) {
      setError('This admin role has no Phase 4 governance permissions.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function action(key: string, operation: () => Promise<void>) {
    setBusy(key)
    setError(null)
    try {
      await operation()
      await load()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="governance-console" aria-labelledby="governance-title">
      <div className="panel-heading">
        <div><span className="mono">ACCOUNTABLE OPERATIONS</span><h2 id="governance-title">Trust & delivery control</h2></div>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()} disabled={busy !== null}>Refresh</button>
      </div>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      <label className="field-row governance-note"><span>Decision note</span><input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></label>

      <div className="governance-grid">
        <article className="panel governance-card">
          <div className="governance-card__heading"><h3>Moderation queue</h3><span className="badge badge--warn">{reports.length}</span></div>
          <div className="governance-list">
            {reports.length === 0 && <div className="empty-state">No pending reports.</div>}
            {reports.map((report) => (
              <div key={report.id} className="governance-row">
                <div><strong>{report.agent_name}</strong><span>{report.reason.replaceAll('_', ' ')} · {report.description}</span></div>
                <div className="table-actions">
                  <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null || note.length < 3} onClick={() => void action(`review-${report.id}`, async () => { await v1.post(`/admin/reports/${report.id}/resolve`, { status: 'REVIEWED', note }) })}>Review</button>
                  <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null || note.length < 3} onClick={() => void action(`warn-${report.id}`, async () => { await v1.post(`/admin/reports/${report.id}/resolve`, { status: 'WARNING_SENT', note }) })}>Warn</button>
                  <button type="button" className="btn btn--primary btn--small" disabled={busy !== null || note.length < 3} onClick={() => void action(`suspend-${report.id}`, async () => { await v1.post(`/admin/reports/${report.id}/resolve`, { status: 'SUSPENDED', note }) })}>Suspend</button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel governance-card">
          <div className="governance-card__heading"><h3>Webhook dead letter</h3><span className="badge badge--warn">{deadLetters.length}</span></div>
          <div className="governance-list">
            {deadLetters.length === 0 && <div className="empty-state">No exhausted deliveries.</div>}
            {deadLetters.map((delivery) => (
              <div key={delivery.id} className="governance-row">
                <div><strong>{delivery.event_type}</strong><span>{delivery.subscription_url} · {delivery.attempt_count} attempts · {delivery.last_error ?? 'No error detail'}</span></div>
                <button type="button" className="btn btn--primary btn--small" disabled={busy !== null} onClick={() => void action(`replay-${delivery.id}`, async () => { await v1.post(`/admin/webhooks/deliveries/${delivery.id}/replay`, {}) })}>Replay</button>
              </div>
            ))}
          </div>
        </article>

        <article className="panel governance-card">
          <div className="governance-card__heading"><h3>Privacy requests</h3><span className="badge badge--warn">{privacy.length}</span></div>
          <div className="governance-list">
            {privacy.length === 0 && <div className="empty-state">No pending privacy requests.</div>}
            {privacy.map((request) => (
              <div key={request.id} className="governance-row">
                <div><strong>{request.type}</strong><span>{request.id} · requested {new Date(request.requested_at).toLocaleDateString()}</span></div>
                <div className="table-actions">
                  <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => void action(`start-${request.id}`, async () => { await v1.post(`/admin/privacy/requests/${request.id}/process`, { action: 'START' }) })}>Start</button>
                  <button type="button" className="btn btn--primary btn--small" disabled={busy !== null} onClick={() => void action(`complete-${request.id}`, async () => { await v1.post(`/admin/privacy/requests/${request.id}/process`, { action: 'COMPLETE' }) })}>Complete</button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel governance-card">
          <div className="governance-card__heading"><h3>Telemetry policy</h3><span className="badge badge--success">{telemetry.filter((field) => field.enabled).length} enabled</span></div>
          <div className="governance-list">
            {telemetry.map((field) => (
              <div key={field.field_name} className="governance-row">
                <div><strong>{field.field_name}</strong><span>{field.classification} · {field.retention_days} days · {field.owner}</span></div>
                <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null || field.classification === 'PROHIBITED'} onClick={() => void action(`telemetry-${field.field_name}`, async () => { await v1.put(`/admin/telemetry/fields/${field.field_name}`, { classification: field.classification, purpose: field.purpose, owner: field.owner, retention_days: field.retention_days, enabled: !field.enabled }) })}>{field.enabled ? 'Disable' : 'Enable'}</button>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}
