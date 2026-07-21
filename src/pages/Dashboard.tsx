import { useCallback, useEffect, useRef, useState } from 'react'
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import PageShell from '../components/PageShell'
import SignInGate from '../components/SignInGate'
import PrivacyCenter from '../components/PrivacyCenter'
import { api } from '../lib/api'
import { ROBINHOOD_EXPLORER_URL, ROBINHOOD_IS_TESTNET } from '../lib/chain'
import {
  settlementTokenAbi,
  SETTLEMENT_TOKEN_ADDRESS,
  velostraEscrowAbi,
  VELOSTRA_ESCROW_ADDRESS,
} from '../lib/contract'

const PUBLIC_TESTNET_MAX_TOPUP_USDG = 100

interface DashboardData {
  balance_usd: number
  free_tier: { used: number; remaining: number; limit: number; hasRemaining: boolean }
  recent_calls: Array<{
    id: string
    status: string
    price_charged: number
    is_free_tier: boolean
    created_at: string
    agent: { name: string; slug: string }
  }>
}

function DashboardContent() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [topupAmount, setTopupAmount] = useState('10')
  const [pendingTopUp, setPendingTopUp] = useState<{ amountUsd: number; amountUnits: bigint } | null>(null)
  const [approvalHash, setApprovalHash] = useState<`0x${string}`>()
  const [depositHash, setDepositHash] = useState<`0x${string}`>()
  const [lastDepositHash, setLastDepositHash] = useState<`0x${string}`>()
  const [flowError, setFlowError] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const approvalHandled = useRef<`0x${string}` | null>(null)
  const depositHandled = useRef<`0x${string}` | null>(null)
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()

  const { data: approvalReceipt, isError: approvalWaitFailed } = useWaitForTransactionReceipt({
    hash: approvalHash,
    confirmations: 1,
    query: { enabled: Boolean(approvalHash) },
  })
  const { data: depositReceipt, isError: depositWaitFailed } = useWaitForTransactionReceipt({
    hash: depositHash,
    confirmations: 1,
    query: { enabled: Boolean(depositHash) },
  })

  const load = useCallback(async () => {
    setDataError(null)
    try {
      setData(await api.get<DashboardData>('/api/dashboard'))
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Dashboard unavailable')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasProcessingCalls = data?.recent_calls.some((call) => call.status === 'PROCESSING') ?? false
  useEffect(() => {
    if (!hasProcessingCalls) return
    const interval = window.setInterval(() => void load(), 5_000)
    return () => window.clearInterval(interval)
  }, [hasProcessingCalls, load])

  useEffect(() => {
    if (!approvalReceipt || !pendingTopUp || !approvalHash) return
    if (approvalHandled.current === approvalHash) return

    approvalHandled.current = approvalHash
    if (approvalReceipt.status !== 'success') {
      setFlowError('Token approval reverted onchain.')
      setPendingTopUp(null)
      return
    }

    void writeContractAsync({
      address: VELOSTRA_ESCROW_ADDRESS,
      abi: velostraEscrowAbi,
      functionName: 'depositCredits',
      args: [pendingTopUp.amountUnits],
    })
      .then(setDepositHash)
      .catch((error) => {
        setFlowError(error instanceof Error ? error.message : 'Deposit transaction was not submitted.')
        setPendingTopUp(null)
      })
  }, [approvalHash, approvalReceipt, pendingTopUp, writeContractAsync])

  const reconcileTopUp = useCallback(async () => {
    if (!depositHash || !pendingTopUp) return
    setReconciling(true)
    setFlowError(null)
    try {
      await api.post('/api/dashboard/topup', {
        amount_usd: pendingTopUp.amountUsd,
        tx_hash: depositHash,
      })
      setLastDepositHash(depositHash)
      await load()
      setPendingTopUp(null)
      setApprovalHash(undefined)
      setDepositHash(undefined)
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : 'Deposit confirmed but dashboard sync failed.')
    } finally {
      setReconciling(false)
    }
  }, [depositHash, load, pendingTopUp])

  useEffect(() => {
    if (!depositReceipt || !depositHash) return
    if (depositHandled.current === depositHash) return

    depositHandled.current = depositHash
    if (depositReceipt.status !== 'success') {
      setFlowError('Deposit reverted onchain.')
      setPendingTopUp(null)
      return
    }
    void reconcileTopUp()
  }, [depositHash, depositReceipt, reconcileTopUp])

  useEffect(() => {
    if (!approvalWaitFailed && !depositWaitFailed) return
    setFlowError('Unable to confirm the transaction receipt from the configured RPC.')
  }, [approvalWaitFailed, depositWaitFailed])

  async function handleTopUp() {
    if (!VELOSTRA_ESCROW_ADDRESS || !SETTLEMENT_TOKEN_ADDRESS || !address) {
      setFlowError('Escrow and settlement-token addresses must be configured first.')
      return
    }

    const amountUsd = Number(topupAmount)
    if (!Number.isFinite(amountUsd) || amountUsd < 1) {
      setFlowError('Top-up amount must be at least $1.00.')
      return
    }
    if (ROBINHOOD_IS_TESTNET && amountUsd > PUBLIC_TESTNET_MAX_TOPUP_USDG) {
      setFlowError('Public testnet top-ups are capped at $100.00 synthetic USDG per deposit.')
      return
    }

    let amountUnits: bigint
    try {
      amountUnits = parseUnits(topupAmount, 6)
    } catch {
      setFlowError('Use a valid amount with at most 6 decimal places.')
      return
    }

    setFlowError(null)
    setLastDepositHash(undefined)
    setApprovalHash(undefined)
    setDepositHash(undefined)
    approvalHandled.current = null
    depositHandled.current = null
    setPendingTopUp({ amountUsd, amountUnits })

    try {
      const hash = await writeContractAsync({
        address: SETTLEMENT_TOKEN_ADDRESS,
        abi: settlementTokenAbi,
        functionName: 'approve',
        args: [VELOSTRA_ESCROW_ADDRESS, amountUnits],
      })
      setApprovalHash(hash)
    } catch (error) {
      setPendingTopUp(null)
      setFlowError(error instanceof Error ? error.message : 'Token approval was not submitted.')
    }
  }

  if (dataError) return <div className="empty-state empty-state--error" role="alert"><strong>Dashboard unavailable.</strong><span>{dataError}</span><button type="button" className="btn btn--ghost" onClick={() => void load()}>Retry</button></div>
  if (!data) return <div className="page-skeleton" role="status"><span className="sr-only">Loading dashboard</span><i /><i /><i /></div>

  const flowLabel = depositHash
    ? reconciling
      ? 'Syncing dashboard...'
      : 'Confirming deposit...'
    : approvalHash
      ? 'Approving token...'
      : isPending
        ? 'Confirm in wallet...'
        : 'Deposit onchain'

  return (
    <>
      <div className="metric-grid metric-grid--two">
        <div>
          <div className="metric-card__label">CREDIT BALANCE</div>
          <div className="mono metric-card__value">
            ${data.balance_usd.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="metric-card__label">FREE TIER THIS MONTH</div>
          <div className="mono metric-card__value">
            {data.free_tier.used} / {data.free_tier.limit}
          </div>
        </div>
      </div>

      <div className="panel panel--spaced">
        <div className="panel-title-row">
          <h3 className="panel-title">Top up credits</h3>
          <Link className="panel-title-link" to="/testnet">Testnet setup guide</Link>
        </div>
        <div className="action-row">
          <div className="field-row action-row__field">
            <label htmlFor="dashboard-topup-amount">Amount (USDG)</label>
            <input id="dashboard-topup-amount" inputMode="decimal" min="1" max={ROBINHOOD_IS_TESTNET ? PUBLIC_TESTNET_MAX_TOPUP_USDG : undefined} step="0.01" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} />
            {ROBINHOOD_IS_TESTNET && <small>Public testnet limit: 1–100 synthetic USDG per deposit.</small>}
          </div>
          <button type="button" className="btn btn--primary" onClick={handleTopUp} disabled={isPending || Boolean(pendingTopUp)}>
            {flowLabel}
          </button>
        </div>
        {lastDepositHash && !flowError && (
          <p className="form-message form-message--notice" role="status">
            Deposit confirmed and indexed.
            <a href={ROBINHOOD_EXPLORER_URL + '/tx/' + lastDepositHash} target="_blank" rel="noreferrer">
              Inspect transaction <ArrowUpRight size={13} />
            </a>
          </p>
        )}
        {flowError && (
          <div className="recovery-message">
            <p className="form-message form-message--error" role="alert">{flowError}</p>
            {depositReceipt?.status === 'success' && pendingTopUp && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => void reconcileTopUp()}
                disabled={reconciling}
              >
                Retry dashboard sync
              </button>
            )}
          </div>
        )}
        {(!VELOSTRA_ESCROW_ADDRESS || !SETTLEMENT_TOKEN_ADDRESS) && (
          <p className="form-message form-message--notice">
            Set <code>VITE_ESCROW_ADDRESS</code> and <code>VITE_SETTLEMENT_TOKEN</code> after deployment.
          </p>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">Recent calls</h3>
        {data.recent_calls.length === 0 ? (
          <div className="empty-state">No calls yet - browse the marketplace to run your first agent.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Charged</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_calls.map((c) => (
                <tr key={c.id}>
                  <td><Link className="table-link" to={'/agents/' + c.agent.slug}>{c.agent.name}</Link></td>
                  <td>
                    <span
                      className={`badge ${c.status === 'SUCCESS' ? 'badge--success' : c.status === 'FAILED' ? 'badge--danger' : 'badge--warn'}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="mono">{c.is_free_tier ? 'Free tier' : `$${c.price_charged.toFixed(2)}`}</td>
                  <td>{new Date(c.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PrivacyCenter />
    </>
  )
}

export default function Dashboard() {
  return (
    <PageShell>
      <div className="page-heading">
        <span className="section-eyebrow">Execution console</span>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-sub">Your credits, usage, and call history on Robinhood Chain.</p>
      </div>
      <SignInGate>{() => <DashboardContent />}</SignInGate>
    </PageShell>
  )
}
