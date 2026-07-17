import type { Page, Route } from '@playwright/test'

export const TEST_WALLET = '0x1234567890abcdef1234567890abcdef12345678'
const TX_HASHES = [
  '0x' + '11'.repeat(32),
  '0x' + '22'.repeat(32),
  '0x' + '33'.repeat(32),
  '0x' + '44'.repeat(32),
]

export interface ProductState {
  authenticated: boolean
  rejectedConnections: number
  runAttempts: number
  balance: number
  availableEarnings: number
  totalClaimed: number
}

export function createProductState(): ProductState {
  return {
    authenticated: false,
    rejectedConnections: 0,
    runAttempts: 0,
    balance: 12.5,
    availableEarnings: 4.75,
    totalClaimed: 1.25,
  }
}

export async function installInjectedWallet(
  page: Page,
  options: { initialChainId?: number; rejectFirstConnection?: boolean } = {}
): Promise<void> {
  await page.addInitScript(
    ({ account, initialChainId, rejectFirstConnection, hashes }) => {
      let chainId = initialChainId
      let connected = localStorage.getItem('velostra-e2e-wallet-connected') === 'true'
      let rejectionPending = rejectFirstConnection
      let hashIndex = 0
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

      const emit = (event: string, ...args: unknown[]) => {
        listeners.get(event)?.forEach((listener) => listener(...args))
      }

      const provider = {
        isMetaMask: false,
        providers: undefined,
        on(event: string, listener: (...args: unknown[]) => void) {
          const eventListeners = listeners.get(event) ?? new Set()
          eventListeners.add(listener)
          listeners.set(event, eventListeners)
          return provider
        },
        removeListener(event: string, listener: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(listener)
          return provider
        },
        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          if (method === 'eth_requestAccounts') {
            if (rejectionPending) {
              rejectionPending = false
              const error = new Error('User rejected the request') as Error & { code: number }
              error.code = 4001
              throw error
            }
            connected = true
            localStorage.setItem('velostra-e2e-wallet-connected', 'true')
            emit('accountsChanged', [account])
            return [account]
          }
          if (method === 'eth_accounts') return connected ? [account] : []
          if (method === 'eth_chainId') return '0x' + chainId.toString(16)
          if (method === 'wallet_switchEthereumChain') {
            const requested = Number.parseInt(
              String((params[0] as { chainId?: string } | undefined)?.chainId ?? '0x0'),
              16
            )
            chainId = requested
            emit('chainChanged', '0x' + chainId.toString(16))
            return null
          }
          if (method === 'wallet_addEthereumChain') return null
          if (method === 'velostra_setChainId') {
            chainId = Number.parseInt(String(params[0] ?? '0x0'), 16)
            emit('chainChanged', '0x' + chainId.toString(16))
            return null
          }
          if (method === 'personal_sign' || method === 'eth_sign') {
            return '0x' + 'ab'.repeat(65)
          }
          if (method === 'eth_sendTransaction') {
            const hash = hashes[Math.min(hashIndex, hashes.length - 1)]
            hashIndex += 1
            return hash
          }
          if (method === 'eth_estimateGas') return '0x186a0'
          if (method === 'eth_call') return '0x'
          if (method === 'eth_getTransactionCount') return '0x0'
          if (method === 'eth_gasPrice') return '0x3b9aca00'
          if (method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00'
          if (method === 'eth_getBlockByNumber') {
            return {
              number: '0x64',
              hash: '0x' + '99'.repeat(32),
              parentHash: '0x' + '88'.repeat(32),
              timestamp: '0x1',
              gasLimit: '0x1c9c380',
              gasUsed: '0x0',
              baseFeePerGas: '0x3b9aca00',
              transactions: [],
            }
          }
          throw new Error('Unsupported injected-wallet RPC method: ' + method)
        },
      }

      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: provider,
      })
      window.dispatchEvent(new Event('eip6963:announceProvider'))
    },
    {
      account: TEST_WALLET,
      initialChainId: options.initialChainId ?? 4663,
      rejectFirstConnection: options.rejectFirstConnection ?? false,
      hashes: TX_HASHES,
    }
  )
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': 'http://127.0.0.1:4173',
      'access-control-allow-credentials': 'true',
    },
    body: JSON.stringify(body),
  })
}

export async function installProductApi(page: Page, state: ProductState): Promise<void> {
  await page.route('https://rpc.mainnet.chain.robinhood.com/**', async (route) => {
    const request = route.request().postDataJSON() as { id?: number; method?: string } | undefined
    const method = request?.method
    let result: unknown = null
    if (method === 'eth_chainId') result = '0x1237'
    else if (method === 'eth_blockNumber') result = '0x65'
    else if (method === 'eth_getTransactionReceipt') {
      result = {
        transactionHash: TX_HASHES[0],
        transactionIndex: '0x0',
        blockHash: '0x' + '99'.repeat(32),
        blockNumber: '0x64',
        from: TEST_WALLET,
        to: '0x1111111111111111111111111111111111111111',
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        effectiveGasPrice: '0x3b9aca00',
        contractAddress: null,
        logs: [],
        logsBloom: '0x' + '00'.repeat(256),
        status: '0x1',
        type: '0x2',
      }
    }
    return json(route, { jsonrpc: '2.0', id: request?.id ?? 1, result })
  })

  const apiHandler = async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': 'http://127.0.0.1:4173',
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
        },
      })
    }
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path === '/api/auth/me') {
      return json(route, {
        auth: state.authenticated
          ? {
              id: 'user-e2e',
              wallet_address: TEST_WALLET,
              display_name: 'Phase 2 Operator',
              is_builder: true,
              is_admin: true,
            }
          : null,
      })
    }
    if (path === '/api/auth/nonce') {
      return json(route, { nonce: 'phase2-nonce', message: 'Verify Velostra Phase 2 browser session' })
    }
    if (path === '/api/auth/login') {
      state.authenticated = true
      return json(route, {
        token: 'browser-session',
        user: {
          id: 'user-e2e',
          wallet_address: TEST_WALLET,
          display_name: 'Phase 2 Operator',
          is_builder: true,
          is_admin: true,
        },
      })
    }
    if (path === '/api/auth/logout') {
      state.authenticated = false
      return json(route, { ok: true })
    }
    if (path === '/api/agents' && route.request().method() === 'GET') {
      return json(route, {
        agents: [
          {
            id: 'agent-1',
            name: 'Flowbook Trader',
            slug: 'flowbook-trader',
            description: 'Correlated market execution with durable settlement evidence.',
            category: 'TRADING',
            price_per_call: 0.3,
            price_tier: 'STANDARD',
            total_calls: 128,
            avg_rating: 4.9,
            builder: { display_name: 'Velostra Labs', verified: true },
          },
        ],
      })
    }
    if (path === '/api/agents/flowbook-trader' && route.request().method() === 'GET') {
      return json(route, {
        agent: {
          id: 'agent-1',
          name: 'Flowbook Trader',
          description: 'Correlated market execution.',
          long_description: 'Analyze the requested market and return a receipt-correlated execution result.',
          price_per_call: 0.3,
          price_tier: 'STANDARD',
          total_calls: 128,
          avg_rating: 4.9,
          builder: { display_name: 'Velostra Labs', verified: true },
          reviews: [{ id: 'review-1', rating: 5, comment: 'Clear evidence and fast settlement.' }],
        },
      })
    }
    if (
      path === '/api/agents/flowbook-trader/run' ||
      path === '/api/v1/agents/flowbook-trader/run'
    ) {
      const versioned = path.startsWith('/api/v1/')
      state.runAttempts += 1
      if (state.runAttempts === 1) {
        return json(route, { error: 'Settlement status is ambiguous; reconciliation is tracking it.' }, 503)
      }
      state.balance -= 0.3
      state.availableEarnings += 0.27
      const result = {
        call_id: 'call-browser-fixture',
        output: { verdict: 'execution verified', receipt: 'VL-E2E' },
        settlement_tx_hash: TX_HASHES[2],
      }
      return json(route, versioned ? { data: result } : result)
    }
    if (path === '/api/dashboard' && route.request().method() === 'GET') {
      return json(route, {
        balance_usd: state.balance,
        free_tier: { used: 10, remaining: 0, limit: 10, hasRemaining: false },
        recent_calls: [],
      })
    }
    if (path === '/api/dashboard/topup') {
      const body = route.request().postDataJSON() as { amount_usd: number }
      state.balance += Number(body.amount_usd)
      return json(route, { balance_usd: state.balance })
    }
    if (path === '/api/builder/me' && route.request().method() === 'GET') {
      return json(route, {
        builder: {
          id: 'builder-e2e',
          display_name: 'Velostra Labs',
          agents: [
            {
              id: 'agent-1',
              name: 'Flowbook Trader',
              slug: 'flowbook-trader',
              status: 'APPROVED',
              price_per_call: 0.3,
              total_calls: 128,
            },
          ],
          earnings: {
            total_earned: state.availableEarnings + state.totalClaimed,
            available: state.availableEarnings,
            total_claimed: state.totalClaimed,
          },
        },
      })
    }
    if (path === '/api/builder/claim') {
      const body = route.request().postDataJSON() as { amount: number }
      state.availableEarnings -= Number(body.amount)
      state.totalClaimed += Number(body.amount)
      return json(route, { ok: true })
    }
    if (path === '/api/admin/stats') {
      return json(route, { users: 14, builders: 3, agents: 7, calls: 128, revenue: 9.42 })
    }
    if (path === '/api/admin/agents') return json(route, { agents: [] })

    return json(route, { error: 'Unhandled browser fixture route: ' + path }, 404)
  }
  await page.route('http://api.velostra.test/**', apiHandler)
  await page.route('http://localhost:8787/**', apiHandler)
}

export async function disableNondeterministicMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0.001s !important;
        transition-delay: 0s !important;
        transition-duration: 0.001s !important;
        caret-color: transparent !important;
      }
      canvas { visibility: hidden !important; }
    `,
  })
}
