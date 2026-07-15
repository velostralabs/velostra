import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ShieldCheck, WalletCards, X } from 'lucide-react'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { robinhoodChain } from '../lib/chain'
import './WalletButton.css'

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function isMetaMask(name: string) {
  return name.toLowerCase().includes('metamask')
}

function walletLabel(name: string) {
  return name.toLowerCase() === 'injected' ? 'Other browser wallet' : name
}

export default function WalletButton() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingConnectorUid, setPendingConnectorUid] = useState<string>()
  const pickerId = useId()
  const walletRootRef = useRef<HTMLDivElement>(null)
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, error, isPending, reset } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()

  const walletOptions = useMemo(() => {
    const ordered = [...connectors].sort((left, right) => {
      const leftRank = left.id === 'metaMaskSDK' ? 0 : isMetaMask(left.name) ? 1 : 2
      const rightRank = right.id === 'metaMaskSDK' ? 0 : isMetaMask(right.name) ? 1 : 2
      return leftRank - rightRank
    })

    return ordered.filter((connector, index) => {
      const key = isMetaMask(connector.name)
        ? 'metamask'
        : `${connector.id}:${connector.name.toLowerCase()}`
      return ordered.findIndex((candidate) => {
        const candidateKey = isMetaMask(candidate.name)
          ? 'metamask'
          : `${candidate.id}:${candidate.name.toLowerCase()}`
        return candidateKey === key
      }) === index
    })
  }, [connectors])

  useEffect(() => {
    if (!pickerOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!walletRootRef.current?.contains(event.target as Node)) setPickerOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [pickerOpen])

  if (isConnected && address) {
    const wrongChain = chainId !== robinhoodChain.id
    if (wrongChain) {
      return (
        <button
          type="button"
          className="wallet-btn wallet-btn--warn"
          aria-label="Switch wallet to Robinhood Chain"
          onClick={() => switchChain({ chainId: robinhoodChain.id })}
        >
          <span className="wallet-btn__dot wallet-btn__dot--warn" />
          Switch network
        </button>
      )
    }
    return (
      <button
        type="button"
        className="wallet-btn wallet-btn--connected"
        aria-label={`Disconnect wallet ${truncate(address)}`}
        onClick={() => disconnect()}
      >
        <span className="wallet-btn__dot" />
        <span className="mono">{truncate(address)}</span>
      </button>
    )
  }

  return (
    <div className="wallet-connect" ref={walletRootRef}>
      <button
        type="button"
        className="wallet-btn wallet-btn--primary"
        aria-controls={pickerId}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        disabled={!walletOptions.length}
        onClick={() => {
          reset()
          setPickerOpen((open) => !open)
        }}
      >
        {walletOptions.length ? 'Connect Wallet' : 'Wallet unavailable'}
        {walletOptions.length > 0 && (
          <ChevronDown
            className={pickerOpen ? 'wallet-btn__chevron wallet-btn__chevron--open' : 'wallet-btn__chevron'}
            size={13}
          />
        )}
      </button>

      {pickerOpen && (
        <section id={pickerId} className="wallet-picker" role="dialog" aria-label="Choose a wallet">
          <div className="wallet-picker__header">
            <div>
              <span className="wallet-picker__eyebrow mono">SECURE CONNECTION</span>
              <h2>Choose your wallet</h2>
            </div>
            <button
              type="button"
              className="wallet-picker__close"
              aria-label="Close wallet picker"
              onClick={() => setPickerOpen(false)}
            >
              <X size={15} />
            </button>
          </div>

          <div className="wallet-picker__options">
            {walletOptions.map((connector) => {
              const metaMaskConnector = isMetaMask(connector.name)
              const pending = isPending && pendingConnectorUid === connector.uid
              return (
                <button
                  type="button"
                  className={metaMaskConnector ? 'wallet-option wallet-option--featured' : 'wallet-option'}
                  disabled={isPending}
                  key={connector.uid}
                  onClick={() => {
                    reset()
                    setPendingConnectorUid(connector.uid)
                    connect({ connector, chainId: robinhoodChain.id })
                  }}
                >
                  <span
                    className={metaMaskConnector
                      ? 'wallet-option__icon wallet-option__icon--metamask'
                      : 'wallet-option__icon'}
                    aria-hidden="true"
                  >
                    {connector.icon
                      ? <img src={connector.icon} alt="" />
                      : <WalletCards size={18} strokeWidth={1.5} />}
                  </span>
                  <span className="wallet-option__copy">
                    <strong>{walletLabel(connector.name)}</strong>
                    <small>{metaMaskConnector ? 'Extension or MetaMask mobile' : 'Rainbow, Coinbase, or injected wallet'}</small>
                  </span>
                  <span className="wallet-option__status mono">
                    {pending ? 'OPENING…' : metaMaskConnector ? 'RECOMMENDED' : 'CONNECT'}
                  </span>
                </button>
              )
            })}
          </div>

          {error && <p className="wallet-picker__error" role="alert">{error.message}</p>}

          <div className="wallet-picker__footer">
            <ShieldCheck size={13} strokeWidth={1.5} />
            <span>Velostra never stores your wallet keys.</span>
          </div>
        </section>
      )}
    </div>
  )
}
