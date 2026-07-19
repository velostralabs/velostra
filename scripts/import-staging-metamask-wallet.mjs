import { chromium } from '@playwright/test'
import path from 'node:path'

const extensionPath = process.env.METAMASK_EXTENSION_PATH
const profilePath = process.env.METAMASK_USER_DATA_DIR
const password = process.env.METAMASK_VAULT_PASSWORD
const privateKey = process.env.EVIDENCE_WALLET_PRIVATE_KEY

if (!extensionPath || !profilePath || !password || !privateKey) {
  throw new Error('Encrypted staging wallet inputs must be supplied through the environment')
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('Staging wallet material is malformed')
}

const normalizedProfile = path.resolve(profilePath).toLowerCase()
const requiredRoot = path.resolve('artifacts/staging/evidence/private').toLowerCase()
if (!normalizedProfile.startsWith(requiredRoot + path.sep)) {
  throw new Error('MetaMask import is restricted to the ignored staging evidence directory')
}

const context = await chromium.launchPersistentContext(path.resolve(profilePath), {
  headless: false,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${path.resolve(extensionPath)}`,
    `--load-extension=${path.resolve(extensionPath)}`,
  ],
})

async function firstVisible(page, locators) {
  for (const locator of locators) {
    if (await locator.isVisible().catch(() => false)) return locator
  }
  return null
}

try {
  const host = await context.newPage()
  await host.goto('about:blank')
  await host.keyboard.press('Alt+Shift+M')

  const deadline = Date.now() + 20_000
  let walletPage
  while (Date.now() < deadline) {
    walletPage = context.pages().find((page) => page.url().startsWith('chrome-extension://'))
    if (walletPage) break
    await host.waitForTimeout(200)
  }
  if (!walletPage) throw new Error('MetaMask extension page did not open')
  await walletPage.bringToFront()

  let unlockInput = null
  let accountSelector = null
  const readyDeadline = Date.now() + 20_000
  while (Date.now() < readyDeadline && !unlockInput && !accountSelector) {
    unlockInput = await firstVisible(walletPage, [
      walletPage.getByTestId('unlock-password'),
      walletPage.locator('#password'),
    ])
    accountSelector = await firstVisible(walletPage, [
      walletPage.getByTestId('account-menu-icon'),
      walletPage.getByRole('button', { name: /Account 1/i }),
      walletPage.getByText('Account 1', { exact: true }),
    ])
    if (!unlockInput && !accountSelector) await walletPage.waitForTimeout(250)
  }
  if (unlockInput) {
    await unlockInput.fill(password)
    await walletPage.getByRole('button', { name: 'Unlock', exact: true }).click()
    await walletPage.waitForTimeout(2_000)
  }

  accountSelector = null
  const accountDeadline = Date.now() + 20_000
  while (Date.now() < accountDeadline && !accountSelector) {
    accountSelector = await firstVisible(walletPage, [
      walletPage.getByRole('button', { name: /Account 1/i }),
      walletPage.getByText('Account 1', { exact: true }),
    ])
    if (!accountSelector) await walletPage.waitForTimeout(250)
  }
  if (!accountSelector) throw new Error('MetaMask account selector was unavailable')
  await accountSelector.click({ force: true })
  await walletPage.waitForTimeout(1_000)

  const addWallet = await firstVisible(walletPage, [
    walletPage.getByTestId('account-list-add-wallet-button'),
    walletPage.getByRole('button', { name: /Add account or hardware wallet/i }),
    walletPage.getByText(/Add account or hardware wallet/i),
  ])
  if (!addWallet) throw new Error('MetaMask add-wallet action was unavailable')
  await addWallet.click()
  await walletPage.waitForTimeout(1_000)

  const importAccount = await firstVisible(walletPage, [
    walletPage.getByRole('button', { name: /Import account/i }),
    walletPage.getByTestId('choose-wallet-type-import-account'),
    walletPage.getByText('Import account', { exact: true }),
  ])
  if (!importAccount) throw new Error('MetaMask import-account action was unavailable')
  await importAccount.click()

  const keyInput = await firstVisible(walletPage, [
    walletPage.locator('#private-key-box'),
    walletPage.getByLabel(/private key/i),
  ])
  if (!keyInput) throw new Error('MetaMask private-key input was unavailable')
  await keyInput.fill(privateKey.slice(2))

  const confirm = await firstVisible(walletPage, [
    walletPage.getByTestId('import-account-confirm-button'),
    walletPage.getByRole('button', { name: 'Import', exact: true }),
  ])
  if (!confirm) throw new Error('MetaMask import confirmation was unavailable')
  await confirm.click()
  await walletPage.waitForTimeout(3_000)

  if (await keyInput.isVisible().catch(() => false)) {
    throw new Error('MetaMask did not leave the private-key import form')
  }
  console.info('PASS encrypted staging wallet imported into the dedicated MetaMask profile')
} catch (error) {
  const walletPage = context.pages().find((page) => page.url().startsWith('chrome-extension://'))
  await walletPage
    ?.screenshot({ path: path.resolve('artifacts/staging/evidence/private/metamask-import-failure.png') })
    .catch(() => undefined)
  throw error
} finally {
  await context.close()
}
