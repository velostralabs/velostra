import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { injected, metaMask } from 'wagmi/connectors'

// ─────────────────────────────────────────
// Robinhood Chain — Arbitrum Orbit L2
// https://docs.robinhood.com/chain/connecting/
// ─────────────────────────────────────────
export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  testnet: false,
})

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [
    metaMask({
      dapp: {
        name: 'Velostra',
        url: typeof window === 'undefined' ? undefined : window.location.origin,
        iconUrl: typeof window === 'undefined'
          ? undefined
          : `${window.location.origin}/velostra-crystal-v-192.png`,
      },
    }),
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [robinhoodChain.id]: http(),
  },
})

export const CHAIN_FACTS = [
  { label: 'CHAIN', value: 'Robinhood Chain' },
  { label: 'CHAIN ID', value: '4663' },
  { label: 'STACK', value: 'Arbitrum Orbit' },
  { label: 'GAS TOKEN', value: 'ETH' },
  { label: 'SETTLEMENT', value: 'Ethereum L1' },
  { label: 'BLOCK TIME', value: '100ms' },
  { label: 'EXPLORER', value: 'Blockscout' },
]
