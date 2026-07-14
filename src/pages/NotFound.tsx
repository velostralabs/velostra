import { ArrowLeft, Blocks } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageShell from '../components/PageShell'

export default function NotFound() {
  return (
    <PageShell>
      <div className="not-found">
        <span className="not-found__icon"><Blocks size={22} strokeWidth={1.5} /></span>
        <span className="section-eyebrow">404 / Route unresolved</span>
        <h1>Nothing is settling at this address.</h1>
        <p>The route may have moved, or the execution object no longer exists.</p>
        <Link to="/" className="btn btn--primary"><ArrowLeft size={16} /> Return home</Link>
      </div>
    </PageShell>
  )
}
