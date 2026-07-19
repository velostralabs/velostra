import { chromium } from '@playwright/test'
import { privateKeyToAccount } from 'viem/accounts'
import path from 'node:path'

const APPROVAL = 'isolated-staging-faucet-approved'
const FAUCET_URL = 'https://faucet.testnet.chain.robinhood.com/'

if (process.env.VELOSTRA_FAUCET_APPROVAL !== APPROVAL) {
  throw new Error('Explicit isolated-staging faucet approval is required')
}

const extensionPath = process.env.METAMASK_EXTENSION_PATH
const profilePath = process.env.METAMASK_USER_DATA_DIR
const vaultPassword = process.env.METAMASK_VAULT_PASSWORD
const privateKey = process.env.EVIDENCE_WALLET_PRIVATE_KEY

if (!extensionPath || !profilePath || !vaultPassword || !privateKey) {
  throw new Error('The isolated MetaMask profile and encrypted wallet material are required')
}

const expectedAddress = privateKeyToAccount(privateKey).address.toLowerCase()
const context = await chromium.launchPersistentContext(path.resolve(profilePath), {
  headless: false,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${path.resolve(extensionPath)}`,
    `--load-extension=${path.resolve(extensionPath)}`,
  ],
})

async function clickMetaMaskAction(names, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  const fallbackTestIds = ['confirm-btn', 'confirm-footer-button', 'page-container-footer-next']
  while (Date.now() < deadline) {
    const pages = context.pages().filter((page) => page.url().startsWith('chrome-extension://')).reverse()
    for (const page of pages) {
      await Promise.race([
        page.bringToFront().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 750)),
      ])
      for (const name of names) {
        const button = page.getByRole('button', { name, exact: true })
        if (await button.isVisible().catch(() => false)) {
          await button.click()
          return true
        }
      }
      for (const testId of fallbackTestIds) {
        const button = page.getByTestId(testId)
        if (await button.isVisible().catch(() => false)) {
          await button.click()
          return true
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

async function unlockMetaMask(host) {
  const deadline = Date.now() + 20_000
  let shortcutOpened = false
  while (Date.now() < deadline) {
    const pages = context.pages().filter((page) => page.url().startsWith('chrome-extension://'))
    for (const page of pages) {
      const input = page.getByTestId('unlock-password').or(page.locator('#password')).first()
      if (!(await input.isVisible().catch(() => false))) continue
      await input.fill(vaultPassword)
      if (!(await clickMetaMaskAction(['Unlock']))) throw new Error('MetaMask unlock action was unavailable')
      await page.waitForTimeout(750)
      await page.close().catch(() => undefined)
      await host.bringToFront()
      return
    }
    if (!shortcutOpened) {
      await host.bringToFront()
      await host.keyboard.press('Alt+Shift+M')
      shortcutOpened = true
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('MetaMask unlock state did not settle')
}

try {
  const page = await context.newPage()
  await page.goto(FAUCET_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await unlockMetaMask(page)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 })

  const connectButton = page.getByRole('button', { name: /connect wallet/i })
  if (await connectButton.isVisible().catch(() => false)) {
    await connectButton.click()
    const metaMaskOption = page.getByRole('button', { name: /metamask/i }).first()
    if (await metaMaskOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await metaMaskOption.click()
    }
    if (!(await clickMetaMaskAction(['Next', 'Connect'], 30_000))) {
      throw new Error('The faucet did not produce a MetaMask connection request')
    }
    await clickMetaMaskAction(['Connect'], 5_000)
  }

  const addressInput = page.locator('input').first()
  await addressInput.waitFor({ state: 'visible', timeout: 30_000 })
  const currentValue = (await addressInput.inputValue()).toLowerCase()
  if (currentValue && currentValue !== expectedAddress) {
    throw new Error('The faucet connected a different wallet than the isolated evidence wallet')
  }
  if (!currentValue) await addressInput.fill(expectedAddress)

  const sendButton = page.getByRole('button', { name: /send tokens/i })
  await sendButton.waitFor({ state: 'visible', timeout: 15_000 })
  if (await sendButton.isDisabled()) {
    throw new Error('The official faucet is not currently eligible for this isolated wallet')
  }
  await sendButton.click()
  await page.getByText(/tokens (distributed successfully|sent)/i).first().waitFor({
    state: 'visible',
    timeout: 60_000,
  })
  console.info('Official testnet faucet delivery verified for the isolated staging wallet.')
} finally {
  await context.close()
}
