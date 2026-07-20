// Minimal ABI surface used by the frontend — matches contracts/VelostraEscrow.sol
export const velostraEscrowAbi = [
  {
    type: 'function',
    name: 'depositCredits',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'initializeBuilder',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimEarnings',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getBuilderAccount',
    stateMutability: 'view',
    inputs: [{ name: 'builder', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'totalEarned', type: 'uint256' },
          { name: 'availableToClaim', type: 'uint256' },
          { name: 'totalClaimed', type: 'uint256' },
          { name: 'initialized', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'userCreditBalance',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const settlementTokenAbi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

// Set this once VelostraEscrow.sol is deployed to Robinhood Chain mainnet.
// Left blank in this phase since deployment is a separate, deliberate step
// (needs a funded deployer wallet + the real settlement token address).
export const VELOSTRA_ESCROW_ADDRESS = (import.meta.env.VITE_ESCROW_ADDRESS ??
  '') as `0x${string}`

// Settlement stablecoin on Robinhood Chain (e.g. USDG). Configure via env
// once the bridged token address is known.
export const SETTLEMENT_TOKEN_ADDRESS = (import.meta.env.VITE_SETTLEMENT_TOKEN ??
  '') as `0x${string}`
