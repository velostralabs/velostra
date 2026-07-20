import { expect, test } from '@playwright/test'
import {
  createProductState,
  installInjectedWallet,
  installProductApi,
  TEST_WALLET,
} from './fixtures'

test('injected wallet covers reject, reconnect, chain recovery, auth, money, and expiry states', async ({ page }) => {
  const state = createProductState()
  await installInjectedWallet(page, { rejectFirstConnection: true })
  await installProductApi(page, state)

  await page.goto('/dashboard')
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' })
  await primaryNavigation.getByRole('button', { name: 'Connect Wallet' }).click()
  const injected = page.getByRole('button', { name: /Other browser wallet/i })
  await injected.click()
  await expect(page.getByRole('alert')).toContainText('User rejected')

  await injected.click()
  await expect(page.getByRole('button', { name: new RegExp(TEST_WALLET.slice(0, 6), 'i') })).toBeVisible()

  await page.evaluate(async () => {
    const ethereum = (window as Window & {
      ethereum?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
    }).ethereum
    await ethereum?.request({ method: 'velostra_setChainId', params: ['0x1'] })
  })
  const switchNetwork = page.getByRole('button', { name: 'Switch wallet to Robinhood Chain' })
  await expect(switchNetwork).toBeVisible()
  await switchNetwork.click()

  await expect(page.getByRole('heading', { name: 'Verify your wallet' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign in securely' }).click()
  await expect(page.getByText('$12.50', { exact: true })).toBeVisible()

  await page.getByLabel('Amount (USDG)').fill('2')
  await page.getByRole('button', { name: 'Deposit onchain' }).click()
  await expect(page.getByText('$14.50', { exact: true })).toBeVisible()

  await page.goto('/agents/flowbook-trader')
  await page.getByLabel('Input').fill('Verify this paid execution')
  await page.getByRole('button', { name: 'Run · $0.30' }).click()
  await expect(page.getByText('Settlement status is ambiguous; reconciliation is tracking it.')).toBeVisible()
  await page.getByRole('button', { name: 'Run · $0.30' }).click()
  await expect(page.locator('pre.output-block')).toContainText('execution verified')

  await page.goto('/builder')
  await expect(page.getByText('$5.02', { exact: true })).toBeVisible()
  await page.getByLabel('Amount (USDG)').fill('0.50')
  await page.getByRole('button', { name: 'Claim to wallet' }).click()
  await expect(page.getByText('$4.52', { exact: true })).toBeVisible()

  state.authenticated = false
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Verify your wallet' })).toBeVisible()
})

test('public testnet onboarding mints synthetic USDG and links the official faucet', async ({ page }) => {
  const state = createProductState()
  await installInjectedWallet(page)
  await installProductApi(page, state)

  await page.goto('/testnet')
  await expect(page.getByRole('heading', { name: 'Use the whole system before mainnet.' })).toBeVisible()
  await expect(page.getByText('TESTNET LIVE', { exact: true })).toBeVisible()
  const faucet = page.getByRole('link', { name: /Open official faucet/i })
  await expect(faucet).toHaveAttribute('href', 'https://faucet.testnet.chain.robinhood.com/')

  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' })
  await primaryNavigation.getByRole('button', { name: 'Connect Wallet' }).click()
  await page.getByRole('button', { name: /Other browser wallet/i }).click()

  await page.getByRole('button', { name: 'Mint 25 test USDG' }).click()
  await expect(page.getByText('25 synthetic USDG minted. You can now deposit it in the execution console.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Inspect transaction/i })).toHaveAttribute(
    'href',
    /explorer\.testnet\.chain\.robinhood\.com\/tx\/0x/
  )
})

test('public testnet status reports paused writes without claiming the runtime is live', async ({ page }) => {
  const state = createProductState()
  state.publicTestnet = false
  state.paidWrites = 'disabled'
  await installProductApi(page, state)

  await page.goto('/testnet')
  await expect(page.getByText('PAID CALLS PAUSED', { exact: true })).toBeVisible()
  await expect(page.getByText('TESTNET LIVE', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
})
