import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { parseUnits, type Hex } from 'viem'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  ExternalLink,
  FlaskConical,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import PageShell from '../components/PageShell'
import WalletButton from '../components/WalletButton'
import { api } from '../lib/api'
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_NAME,
  ROBINHOOD_EXPLORER_URL,
  ROBINHOOD_FAUCET_URL,
  ROBINHOOD_IS_TESTNET,
} from '../lib/chain'
import {
  settlementTokenAbi,
  SETTLEMENT_TOKEN_ADDRESS,
} from '../lib/contract'
import './Testnet.css'

const TESTNET_MINT_AMOUNT = '25'
const validAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value)

interface PublicHealth {
  status: string
  environment: string
  chainId: number
  publicTestnet: boolean
  paidWrites: string
}

type PublicHealthState = 'checking' | 'live' | 'read-only' | 'unavailable'

export default function Testnet() {
  const { address, chainId, isConnected } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const [mintHash, setMintHash] = useState<Hex>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  const [healthState, setHealthState] = useState<PublicHealthState>('checking')
  const tokenConfigured = validAddress(SETTLEMENT_TOKEN_ADDRESS)
  const correctNetwork = chainId === ROBINHOOD_CHAIN_ID
  const { data: receipt, isError: receiptFailed } = useWaitForTransactionReceipt({
    hash: mintHash,
    confirmations: 1,
    query: { enabled: Boolean(mintHash) },
  })

  useEffect(() => {
    const controller = new AbortController()
    setHealthState('checking')
    api.get<PublicHealth>('/health', { signal: controller.signal })
      .then((health) => {
        const correctStack =
          health.status === 'ok' &&
          health.environment === 'staging' &&
          health.chainId === ROBINHOOD_CHAIN_ID
        if (!correctStack) {
          setHealthState('unavailable')
          return
        }
        setHealthState(
          health.publicTestnet && health.paidWrites === 'enabled' ? 'live' : 'read-only'
        )
      })
      .catch((healthError: unknown) => {
        if (healthError instanceof DOMException && healthError.name === 'AbortError') return
        setHealthState('unavailable')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!receipt) return
    if (receipt.status === 'success') {
      setMessage(TESTNET_MINT_AMOUNT + ' synthetic USDG minted. You can now deposit it in the execution console.')
      setError(undefined)
      return
    }
    setError('The synthetic USDG mint reverted onchain.')
  }, [receipt])

  useEffect(() => {
    if (receiptFailed) setError('The configured RPC could not confirm the mint receipt.')
  }, [receiptFailed])

  async function mintTestCredits() {
    if (!ROBINHOOD_IS_TESTNET) {
      setError('Synthetic minting is available only on the Robinhood Chain testnet build.')
      return
    }
    if (!address || !isConnected) {
      setError('Connect a wallet before minting synthetic USDG.')
      return
    }
    if (!correctNetwork) {
      setError('Switch the wallet to ' + ROBINHOOD_CHAIN_NAME + ' before minting.')
      return
    }
    if (!tokenConfigured) {
      setError('The public testnet settlement token is not configured in this release.')
      return
    }

    setError(undefined)
    setMessage(undefined)
    setMintHash(undefined)
    try {
      const hash = await writeContractAsync({
        address: SETTLEMENT_TOKEN_ADDRESS,
        abi: settlementTokenAbi,
        functionName: 'mint',
        args: [address, parseUnits(TESTNET_MINT_AMOUNT, 6)],
      })
      setMintHash(hash)
      setMessage('Mint submitted. Waiting for one onchain confirmation.')
    } catch (mintError) {
      setError(mintError instanceof Error ? mintError.message : 'The synthetic USDG mint was not submitted.')
    }
  }

  const steps = [
    {
      index: '01',
      icon: WalletCards,
      title: 'Connect your wallet',
      copy: 'MetaMask and compatible browser wallets are supported on chain ' + ROBINHOOD_CHAIN_ID + '.',
      action: <WalletButton />,
    },
    {
      index: '02',
      icon: FlaskConical,
      title: 'Get testnet gas',
      copy: 'Use the official Robinhood faucet. Test ETH has no real-world value.',
      action: (
        <a className="btn btn--ghost" href={ROBINHOOD_FAUCET_URL} target="_blank" rel="noreferrer">
          Open official faucet <ExternalLink size={14} />
        </a>
      ),
    },
    {
      index: '03',
      icon: Coins,
      title: 'Mint synthetic USDG',
      copy: 'Mint ' + TESTNET_MINT_AMOUNT + ' test USDG to exercise the deposit and paid-call loop.',
      action: (
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!ROBINHOOD_IS_TESTNET || !isConnected || !correctNetwork || !tokenConfigured || isPending}
          onClick={() => void mintTestCredits()}
        >
          {isPending ? 'Confirm in wallet…' : 'Mint ' + TESTNET_MINT_AMOUNT + ' test USDG'}
        </button>
      ),
    },
    {
      index: '04',
      icon: Activity,
      title: 'Run the verified loop',
      copy: 'Deposit test credits, call an agent, and inspect the correlated settlement evidence.',
      action: (
        <Link className="btn btn--primary" to="/dashboard">
          Open execution console <ArrowRight size={14} />
        </Link>
      ),
    },
  ]

  return (
    <PageShell>
      <section className="testnet-hero">
        <div className="testnet-hero__copy">
          <span className="section-eyebrow">Public verification network</span>
          <h1 className="page-title">Use the whole system before mainnet.</h1>
          <p className="page-sub">
            Velostra&apos;s public testnet exposes wallet authentication, synthetic credits,
            paid agent execution, onchain settlement, receipts, and self-healing reconciliation
            without putting real funds at risk.
          </p>
          <div className="testnet-hero__signals" aria-label="Testnet guarantees">
            <span><CheckCircle2 size={14} /> Publicly accessible</span>
            <span><ShieldCheck size={14} /> Bounded paid calls</span>
            <span><Activity size={14} /> Reconciliation active</span>
          </div>
        </div>

        <aside className="testnet-disclosure" aria-label="Testnet disclosure">
          <span className={'testnet-disclosure__state testnet-disclosure__state--' + healthState}>
            <i />
            {healthState === 'checking'
              ? 'CHECKING RUNTIME'
              : healthState === 'live'
                ? 'TESTNET LIVE'
                : healthState === 'read-only'
                  ? 'PAID CALLS PAUSED'
                  : 'RUNTIME UNAVAILABLE'}
          </span>
          <strong>No real funds.</strong>
          <p>
            Test ETH and synthetic USDG have no monetary value. Contracts, balances, agents,
            and indexed history may be reset as the protocol is upgraded.
          </p>
          <dl>
            <div><dt>Network</dt><dd>{ROBINHOOD_CHAIN_NAME}</dd></div>
            <div><dt>Chain ID</dt><dd className="mono">{ROBINHOOD_CHAIN_ID}</dd></div>
            <div><dt>Settlement</dt><dd>Synthetic USDG</dd></div>
            <div><dt>Environment</dt><dd>US staging</dd></div>
            <div>
              <dt>Paid calls</dt>
              <dd>{healthState === 'live' ? 'Enabled / bounded' : healthState === 'checking' ? 'Checking' : 'Paused'}</dd>
            </div>
          </dl>
        </aside>
      </section>

      {!ROBINHOOD_IS_TESTNET && (
        <div className="testnet-build-warning" role="alert">
          This release is not configured as a public testnet build. Transactions are disabled here.
        </div>
      )}

      <section className="testnet-steps" aria-labelledby="testnet-steps-title">
        <div className="testnet-steps__heading">
          <span className="mono">START / VERIFY / SETTLE</span>
          <h2 id="testnet-steps-title">Four steps. Real chain evidence. Zero real value.</h2>
        </div>
        <div className="testnet-steps__grid">
          {steps.map(({ index, icon: Icon, title, copy, action }) => (
            <article className="testnet-step" key={index}>
              <div className="testnet-step__meta">
                <span className="mono">{index}</span>
                <Icon size={18} strokeWidth={1.5} />
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
              <div className="testnet-step__action">{action}</div>
            </article>
          ))}
        </div>
      </section>

      {(message || error || mintHash) && (
        <section className={'testnet-result' + (error ? ' testnet-result--error' : '')} aria-live="polite">
          <div>
            <span className="mono">{error ? 'ACTION REQUIRED' : receipt?.status === 'success' ? 'CONFIRMED' : 'PENDING'}</span>
            <strong>{error ?? message}</strong>
          </div>
          {mintHash && (
            <a
              href={ROBINHOOD_EXPLORER_URL + '/tx/' + mintHash}
              target="_blank"
              rel="noreferrer"
            >
              Inspect transaction <ArrowUpRight size={14} />
            </a>
          )}
        </section>
      )}

      <section className="testnet-proof-strip">
        <div><span className="mono">01</span><strong>Wallet-signed</strong><p>You authorize every user-side token action.</p></div>
        <div><span className="mono">02</span><strong>Call-correlated</strong><p>A durable call ID follows execution into settlement.</p></div>
        <div><span className="mono">03</span><strong>Chain-indexed</strong><p>Receipts can repair missing database state automatically.</p></div>
        <div><span className="mono">04</span><strong>Rate-bounded</strong><p>Per-call and daily caps limit public testnet exposure.</p></div>
      </section>
    </PageShell>
  )
}