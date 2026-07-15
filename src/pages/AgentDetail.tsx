import { useEffect, useState } from 'react'
import { ArrowLeft, BadgeCheck, Play, Star } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import PageShell from '../components/PageShell'
import SignInGate from '../components/SignInGate'
import { api, createIdempotencyKey, v1 } from '../lib/api'

interface AgentDetailData {
  id: string
  name: string
  description: string
  long_description?: string | null
  price_per_call: number
  price_tier: string
  total_calls: number
  avg_rating?: number | null
  builder: { display_name: string; verified: boolean; bio?: string | null }
  reviews: Array<{ id: string; rating: number; comment?: string | null }>
}

export default function AgentDetail() {
  const { slug } = useParams<{ slug: string }>()
  const [agent, setAgent] = useState<AgentDetailData | null>(null)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [lastCallId, setLastCallId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('NOT_WORKING')
  const [reportDescription, setReportDescription] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reportMessage, setReportMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    const controller = new AbortController()
    setLoadError(null)
    api
      .get<{ agent: AgentDetailData }>('/api/agents/' + slug, { signal: controller.signal })
      .then((response) => {
        setAgent(response.agent)
        document.title = response.agent.name + ' — Velostra'
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setLoadError(error.message)
      })
    return () => controller.abort()
  }, [slug])

  async function run() {
    if (!slug || !input.trim()) return
    setRunning(true)
    setRunError(null)
    setOutput(null)
    try {
      const response = await v1.post<{ call_id: string; output: unknown }>(
        '/agents/' + slug + '/run',
        { input },
        createIdempotencyKey()
      )
      setLastCallId(response.data.call_id)
      setOutput(JSON.stringify(response.data.output, null, 2))
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

  async function submitReport() {
    if (!agent || reportDescription.trim().length < 10) return
    setReporting(true)
    setReportMessage(null)
    try {
      await v1.post(`/trust/agents/${agent.id}/reports`, {
        reason: reportReason,
        description: reportDescription.trim(),
        evidence: lastCallId ? { call_id: lastCallId } : {},
      })
      setReportDescription('')
      setReportMessage('Report submitted securely for moderation.')
    } catch (error) {
      setReportMessage(error instanceof Error ? error.message : 'Report submission failed.')
    } finally {
      setReporting(false)
    }
  }
  if (loadError) {
    return (
      <PageShell>
        <div className="empty-state empty-state--error" role="alert">
          <strong>Agent could not be loaded.</strong>
          <span>{loadError}</span>
          <Link to="/marketplace" className="btn btn--ghost"><ArrowLeft size={15} /> Marketplace</Link>
        </div>
      </PageShell>
    )
  }

  if (!agent) return <PageShell><div className="page-skeleton" role="status"><span className="sr-only">Loading agent</span><i /><i /><i /></div></PageShell>

  return (
    <PageShell>
      <Link to="/marketplace" className="back-link"><ArrowLeft size={14} /> Back to marketplace</Link>

      <div className="agent-heading">
        <div>
          <span className="section-eyebrow">{agent.price_tier} / EXECUTION OBJECT</span>
          <h1 className="page-title">{agent.name}</h1>
          <p className="page-sub">{agent.long_description || agent.description}</p>
        </div>
        <div className="agent-heading__stats">
          <div><span>Price per call</span><strong>{'$' + agent.price_per_call.toFixed(2)}</strong></div>
          <div><span>Total calls</span><strong>{agent.total_calls.toLocaleString()}</strong></div>
          <div>
            <span>Builder</span>
            <strong>{agent.builder.display_name} {agent.builder.verified && <BadgeCheck size={15} />}</strong>
          </div>
        </div>
      </div>

      <div className="agent-layout">
        <SignInGate>
          {() => (
            <section className="panel agent-run">
              <div className="panel-heading">
                <div><span className="mono">LIVE EXECUTION</span><h2>Run this agent</h2></div>
                <span className="status-indicator"><i /> ready</span>
              </div>
              <div className="field-row">
                <label htmlFor="agent-input">Input</label>
                <textarea
                  id="agent-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={7}
                  placeholder="Describe the outcome you need…"
                />
              </div>
              <button type="button" className="btn btn--primary" onClick={run} disabled={running || !input.trim()}>
                <Play size={15} fill="currentColor" />
                {running ? 'Executing…' : 'Run · $' + agent.price_per_call.toFixed(2)}
              </button>
              {runError && <p className="form-message form-message--error">{runError}</p>}
              {output && <pre className="mono output-block">{output}</pre>}
            </section>
          )}
        </SignInGate>

        <aside className="panel agent-reviews">
          <div className="panel-heading">
            <div><span className="mono">MARKET SIGNAL</span><h2>Reviews</h2></div>
            {agent.avg_rating && <strong className="rating"><Star size={14} fill="currentColor" /> {agent.avg_rating.toFixed(1)}</strong>}
          </div>
          {agent.reviews.length === 0 ? (
            <div className="empty-state">No reviews yet. Be the first execution signal.</div>
          ) : (
            <div className="review-list">
              {agent.reviews.map((review) => (
                <article key={review.id}>
                  <span className="mono rating">{'★'.repeat(review.rating)}</span>
                  {review.comment && <p>{review.comment}</p>}
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>

      <SignInGate>
        {() => (
          <section className="panel panel--spaced" aria-labelledby="report-agent-title">
            <div className="panel-heading">
              <div><span className="mono">TRUST SIGNAL</span><h2 id="report-agent-title">Report this agent</h2></div>
              <span className="badge badge--warn">Evidence-safe</span>
            </div>
            <div className="form-grid">
              <div className="field-row">
                <label htmlFor="report-reason">Reason</label>
                <select id="report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                  <option value="NOT_WORKING">Not working</option>
                  <option value="MISLEADING">Misleading</option>
                  <option value="HARMFUL_CONTENT">Harmful content</option>
                  <option value="SPAM">Spam</option>
                  <option value="INAPPROPRIATE">Inappropriate</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="field-row">
                <label htmlFor="report-description">What happened</label>
                <textarea id="report-description" rows={3} maxLength={4000} value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} placeholder="Describe the observable issue. Never include a secret or private key." />
              </div>
            </div>
            <button type="button" className="btn btn--ghost" disabled={reporting || reportDescription.trim().length < 10} onClick={() => void submitReport()}>{reporting ? 'Submitting…' : 'Submit report'}</button>
            {lastCallId && <p className="form-message form-message--notice">Your latest correlated call ID will be attached; the prompt and output will not.</p>}
            {reportMessage && <p className="form-message" role="status">{reportMessage}</p>}
          </section>
        )}
      </SignInGate>
    </PageShell>
  )
}
