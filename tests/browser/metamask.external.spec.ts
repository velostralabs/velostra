import { chromium, expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import path from 'node:path'

const approved = process.env.PHASE2_WALLET_E2E_APPROVED === 'isolated-staging-only'
const preflightOnly = process.env.PHASE2_WALLET_PREFLIGHT === 'isolated-staging-preflight'
const paidCanaryApproved = process.env.PHASE2_WALLET_PAID_WRITES_APPROVED === 'isolated-staging-canary'
const extensionPath = process.env.METAMASK_EXTENSION_PATH
const profilePath = process.env.METAMASK_USER_DATA_DIR
const baseURL = process.env.PLAYWRIGHT_BASE_URL
const apiURL = process.env.PHASE2_WALLET_API_URL

test.skip(
  !approved || (!paidCanaryApproved && !preflightOnly) || !extensionPath || !profilePath || !baseURL || !apiURL,
  'Real MetaMask evidence requires isolated staging approval, explicit web/API origins, a preflight or paid-canary sentinel, an unpacked extension, and a dedicated test profile.'
)
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

async function clickMetaMaskAction(
  context: BrowserContext,
  names: string[],
  timeoutMs = 15_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const fallbackTestIds = ['confirm-btn', 'confirm-footer-button', 'page-container-footer-next']
  const password = process.env.METAMASK_VAULT_PASSWORD

  while (Date.now() < deadline) {
    const pages = context.pages().filter((page) => page.url().startsWith('chrome-extension://')).reverse()
    for (const candidate of pages) {
      await Promise.race([
        candidate.bringToFront().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 750)),
      ])

      if (!names.includes('Unlock')) {
        const unlockInput = candidate.getByTestId('unlock-password')
        const fallbackUnlockInput = candidate.locator('#password')
        const visibleInput = (await unlockInput.isVisible().catch(() => false))
          ? unlockInput
          : (await fallbackUnlockInput.isVisible().catch(() => false))
            ? fallbackUnlockInput
            : null
        if (visibleInput) {
          if (!password) throw new Error('METAMASK_VAULT_PASSWORD is required for the locked test profile')
          await visibleInput.fill(password)
          const unlockButton = candidate.getByRole('button', { name: 'Unlock', exact: true })
          if (!(await unlockButton.isVisible().catch(() => false))) {
            throw new Error('MetaMask unlock action was not available')
          }
          await unlockButton.click()
          await visibleInput.waitFor({ state: 'hidden', timeout: 10_000 })
          continue
        }
      }

      for (const name of names) {
        const button = candidate.getByRole('button', { name, exact: true })
        if (await button.isVisible().catch(() => false)) {
          console.info('MetaMask action completed:', name)
          await button.click()
          return true
        }
      }

      for (const testId of fallbackTestIds) {
        const button = candidate.getByTestId(testId)
        if (await button.isVisible().catch(() => false)) {
          await button.click()
          console.info('MetaMask action completed via test id:', testId)
          return true
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

async function requireMetaMaskAction(context: BrowserContext, names: string[]): Promise<void> {
  if (!(await clickMetaMaskAction(context, names))) {
    throw new Error('Expected one MetaMask action: ' + names.join(', '))
  }
}

async function triggerWalletRequest(control: Locator): Promise<void> {
  await control.page().bringToFront()
  const clickAttempt = control
    .click({ force: true, noWaitAfter: true, timeout: 5_000 })
    .catch(() => undefined)
  await Promise.race([clickAttempt, new Promise((resolve) => setTimeout(resolve, 750))])
}

async function completeMetaMaskConnection(
  context: BrowserContext,
  page: Page,
  connectButton: Locator
): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (!(await connectButton.isVisible().catch(() => false))) return
    await clickMetaMaskAction(context, ['Next', 'Connect'], 3_000)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  const statuses = await page
    .locator('.wallet-picker__error, .wallet-option__status')
    .allTextContents()
  const redactedStatuses = statuses.map((value) => value.replace(/0x[0-9a-fA-F]{40}/g, '[redacted]'))
  console.info('Wallet UI state:', redactedStatuses.join(' | ') || 'no status')
  console.info('MetaMask extension page count:', context.pages().filter((candidate) => candidate.url().startsWith('chrome-extension://')).length)
  throw new Error('MetaMask connection did not settle on the staging origin')
}

async function unlockMetaMask(context: BrowserContext, host: Page): Promise<void> {
  const password = process.env.METAMASK_VAULT_PASSWORD
  const deadline = Date.now() + 15_000
  let shortcutOpened = false
  const startedAt = Date.now()

  while (Date.now() < deadline) {
    const extensionPages = context.pages().filter((candidate) => candidate.url().startsWith('chrome-extension://'))
    for (const candidate of extensionPages) {
      const passwordInputs = [candidate.getByTestId('unlock-password'), candidate.locator('#password')]
      for (const input of passwordInputs) {
        if (!(await input.isVisible().catch(() => false))) continue
        if (!password) throw new Error('METAMASK_VAULT_PASSWORD is required for the locked test profile')
        await input.fill(password)
        const unlockButton = candidate.getByRole('button', { name: 'Unlock', exact: true })
        if (!(await unlockButton.isVisible().catch(() => false))) {
          throw new Error('MetaMask unlock action was not available')
        }
        await unlockButton.click()
        await input.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined)
        if (await input.isVisible().catch(() => false)) {
          throw new Error('MetaMask remained locked after the unlock action')
        }
        await candidate.close().catch(() => undefined)
        await host.bringToFront()
        return
      }
    }

    if (!shortcutOpened) {
      await host.bringToFront()
      await host.keyboard.press('Alt+Shift+M')
      shortcutOpened = true
    } else if (extensionPages.length > 0 && Date.now() - startedAt >= 2_000) {
      const extensionRoutes = extensionPages.map(
        (candidate) => new URL(candidate.url()).hash.split('?')[0]
      )
      const knownUnlockedPage =
        extensionRoutes.length > 0 &&
        extensionRoutes.every((route) => route && !route.startsWith('#/unlock'))
      if (knownUnlockedPage) {
        await Promise.all(extensionPages.map((candidate) => candidate.close().catch(() => undefined)))
        await host.bringToFront()
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('MetaMask unlock state did not settle')
}

test('real MetaMask isolated-staging money journey', async () => {
  const staging = new URL(baseURL!)
  const api = new URL(apiURL!)
  test.setTimeout(180_000)
  const unsafeWeb = staging.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(staging.hostname)
  const unsafeApi = api.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(api.hostname)
  if (unsafeWeb || unsafeApi) {
    throw new Error('Real-wallet automation requires HTTPS or localhost for both web and API')
  }
  const expectedAddress = process.env.PHASE2_WALLET_EXPECTED_ADDRESS?.toLowerCase()
  if (!expectedAddress || !/^0x[0-9a-f]{40}$/.test(expectedAddress)) {
    throw new Error('PHASE2_WALLET_EXPECTED_ADDRESS must identify the isolated test wallet')
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
    const authNetworkEvents: string[] = []
    page.on('response', (response) => {
      const requestUrl = new URL(response.url())
      if (requestUrl.pathname.startsWith('/api/auth/')) {
        authNetworkEvents.push(`${response.request().method()} ${requestUrl.pathname} ${response.status()}`)
      }
    })
    page.on('requestfailed', (request) => {
      const requestUrl = new URL(request.url())
      if (requestUrl.pathname.startsWith('/api/auth/')) {
        authNetworkEvents.push(
          `${request.method()} ${requestUrl.pathname} failed: ${request.failure()?.errorText ?? 'unknown'}`
        )
      }
    })
    await page.goto(new URL('/dashboard', staging).toString())
    await unlockMetaMask(context, page)

    const connectButton = page.locator('.auth-gate').getByRole('button', { name: 'Connect Wallet' })
    if (await connectButton.isVisible().catch(() => false)) {
      await connectButton.click()
      await triggerWalletRequest(page.getByRole('button', { name: /MetaMask/i }))
      await completeMetaMaskConnection(context, page, connectButton)
    }

    const switchButton = page.getByRole('button', { name: 'Switch wallet to Robinhood Chain' })
    if (await switchButton.isVisible().catch(() => false)) {
      await triggerWalletRequest(switchButton)
      await requireMetaMaskAction(context, ['Switch network', 'Approve'])
    }

    const signInButton = page.getByRole('button', { name: 'Sign in securely' })
    await expect(signInButton).toBeVisible({ timeout: 30_000 })
    await triggerWalletRequest(signInButton)
    await page.waitForTimeout(750)
    if (context.pages().every((candidate) => !candidate.url().startsWith('chrome-extension://'))) {
      await page.keyboard.press('Alt+Shift+M')
    }
    if (!(await clickMetaMaskAction(context, ['Sign', 'Confirm'], 30_000))) {
      const authError = await page.locator('.form-message--error').textContent().catch(() => null)
      console.info('Auth network state:', authNetworkEvents.join(' | ') || 'no auth request')
      console.info('Auth UI state:', authError || 'no auth error')
      const extensionRoutes = context.pages()
        .filter((candidate) => candidate.url().startsWith('chrome-extension://'))
        .map((candidate) => new URL(candidate.url()).hash.split('?')[0] || '#')
      console.info(
        'MetaMask extension state:',
        extensionRoutes.length ? extensionRoutes.join(' | ') : 'no extension page'
      )
      throw new Error('Expected a MetaMask signature action')
    }
    await expect(page.getByText('CREDIT BALANCE')).toBeVisible({ timeout: 30_000 })
    const runtimeState = await page.evaluate(async (apiOrigin) => {
      const ethereum = (window as unknown as { ethereum?: { request(input: { method: string }): Promise<unknown> } }).ethereum
      if (!ethereum) throw new Error('Injected wallet provider is unavailable')
      const [chainId, accounts, response] = await Promise.all([
        ethereum.request({ method: 'eth_chainId' }),
        ethereum.request({ method: 'eth_accounts' }),
        fetch(new URL('/api/auth/me', apiOrigin).toString(), {
          credentials: 'include',
        }),
      ])
      if (!response.ok) throw new Error('Auth session probe failed')
      const body = (await response.json()) as { auth?: { wallet_address?: string } }
      return {
        chainId,
        account: Array.isArray(accounts) ? String(accounts[0] ?? '').toLowerCase() : '',
        authWallet: String(body.auth?.wallet_address ?? '').toLowerCase(),
      }
    }, api.toString())
    if (
      runtimeState.chainId !== '0xb626' ||
      runtimeState.account !== expectedAddress ||
      runtimeState.authWallet !== expectedAddress
    ) {
      throw new Error('Wallet account, chain, and authenticated session are not consistently bound')
    }

    const freeTierRemaining = await page.evaluate(async (apiOrigin) => {
      const response = await fetch(new URL('/api/dashboard', apiOrigin).toString(), {
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Dashboard preflight failed')
      const body = (await response.json()) as { free_tier?: { remaining?: number } }
      return body.free_tier?.remaining
    }, api.toString())
    expect(freeTierRemaining).toBe(0)
    if (preflightOnly) {
      await context.clearCookies()
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Verify your wallet' })).toBeVisible()
      return
    }

    await page.getByLabel('Amount (USDG)').fill(String(topup))
    await triggerWalletRequest(page.getByRole('button', { name: 'Deposit onchain' }))
    await requireMetaMaskAction(context, ['Confirm'])
    await requireMetaMaskAction(context, ['Confirm'])
    await expect(page.getByRole('button', { name: 'Deposit onchain' })).toBeEnabled()

    const slug = process.env.PHASE2_WALLET_AGENT_SLUG
    if (!slug) throw new Error('PHASE2_WALLET_AGENT_SLUG is required')
    await page.goto(new URL('/agents/' + slug, staging).toString())
    await page.getByLabel('Input').fill('Phase 2 isolated-staging wallet verification')
    await page.getByRole('button', { name: /Run ·/ }).click()
    await expect(page.locator('pre.output-block')).toBeVisible()

    await page.goto(new URL('/builder', staging).toString())
    await page.getByLabel('Amount (USDG)').fill(String(claim))
    await triggerWalletRequest(page.getByRole('button', { name: 'Claim to wallet' }))
    await requireMetaMaskAction(context, ['Confirm'])
    await expect(page.getByRole('button', { name: 'Claim to wallet' })).toBeEnabled()

    await context.clearCookies()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Verify your wallet' })).toBeVisible()
  } finally {
    await context.close()
  }
})
