import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { parseUnits } from 'viem'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import PageShell from '../components/PageShell'
import SignInGate from '../components/SignInGate'
import BuilderPlatform from '../components/BuilderPlatform'
import { api } from '../lib/api'
import { ROBINHOOD_EXPLORER_URL } from '../lib/chain'
import { velostraEscrowAbi, VELOSTRA_ESCROW_ADDRESS } from '../lib/contract'

interface BuilderData {
  id: string
  display_name: string
  agents: Array<{ id: string; name: string; slug: string; status: string; price_per_call: number; total_calls: number }>
  earnings: { total_earned: number; available: number; total_claimed: number } | null
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [backendRegistered, setBackendRegistered] = useState(false)
  const [initializeHash, setInitializeHash] = useState<`0x${string}`>()
  const [error, setError] = useState<string | null>(null)
  const initializeHandled = useRef<`0x${string}` | null>(null)
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const { data: initializeReceipt, isError: initializeWaitFailed } = useWaitForTransactionReceipt({
    hash: initializeHash,
    confirmations: 1,
    query: { enabled: Boolean(initializeHash) },
  })

  useEffect(() => {
    if (!initializeReceipt || !initializeHash) return
    if (initializeHandled.current === initializeHash) return
    initializeHandled.current = initializeHash

    if (initializeReceipt.status === 'success') {
      onDone()
    } else {
      setError('Builder initialization reverted onchain.')
      setInitializeHash(undefined)
    }
  }, [initializeHash, initializeReceipt, onDone])

  useEffect(() => {
    if (initializeWaitFailed) {
      setError('Unable to confirm builder initialization from the configured RPC.')
      setInitializeHash(undefined)
    }
  }, [initializeWaitFailed])

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      if (!backendRegistered) {
        await api.post('/api/builder/register', { display_name: name, bio: bio || undefined })
        setBackendRegistered(true)
      }

      if (!VELOSTRA_ESCROW_ADDRESS || !address) {
        onDone()
        return
      }

      const hash = await writeContractAsync({
        address: VELOSTRA_ESCROW_ADDRESS,
        abi: velostraEscrowAbi,
        functionName: 'initializeBuilder',
      })
      initializeHandled.current = null
      setInitializeHash(hash)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Builder registration failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="panel">
      <h3 className="panel-title">Become a builder</h3>
      <div className="field-row">
        <label htmlFor="builder-display-name">Display name</label>
        <input id="builder-display-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your builder name" />
      </div>
      <div className="field-row">
        <label htmlFor="builder-bio">Bio (optional)</label>
        <textarea id="builder-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
      </div>
      <button
        type="button"
        className="btn btn--primary"
        onClick={submit}
        disabled={submitting || isPending || Boolean(initializeHash) || (!backendRegistered && !name)}
      >
        {initializeHash
          ? 'Confirming initialization...'
          : backendRegistered
            ? 'Initialize onchain'
            : submitting || isPending
              ? 'Registering...'
              : 'Register as builder'}
      </button>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      {!VELOSTRA_ESCROW_ADDRESS && backendRegistered && (
        <p className="form-message form-message--notice">
          Backend registration completed. Onchain initialization is skipped until the escrow address is configured.
        </p>
      )}
    </div>
  )
}

function SubmitAgentForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    endpoint_url: '',
    price_per_call: '0.20',
    category: 'OTHER',
  })
  const [submitting, setSubmitting] = useState(false)
  const [secretKey, setSecretKey] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await api.post<{ secret_key: string }>('/api/builder/agents', {
        ...form,
        price_per_call: Number(form.price_per_call),
      })
      setSecretKey(res.secret_key)
      onDone()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Agent submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (secretKey) {
    return (
      <div className="panel">
        <h3 className="panel-title">Agent submitted</h3>
        <p className="secret-note">
          Save this secret key — it's used to verify Velostra's HMAC-signed requests to your endpoint.
          It won't be shown again.
        </p>
        <code className="mono secret-block">
          {secretKey}
        </code>
      </div>
    )
  }

  return (
    <div className="panel">
      <h3 className="panel-title">Submit a new agent</h3>
      <div className="field-row">
        <label htmlFor="agent-name">Name</label>
        <input id="agent-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field-row">
        <label htmlFor="agent-description">Description</label>
        <textarea
          id="agent-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
        />
      </div>
      <div className="field-row">
        <label htmlFor="agent-endpoint">Endpoint URL</label>
        <input
          id="agent-endpoint"
          value={form.endpoint_url}
          onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
          placeholder="https://your-agent.example.com/run"
        />
      </div>
      <div className="form-grid">
        <div className="field-row">
          <label htmlFor="agent-price">Price per call (USD)</label>
          <input
            id="agent-price"
            value={form.price_per_call}
            onChange={(e) => setForm({ ...form, price_per_call: e.target.value })}
          />
        </div>
        <div className="field-row">
          <label htmlFor="agent-category-builder">Category</label>
          <select id="agent-category-builder" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="CRYPTO_DEFI">Crypto / DeFi</option>
            <option value="WALLET_ANALYSIS">Wallet Analysis</option>
            <option value="TOKEN_RESEARCH">Token Research</option>
            <option value="TRADING">Trading</option>
            <option value="WRITING">Writing</option>
            <option value="RESEARCH">Research</option>
            <option value="PRODUCTIVITY">Productivity</option>
            <option value="DATA_ANALYSIS">Data Analysis</option>
            <option value="CODE">Code</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        className="btn btn--primary"
        onClick={submit}
        disabled={submitting || !form.name || !form.endpoint_url}
      >
        {submitting ? 'Submitting…' : 'Submit for review'}
      </button>
      {submitError && <p className="form-message form-message--error">{submitError}</p>}
    </div>
  )
}

function BuilderConsole() {
  const [data, setData] = useState<BuilderData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notRegistered, setNotRegistered] = useState(false)
  const [claimAmount, setClaimAmount] = useState('')
  const [pendingClaim, setPendingClaim] = useState<{ amount: number; units: bigint } | null>(null)
  const [claimHash, setClaimHash] = useState<`0x${string}`>()
  const [lastClaimHash, setLastClaimHash] = useState<`0x${string}`>()
  const [claimError, setClaimError] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const claimHandled = useRef<`0x${string}` | null>(null)
  const { writeContractAsync, isPending } = useWriteContract()
  const { data: claimReceipt, isError: claimWaitFailed } = useWaitForTransactionReceipt({
    hash: claimHash,
    confirmations: 1,
    query: { enabled: Boolean(claimHash) },
  })

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const response = await api.get<{ builder: BuilderData | null }>('/api/builder/me')
      if (response.builder) {
        setData(response.builder)
        setNotRegistered(false)
      } else {
        setData(null)
        setNotRegistered(true)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Builder console unavailable')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reconcileClaim = useCallback(async () => {
    if (!claimHash || !pendingClaim) return
    setReconciling(true)
    setClaimError(null)
    try {
      await api.post('/api/builder/claim', {
        amount: pendingClaim.amount,
        tx_hash: claimHash,
      })
      setLastClaimHash(claimHash)
      setClaimAmount('')
      setPendingClaim(null)
      setClaimHash(undefined)
      await load()
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'Claim confirmed but dashboard sync failed.')
    } finally {
      setReconciling(false)
    }
  }, [claimHash, load, pendingClaim])

  useEffect(() => {
    if (!claimReceipt || !claimHash) return
    if (claimHandled.current === claimHash) return
    claimHandled.current = claimHash

    if (claimReceipt.status !== 'success') {
      setClaimError('Claim reverted onchain.')
      setPendingClaim(null)
      return
    }
    void reconcileClaim()
  }, [claimHash, claimReceipt, reconcileClaim])

  useEffect(() => {
    if (claimWaitFailed) {
      setClaimError('Unable to confirm the claim receipt from the configured RPC.')
    }
  }, [claimWaitFailed])

  async function handleClaim() {
    if (!VELOSTRA_ESCROW_ADDRESS || !claimAmount) return

    const amount = Number(claimAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setClaimError('Enter a valid positive claim amount.')
      return
    }
    const available = data?.earnings?.available ?? 0
    if (amount > available) {
      setClaimError('Claim amount cannot exceed your available earnings.')
      return
    }

    let units: bigint
    try {
      units = parseUnits(claimAmount, 6)
    } catch {
      setClaimError('Use a valid amount with at most 6 decimal places.')
      return
    }

    setClaimError(null)
    setLastClaimHash(undefined)
    setPendingClaim({ amount, units })
    setClaimHash(undefined)
    claimHandled.current = null

    try {
      const hash = await writeContractAsync({
        address: VELOSTRA_ESCROW_ADDRESS,
        abi: velostraEscrowAbi,
        functionName: 'claimEarnings',
        args: [units],
      })
      setClaimHash(hash)
    } catch (error) {
      setPendingClaim(null)
      setClaimError(error instanceof Error ? error.message : 'Claim transaction was not submitted.')
    }
  }

  if (loadError) return <div className="empty-state empty-state--error" role="alert"><strong>Builder console unavailable.</strong><span>{loadError}</span><button type="button" className="btn btn--ghost" onClick={() => void load()}>Retry</button></div>
  if (notRegistered) return <RegisterForm onDone={() => void load()} />
  if (!data) return <div className="page-skeleton" role="status"><span className="sr-only">Loading builder console</span><i /><i /><i /></div>

  const claimLabel = claimHash
    ? reconciling
      ? 'Syncing earnings...'
      : 'Confirming claim...'
    : isPending
      ? 'Confirm in wallet...'
      : 'Claim to wallet'

  return (
    <>
      <div className="metric-grid metric-grid--three">
        <div>
          <div className="metric-card__label">AVAILABLE TO CLAIM</div>
          <div className="mono metric-card__value metric-card__value--positive">
            ${(data.earnings?.available ?? 0).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="metric-card__label">TOTAL EARNED</div>
          <div className="mono metric-card__value">
            ${(data.earnings?.total_earned ?? 0).toFixed(2)}
          </div>
        </div>
        <div>
          <div className="metric-card__label">TOTAL CLAIMED</div>
          <div className="mono metric-card__value">
            ${(data.earnings?.total_claimed ?? 0).toFixed(2)}
          </div>
        </div>
      </div>

      <div className="panel panel--spaced">
        <h3 className="panel-title">Claim earnings</h3>
        <div className="action-row">
          <div className="field-row action-row__field">
            <label htmlFor="builder-claim-amount">Amount (USDG)</label>
            <input id="builder-claim-amount" inputMode="decimal" min="0" max={data.earnings?.available ?? 0} step="0.01" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} placeholder="0.00" />
            <small>Available: ${(data.earnings?.available ?? 0).toFixed(2)} USDG.</small>
          </div>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleClaim}
            disabled={isPending || Boolean(pendingClaim) || !claimAmount}
          >
            {claimLabel}
          </button>
        </div>
        {lastClaimHash && !claimError && (
          <p className="form-message form-message--notice" role="status">
            Claim confirmed and indexed.
            <a href={ROBINHOOD_EXPLORER_URL + '/tx/' + lastClaimHash} target="_blank" rel="noreferrer">
              Inspect transaction <ArrowUpRight size={13} />
            </a>
          </p>
        )}
        {claimError && (
          <div className="recovery-message">
            <p className="form-message form-message--error" role="alert">{claimError}</p>
            {claimHash && (
              <a className="btn btn--ghost btn--small" href={ROBINHOOD_EXPLORER_URL + '/tx/' + claimHash} target="_blank" rel="noreferrer">
                Inspect confirmed claim <ArrowUpRight size={13} />
              </a>
            )}
            {claimReceipt?.status === 'success' && pendingClaim && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => void reconcileClaim()}
                disabled={reconciling}
              >
                Retry earnings sync
              </button>
            )}
          </div>
        )}
        {!VELOSTRA_ESCROW_ADDRESS && (
          <p className="form-message form-message--notice">
            Set <code>VITE_ESCROW_ADDRESS</code> after VelostraEscrow.sol is deployed.
          </p>
        )}
      </div>

      <div className="panel panel--spaced">
        <h3 className="panel-title">Your agents</h3>
        {data.agents.length === 0 ? (
          <div className="empty-state">No agents submitted yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Price</th>
                <th>Calls</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.id}>
                  <td><Link className="table-link" to={'/agents/' + a.slug}>{a.name}</Link></td>
                  <td>
                    <span
                      className={`badge ${a.status === 'APPROVED' ? 'badge--success' : a.status === 'REJECTED' ? 'badge--danger' : 'badge--warn'}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="mono">${a.price_per_call.toFixed(2)}</td>
                  <td className="mono">{a.total_calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SubmitAgentForm onDone={() => void load()} />
      <BuilderPlatform agents={data.agents} />
    </>
  )
}

export default function Builder() {
  return (
    <PageShell>
      <div className="page-heading">
        <span className="section-eyebrow">Builder studio</span>
        <h1 className="page-title">Builder console</h1>
        <p className="page-sub">Deploy agents, track earnings, and claim to your wallet on Robinhood Chain.</p>
      </div>
      <SignInGate>{() => <BuilderConsole />}</SignInGate>
    </PageShell>
  )
}
