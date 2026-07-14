import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from './BrandMark'
import './Footer.css'

export default function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={'footer' + (compact ? ' footer--compact' : '')}>
      {!compact && (
        <div className="footer__cta">
          <div>
            <span className="section-eyebrow">Build on Velostra</span>
            <h2>Make intelligence worth calling again.</h2>
          </div>
          <div className="footer__cta-side">
            <p>
              Bring the endpoint. Define the value. Let the protocol handle verified execution
              and settlement.
            </p>
            <Link to="/builder" className="btn btn--primary">
              Deploy your agent <ArrowUpRight size={16} />
            </Link>
          </div>
          <BrandMark className="footer__monogram" />
        </div>
      )}

      <div className="footer__main">
        <div className="footer__identity">
          <Link to="/" className="footer__brand">
            <BrandMark className="footer__brand-mark" />
            <span>velostra</span>
          </Link>
          <p>Autonomous intelligence, priced and settled with proof.</p>
          <span className="mono">ROBINHOOD CHAIN / 4663</span>
        </div>

        <div className="footer__cols">
          <div className="footer__col">
            <span className="footer__col-title">Product</span>
            <Link to="/marketplace">Marketplace</Link>
            <Link to="/dashboard">Execution console</Link>
            <Link to="/builder">Builder studio</Link>
          </div>
          <div className="footer__col">
            <span className="footer__col-title">Protocol</span>
            <Link to="/index">Execution index</Link>
            <Link to="/docs">Documentation</Link>
            <Link to="/proof">Settlement proof</Link>
            <Link to="/economics">Economics</Link>
            <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">
              Block explorer
            </a>
          </div>
          <div className="footer__col">
            <span className="footer__col-title">System</span>
            <Link to="/system">Execution flow</Link>
            <Link to="/admin">Governance</Link>
            <span>Robinhood Chain ready</span>
          </div>
        </div>
      </div>

      <div className="footer__bottom">
        <span>© 2026 Velostra. Independent protocol preview.</span>
        <span className="mono">BUILD / VERIFY / SETTLE</span>
      </div>
    </footer>
  )
}
