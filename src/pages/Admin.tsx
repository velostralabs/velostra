import { useCallback, useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import SignInGate from '../components/SignInGate'
import GovernanceConsole from '../components/GovernanceConsole'
import { api } from '../lib/api'

interface Stats {
  total_users: number
  active_builders: number
  live_agents: number
  total_volume: number
  platform_revenue: number
  total_calls: number
}

interface PendingAgent {
  id: string
  name: string
  price_per_call: number
  category: string
  builder: { display_name: string; wallet_address: string }
}

function AdminConsole() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [pending, setPending] = useState<PendingAgent[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [nextStats, nextPending] = await Promise.all([
        api.get<Stats>('/api/admin/stats'),
        api.get<{ agents: PendingAgent[] }>('/api/admin/agents/pending'),
      ])
      setStats(nextStats)
      setPending(nextPending.agents)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Admin data unavailable')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    await api.post('/api/admin/agents/' + id + '/decision', { decision })
    await load()
  }

  return (
    <>
      {error && <p className="form-message form-message--error">{error}</p>}
      {stats && (
        <div className="metric-grid metric-grid--six">
          {[
            ['Users', stats.total_users],
            ['Active builders', stats.active_builders],
            ['Live agents', stats.live_agents],
            ['Total calls', stats.total_calls],
            ['Volume', '$' + stats.total_volume.toFixed(2)],
            ['Protocol revenue', '$' + stats.platform_revenue.toFixed(2)],
          ].map(([label, value]) => (
            <div className="metric-card" key={String(label)}>
              <span>{label}</span>
              <strong className="mono">{value}</strong>
            </div>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div><span className="mono">REVIEW QUEUE</span><h2>Pending submissions</h2></div>
          <span className="badge badge--warn">{pending.length} waiting</span>
        </div>
        {pending.length === 0 ? (
          <div className="empty-state">Nothing waiting for review.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Builder</th><th>Category</th><th>Price</th><th>Decision</th></tr></thead>
              <tbody>
                {pending.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.name}</td>
                    <td className="mono">{agent.builder.display_name}</td>
                    <td>{agent.category.replaceAll('_', ' ')}</td>
                    <td className="mono">{'$' + agent.price_per_call.toFixed(2)}</td>
                    <td><div className="table-actions">
                      <button type="button" className="btn btn--primary btn--small" onClick={() => decide(agent.id, 'APPROVE')}>Approve</button>
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => decide(agent.id, 'REJECT')}>Reject</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <GovernanceConsole />
    </>
  )
}

export default function Admin() {
  return (
    <PageShell>
      <div className="page-heading">
        <span className="section-eyebrow">Governance surface</span>
        <h1 className="page-title">Admin</h1>
        <p className="page-sub">Platform oversight, agent review, and live network health.</p>
      </div>
      <SignInGate requireAdmin>{() => <AdminConsole />}</SignInGate>
    </PageShell>
  )
}
