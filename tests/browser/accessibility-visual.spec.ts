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
      const atlasCopy = document.querySelector<HTMLElement>('.atlas__field-copy p')?.getBoundingClientRect()
      const atlasRoute = document.querySelector<HTMLElement>('.atlas__route')?.getBoundingClientRect()
      return {
        documentOverflow,
        clippedControls,
        filterLabelsClear: filters.every(Boolean),
        economicsMarkClear: ninety && percent ? ninety.right <= percent.left + 1 : true,
        atlasCopyClear: atlasCopy && atlasRoute ? atlasCopy.bottom <= atlasRoute.top : true,
      }
    })
    expect(diagnostics, `${route}: ${JSON.stringify(diagnostics)}`).toEqual({
      documentOverflow: 0,
      clippedControls: [],
      filterLabelsClear: true,
      economicsMarkClear: true,
      atlasCopyClear: true,
    })
  }
})

test('homepage chapter rail remains readable and scrolls the current route', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')

  const rail = page.getByRole('navigation', { name: 'Homepage chapter index' })
  await expect(rail).toBeVisible()

  const fontSizes = await rail.locator('.home-index__title, .home-index__item span, .home-index__item b')
    .evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)))
  expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(9)

  const persistentLinkHeights = await page.locator('.nav__links a, .footer__col a')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  expect(Math.min(...persistentLinkHeights)).toBeGreaterThanOrEqual(24)

  await page.evaluate(() => window.scrollTo({ top: 2500, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(2000)
  await rail.getByRole('button', { name: /00\s*Intro/i }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(20)
})

test('homepage execution and settlement controls update their correlated evidence', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const executionTabs = page.getByRole('tab')
  const executionStates = [
    ['Publish specialized intelligence', '< 5 min'],
    ['Every request becomes a receipt', '1 : 1'],
    ['Value moves by deterministic rule', '90 / 10'],
    ['Claim without platform friction', '24 / 7'],
  ]

  for (const [index, state] of executionStates.entries()) {
    await executionTabs.nth(index).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(650)
    await expect(executionTabs.nth(index)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: state[0], exact: true })).toBeVisible()
    await expect(page.locator('.flow-console__body')).toHaveCount(1)
    await expect(page.locator('.flow-console__footer strong')).toHaveText(state[1])
  }

  const revenueRoute = page.locator('.proof__trace').getByRole('button', { name: /Revenue routed/i })
  await revenueRoute.focus()
  await page.keyboard.press('Enter')
  await expect(revenueRoute).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.proof__readouts strong')).toHaveText(['$4.00', '+$3.60', '+$0.40'])
})

test('public internal links stay on canonical clean routes', async ({ page }) => {
  const allowedRoute = /^\/(?:$|index$|system$|proof$|economics$|marketplace(?:\?.*)?$|agents\/[^/?#]+$|dashboard$|builder$|admin$|docs$|testnet$)/

  for (const route of criticalRoutes) {
    await page.goto(route)
    const internalLinks = await page.locator('a[href^="/"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href')).filter((href): href is string => Boolean(href))
    )

    for (const href of internalLinks) {
      expect(href, route + ' exposes an invalid internal destination').not.toContain('#')
      expect(href, route + ' exposes an unknown internal destination').toMatch(allowedRoute)
    }
  }
})
test('hero WebGL surface renders above CSS resolution', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('.scene3d canvas')
  await expect(canvas).toBeVisible()
  const renderScale = await canvas.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return Math.min(element.width / rect.width, element.height / rect.height)
  })
  expect(renderScale).toBeGreaterThanOrEqual(1.35)
  expect(renderScale).toBeLessThanOrEqual(2.01)
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
