import { useCallback, useEffect, useState } from 'react'
import { v1 } from '../lib/api'
import './PrivacyCenter.css'

type PrivacyRequestType = 'EXPORT' | 'DELETE'
type PrivacyRequestStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED'

interface PrivacyPolicy {
  version: number
  erasable: string[]
  retained: string[]
  reason: string
}

interface PrivacyRequest {
  id: string
  type: PrivacyRequestType
  status: PrivacyRequestStatus
  rejection_reason: string | null
  requested_at: string
}

function statusTone(status: PrivacyRequestStatus) {
  if (status === 'COMPLETED') return 'badge--success'
  if (status === 'REJECTED') return 'badge--danger'
  return 'badge--warn'
}

export default function PrivacyCenter() {
  const [policy, setPolicy] = useState<PrivacyPolicy | null>(null)
  const [requests, setRequests] = useState<PrivacyRequest[]>([])
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [policyResponse, requestsResponse] = await Promise.all([
        v1.get<{ policy: PrivacyPolicy }>('/privacy/policy'),
        v1.get<PrivacyRequest[]>('/privacy/requests?limit=20'),
      ])
      setPolicy(policyResponse.data.policy)
      setRequests(requestsResponse.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Privacy controls are unavailable.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createRequest(type: PrivacyRequestType) {
    setBusy(type)
    setError(null)
    setNotice(null)
    try {
      await v1.post('/privacy/requests', {
        type,
        reason: type === 'EXPORT' ? 'User-requested account export' : 'User-confirmed personal data deletion',
      })
      if (type === 'DELETE') setDeleteConfirmation('')
      setNotice(type === 'EXPORT' ? 'Export request queued.' : 'Deletion request queued for controlled review.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Privacy request failed.')
    } finally {
      setBusy(null)
    }
  }

  async function downloadExport(request: PrivacyRequest) {
    setBusy(request.id)
    setError(null)
    try {
      const response = await v1.get<Record<string, unknown>>(`/privacy/requests/${request.id}/export`)
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `velostra-export-${request.id}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Export download failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="panel panel--spaced privacy-center" aria-labelledby="privacy-center-title">
      <div className="privacy-center__heading">
        <div>
          <span className="section-eyebrow">Data controls</span>
          <h3 id="privacy-center-title" className="panel-title">Privacy center</h3>
        </div>
        {policy && <span className="mono privacy-center__version">POLICY V{policy.version}</span>}
      </div>

      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      {notice && <p className="form-message form-message--notice" role="status">{notice}</p>}

      <div className="privacy-center__actions">
        <article className="privacy-action-card">
          <div>
            <span className="mono">PORTABLE COPY</span>
            <h4>Export your account</h4>
            <p>Request a bounded JSON export of your profile, execution history, reports, and financial records.</p>
          </div>
          <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => void createRequest('EXPORT')}>
            {busy === 'EXPORT' ? 'Requesting...' : 'Request export'}
          </button>
        </article>

        <article className="privacy-action-card privacy-action-card--danger">
          <div>
            <span className="mono">CONTROLLED ERASURE</span>
            <h4>Delete personal data</h4>
            <p>Personal content is erased after review. Financial, chain, security, and audit evidence remains retained.</p>
          </div>
          <label className="field-row" htmlFor="privacy-delete-confirmation">
            <span>Type DELETE to confirm</span>
            <input
              id="privacy-delete-confirmation"
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder="DELETE"
            />
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy !== null || deleteConfirmation !== 'DELETE'}
            onClick={() => void createRequest('DELETE')}
          >
            {busy === 'DELETE' ? 'Requesting...' : 'Request deletion'}
          </button>
        </article>
      </div>

      {policy && (
        <details className="privacy-policy">
          <summary>What is erased and what must be retained</summary>
          <div className="privacy-policy__grid">
            <div><strong>Eligible for erasure</strong><ul>{policy.erasable.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><strong>Retained evidence</strong><ul>{policy.retained.map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
          <p>{policy.reason}</p>
        </details>
      )}

      <div className="privacy-request-list">
        <div className="privacy-request-list__heading"><h4>Request history</h4><span>{requests.length} shown</span></div>
        {requests.length === 0 && <div className="empty-state">No privacy requests yet.</div>}
        {requests.map((request) => (
          <div className="privacy-request" key={request.id}>
            <div>
              <strong>{request.type === 'EXPORT' ? 'Account export' : 'Personal data deletion'}</strong>
              <span>{new Date(request.requested_at).toLocaleString()}</span>
              {request.rejection_reason && <small>{request.rejection_reason}</small>}
            </div>
            <div className="privacy-request__actions">
              <span className={`badge ${statusTone(request.status)}`}>{request.status}</span>
              {request.type === 'EXPORT' && request.status === 'COMPLETED' && (
                <button type="button" className="btn btn--ghost btn--small" disabled={busy !== null} onClick={() => void downloadExport(request)}>
                  {busy === request.id ? 'Preparing...' : 'Download JSON'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
