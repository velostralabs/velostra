import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { robinhoodChain } from '../lib/chain'
import './WalletButton.css'

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function WalletButton() {
  const { address, isConnected, chainId } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()

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

  const connector = connectors[0]
  return (
    <button
      type="button"
      className="wallet-btn wallet-btn--primary"
      aria-busy={isPending}
      disabled={isPending || !connector}
      onClick={() => connector && connect({ connector, chainId: robinhoodChain.id })}
    >
      {isPending ? 'Connecting…' : connector ? 'Connect Wallet' : 'Wallet unavailable'}
    </button>
  )
}