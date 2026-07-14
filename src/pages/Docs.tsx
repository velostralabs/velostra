import { Blocks, Fingerprint, RadioTower, ServerCog, ShieldCheck, WalletCards } from 'lucide-react'
import PageShell from '../components/PageShell'

const sections = [
  { icon: ServerCog, index: '01', title: 'Run locally', body: 'Start PostgreSQL and Redis, push the database schema, run the API in /server, then start Vite at the repository root.' },
  { icon: Fingerprint, index: '02', title: 'Wallet authentication', body: 'A single-use nonce is signed with EIP-191. The server returns a secure, 24-hour httpOnly session cookie.' },
  { icon: WalletCards, index: '03', title: 'Money flow', body: 'Users deposit the settlement token into escrow. Paid calls atomically deduct credits and attribute builder earnings.' },
  { icon: RadioTower, index: '04', title: 'Builder integration', body: 'Velostra calls your POST endpoint with input, user_id, call_id, and a verifiable HMAC-SHA256 request signature.' },
  { icon: Blocks, index: '05', title: 'Production requirements', body: 'Configure deployed contracts, the backend signer, RPC, Postgres, Redis, TLS, secrets, and versioned migrations.' },
  { icon: ShieldCheck, index: '06', title: 'Security boundary', body: 'Transaction hashes are event-verified and unique. Reconciliation continuously repairs confirmed onchain state.' },
]

const endpoints = [
  'POST  /api/auth/nonce',
  'POST  /api/auth/login',
  'GET   /api/agents',
  'POST  /api/agents/:slug/run',
  'POST  /api/builder/agents',
  'POST  /api/dashboard/topup',
  'POST  /api/builder/claim',
].join('\n')

export default function Docs() {
  return (
    <PageShell>
      <div className="page-heading page-heading--split">
        <div>
          <span className="section-eyebrow">Protocol reference</span>
          <h1 className="page-title">Documentation</h1>
        </div>
        <p className="page-sub">A concise map of the product, execution path, and integration surface. Engineering detail lives in the repository docs.</p>
      </div>

      <div className="docs-grid">
        {sections.map((section) => {
          const Icon = section.icon
          return (
            <article className="panel docs-card" key={section.title}>
              <div><span className="docs-card__icon"><Icon size={18} strokeWidth={1.5} /></span><span className="mono">{section.index}</span></div>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </article>
          )
        })}
      </div>

      <section className="panel endpoint-panel">
        <div className="panel-heading">
          <div><span className="mono">HTTP / JSON</span><h2>Core endpoints</h2></div>
          <span className="status-indicator"><i /> v1 surface</span>
        </div>
        <pre className="mono">{endpoints}</pre>
      </section>
    </PageShell>
  )
}
