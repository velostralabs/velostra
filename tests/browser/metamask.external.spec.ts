import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import path from 'node:path'

const approved = process.env.PHASE2_WALLET_E2E_APPROVED === 'isolated-staging-only'
const paidCanaryApproved = process.env.PHASE2_WALLET_PAID_WRITES_APPROVED === 'isolated-staging-canary'
const extensionPath = process.env.METAMASK_EXTENSION_PATH
const profilePath = process.env.METAMASK_USER_DATA_DIR
const baseURL = process.env.PLAYWRIGHT_BASE_URL

test.skip(
  !approved || !paidCanaryApproved || !extensionPath || !profilePath || !baseURL,
  'Real MetaMask evidence requires isolated staging approval, an explicit paid-canary sentinel, an unpacked extension, and a dedicated test profile.'
)

async function extensionPopup(context: BrowserContext): Promise<Page> {
  const existing = context.pages().find((page) => page.url().startsWith('chrome-extension://'))
  if (existing) return existing
  return context.waitForEvent('page', { timeout: 15_000 })
}

async function clickFirstVisible(page: Page, names: string[]): Promise<void> {
  for (const name of names) {
    const button = page.getByRole('button', { name, exact: true })
    if (await button.isVisible().catch(() => false)) {
      await button.click()
      return
    }
  }
  throw new Error('Expected one MetaMask action: ' + names.join(', '))
}

async function approveMetaMask(context: BrowserContext, names: string[]): Promise<void> {
  const popup = await extensionPopup(context)
  await popup.bringToFront()
  await clickFirstVisible(popup, names)
}

test('real MetaMask isolated-staging money journey', async () => {
  const staging = new URL(baseURL!)
  if (staging.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(staging.hostname)) {
    throw new Error('Real-wallet automation requires HTTPS or localhost')
  }
  const topup = Number(process.env.PHASE2_WALLET_TOPUP_AMOUNT ?? '2.00')
  const claim = Number(process.env.PHASE2_WALLET_CLAIM_AMOUNT ?? '1.00')
  if (!(topup > 1.2 && topup <= 2) || claim !== 1) {
    throw new Error('Real-wallet values must cover the 1.20 synthetic call, use the 1-token claim minimum, and stay within the low-value cap')
  }

  const context = await chromium.launchPersistentContext(path.resolve(profilePath!), {
    headless: false,
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${path.resolve(extensionPath!)}`,
      `--load-extension=${path.resolve(extensionPath!)}`,
    ],
  })
  try {
    const page = await context.newPage()
    await page.goto(new URL('/dashboard', staging).toString())
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    await page.getByRole('button', { name: /MetaMask/i }).click()
    await approveMetaMask(context, ['Cancel', 'Reject'])
    await expect(page.getByRole('alert')).toBeVisible()

    await page.getByRole('button', { name: /MetaMask/i }).click()
    await approveMetaMask(context, ['Connect', 'Next'])
    const switchButton = page.getByRole('button', { name: 'Switch wallet to Robinhood Chain' })
    if (await switchButton.isVisible().catch(() => false)) {
      await switchButton.click()
      await approveMetaMask(context, ['Switch network', 'Approve'])
    }

    await page.getByRole('button', { name: 'Sign in securely' }).click()
    await approveMetaMask(context, ['Sign', 'Confirm'])
    await expect(page.getByText('CREDIT BALANCE')).toBeVisible()

    const freeTierRemaining = await page.evaluate(async () => {
      const response = await fetch('/api/dashboard')
      if (!response.ok) throw new Error('Dashboard preflight failed')
      const body = (await response.json()) as { free_tier?: { remaining?: number } }
      return body.free_tier?.remaining
    })
    expect(freeTierRemaining).toBe(0)

    await page.getByLabel('Amount (USDG)').fill(String(topup))
    await page.getByRole('button', { name: 'Deposit onchain' }).click()
    await approveMetaMask(context, ['Confirm'])
    await approveMetaMask(context, ['Confirm'])
    await expect(page.getByRole('button', { name: 'Deposit onchain' })).toBeEnabled()

    const slug = process.env.PHASE2_WALLET_AGENT_SLUG
    if (!slug) throw new Error('PHASE2_WALLET_AGENT_SLUG is required')
    await page.goto(new URL('/agents/' + slug, staging).toString())
    await page.getByLabel('Input').fill('Phase 2 isolated-staging wallet verification')
    await page.getByRole('button', { name: /Run ·/ }).click()
    await expect(page.locator('pre.output-block')).toBeVisible()

    await page.goto(new URL('/builder', staging).toString())
    await page.getByLabel('Amount (USDG)').fill(String(claim))
    await page.getByRole('button', { name: 'Claim to wallet' }).click()
    await approveMetaMask(context, ['Confirm'])
    await expect(page.getByRole('button', { name: 'Claim to wallet' })).toBeEnabled()

    await context.clearCookies()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Verify your wallet' })).toBeVisible()
  } finally {
    await context.close()
  }
})
