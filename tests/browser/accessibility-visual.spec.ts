import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  createProductState,
  disableNondeterministicMotion,
  installInjectedWallet,
  installProductApi,
} from './fixtures'

const criticalRoutes = [
  '/',
  '/marketplace',
  '/agents/flowbook-trader',
  '/dashboard',
  '/builder',
  '/admin',
  '/docs',
  '/testnet',
  '/route-that-does-not-exist',
]

test.beforeEach(async ({ page }) => {
  await installInjectedWallet(page)
  await installProductApi(page, createProductState())
})

for (const route of criticalRoutes) {
  test(`critical route ${route} has no serious accessibility violation`, async ({ page }) => {
    await page.goto(route)
    await expect(page.locator('#main-content')).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious'
    )
    const summary = blocking.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({ target: node.target, detail: node.any[0]?.data })),
    }))
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([])
  })
}

test('wallet dialog is keyboard-contained and restores focus on Escape', async ({ page }) => {
  await page.goto('/dashboard')
  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' })
  const trigger = primaryNavigation.getByRole('button', { name: 'Connect Wallet' })
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Choose a wallet' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog.getByRole('button', { name: /MetaMask/i })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('critical desktop layouts have no viewport overflow or known text collisions', async ({ page }) => {
  for (const route of ['/', '/marketplace', '/economics']) {
    await page.goto(route)
    await expect(page.locator('#main-content')).toBeVisible()
    const diagnostics = await page.evaluate(() => {
      const documentOverflow = document.documentElement.scrollWidth - window.innerWidth
      const clippedControls = Array.from(
        document.querySelectorAll<HTMLElement>('button, input, select, textarea, label')
      )
        .filter((element) => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            element.scrollWidth > element.clientWidth + 2 &&
            style.textOverflow !== 'ellipsis'
          )
        })
        .slice(0, 10)
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 80),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))

      const filters = Array.from(
        document.querySelectorAll<HTMLElement>('.marketplace-filters .field-row')
      ).map((field) => {
        const label = field.querySelector('label')?.getBoundingClientRect()
        const control = field.querySelector('input, select')?.getBoundingClientRect()
        return label && control ? label.bottom <= control.top + 1 : true
      })

      const ninety = document.querySelector<HTMLElement>('.econ__big-number strong')?.getBoundingClientRect()
      const percent = document.querySelector<HTMLElement>('.econ__big-number sup')?.getBoundingClientRect()
      return {
        documentOverflow,
        clippedControls,
        filterLabelsClear: filters.every(Boolean),
        economicsMarkClear: ninety && percent ? ninety.right <= percent.left + 1 : true,
      }
    })
    expect(diagnostics, `${route}: ${JSON.stringify(diagnostics)}`).toEqual({
      documentOverflow: 0,
      clippedControls: [],
      filterLabelsClear: true,
      economicsMarkClear: true,
    })
  }
})

test('home and marketplace retain approved desktop visual baselines', async ({ page }) => {
  const platformSuffix = process.platform === 'linux' ? '-linux' : ''
  await page.goto('/')
  await disableNondeterministicMotion(page)
  await expect(page).toHaveScreenshot('home-desktop' + platformSuffix + '.png', { fullPage: false })

  await page.goto('/marketplace')
  await expect(page.getByRole('heading', { name: 'Flowbook Trader' })).toBeVisible()
  await disableNondeterministicMotion(page)
  await expect(page).toHaveScreenshot('marketplace-desktop' + platformSuffix + '.png', { fullPage: false })
})

test('canonical routes survive direct refresh and browser history', async ({ page }) => {
  await page.goto('/marketplace?q=flowbook&category=TRADING&sort=popular')
  await expect(page.getByLabel('Search agents')).toHaveValue('flowbook')
  await page.getByRole('link', { name: /Flowbook Trader/i }).click()
  await expect(page).toHaveURL(/\/agents\/flowbook-trader$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/marketplace\?q=flowbook&category=TRADING&sort=popular$/)
  await page.reload()
  await expect(page.getByLabel('Search agents')).toHaveValue('flowbook')
})

test('rapid marketplace filter changes preserve the complete URL state', async ({ page }) => {
  await page.goto('/marketplace')

  await page.getByLabel('Search agents').fill('flow')
  await page.getByLabel('Category').selectOption('TRADING')
  await page.getByLabel('Sort by').selectOption('price')

  await expect.poll(() => {
    const params = new URL(page.url()).searchParams
    return {
      category: params.get('category'),
      sort: params.get('sort'),
      q: params.get('q'),
    }
  }).toEqual({ category: 'TRADING', sort: 'price', q: 'flow' })
  await expect(page.getByLabel('Search agents')).toHaveValue('flow')
  await expect(page.getByLabel('Category')).toHaveValue('TRADING')
  await expect(page.getByLabel('Sort by')).toHaveValue('price')

  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(page).toHaveURL('/marketplace')
})
