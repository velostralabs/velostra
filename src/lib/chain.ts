import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { injected, metaMask } from 'wagmi/connectors'

// ─────────────────────────────────────────
// Robinhood Chain — Arbitrum Orbit L2
// https://docs.robinhood.com/chain/connecting/
// ─────────────────────────────────────────
export const ROBINHOOD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 4663)
if (ROBINHOOD_CHAIN_ID !== 4663 && ROBINHOOD_CHAIN_ID !== 46630) {
  throw new Error('VITE_CHAIN_ID must be Robinhood mainnet 4663 or testnet 46630')
}

export const ROBINHOOD_IS_TESTNET = ROBINHOOD_CHAIN_ID === 46630
export const ROBINHOOD_CHAIN_NAME = ROBINHOOD_IS_TESTNET
  ? 'Robinhood Chain Testnet'
  : 'Robinhood Chain'
export const ROBINHOOD_RPC_URL = import.meta.env.VITE_CHAIN_RPC_URL ?? (
  ROBINHOOD_IS_TESTNET
    ? 'https://rpc.testnet.chain.robinhood.com'
    : 'https://rpc.mainnet.chain.robinhood.com'
)
export const ROBINHOOD_EXPLORER_URL = import.meta.env.VITE_CHAIN_EXPLORER_URL ?? (
  ROBINHOOD_IS_TESTNET
    ? 'https://explorer.testnet.chain.robinhood.com'
    : 'https://robinhoodchain.blockscout.com'
)
export const ROBINHOOD_FAUCET_URL = 'https://faucet.testnet.chain.robinhood.com/'

for (const [name, value] of Object.entries({
  VITE_CHAIN_RPC_URL: ROBINHOOD_RPC_URL,
  VITE_CHAIN_EXPLORER_URL: ROBINHOOD_EXPLORER_URL,
})) {
  if (new URL(value).protocol !== 'https:') throw new Error(`${name} must use HTTPS`)
}

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: ROBINHOOD_CHAIN_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: ROBINHOOD_EXPLORER_URL },
  },
  testnet: ROBINHOOD_IS_TESTNET,
})

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [
    injected({ target: 'metaMask', shimDisconnect: true }),
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
    4663: http(),
    46630: http(),
  },
})

export const CHAIN_FACTS = [
  { label: 'CHAIN', value: ROBINHOOD_CHAIN_NAME },
  { label: 'CHAIN ID', value: String(ROBINHOOD_CHAIN_ID) },
  { label: 'STACK', value: 'Arbitrum Orbit' },
  { label: 'GAS TOKEN', value: 'ETH' },
  { label: 'SETTLEMENT', value: 'Ethereum L1' },
  { label: 'BLOCK TIME', value: '100ms' },
  { label: 'EXPLORER', value: 'Blockscout' },
]
