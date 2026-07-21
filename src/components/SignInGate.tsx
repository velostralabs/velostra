import type { ReactNode } from 'react'
import { Fingerprint, ShieldCheck, WalletCards } from 'lucide-react'
import { useVelostraAuth } from '../lib/useAuth'
import WalletButton from './WalletButton'

export default function SignInGate({
  children,
  requireBuilder = false,
  requireAdmin = false,
}: {
  children: (auth: NonNullable<ReturnType<typeof useVelostraAuth>['auth']>) => ReactNode
  requireBuilder?: boolean
  requireAdmin?: boolean
}) {
  const { auth, isConnected, correctNetwork, loading, signingIn, error, signIn } = useVelostraAuth()

  if (loading) return <div className="auth-skeleton"><i /><span className="mono">Checking session</span></div>

  if (!isConnected) {
    return (
      <div className="panel auth-gate">
        <span className="auth-gate__icon"><WalletCards size={21} strokeWidth={1.5} /></span>
        <span className="mono">WALLET REQUIRED</span>
        <h2>Connect to continue</h2>
        <p>Connect a Robinhood Chain wallet to access this execution surface.</p>
        <WalletButton />
      </div>
    )
  }

  if (!correctNetwork) {
    return (
      <div className="panel auth-gate">
        <span className="auth-gate__icon"><WalletCards size={21} strokeWidth={1.5} /></span>
        <span className="mono">NETWORK REQUIRED</span>
        <h2>Switch network to continue</h2>
        <p>The active wallet must use the configured Robinhood Chain before session verification or paid actions.</p>
        <WalletButton />
      </div>
    )
  }

  if (!auth) {
    return (
      <div className="panel auth-gate">
        <span className="auth-gate__icon"><Fingerprint size={21} strokeWidth={1.5} /></span>
        <span className="mono">SESSION VERIFICATION</span>
        <h2>Verify your wallet</h2>
        <p>Sign a message to start a secure session. This uses no gas and submits no transaction.</p>
        {error && <p className="form-message form-message--error">{error}</p>}
        <button type="button" className="btn btn--primary" onClick={signIn} disabled={signingIn}>
          {signingIn ? 'Waiting for signature…' : 'Sign in securely'}
        </button>
      </div>
    )
  }

  if (requireBuilder && !auth.is_builder) {
    return <div className="panel auth-gate"><ShieldCheck size={22} /><h2>Builder access required</h2><p>Register from Builder studio first.</p></div>
  }

  if (requireAdmin && !auth.is_admin) {
    return <div className="panel auth-gate"><ShieldCheck size={22} /><h2>Admin access required</h2><p>This wallet is not authorized for governance.</p></div>
  }

  return <>{children(auth)}</>
}
