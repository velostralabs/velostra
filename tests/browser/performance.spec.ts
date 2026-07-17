import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { createProductState, installInjectedWallet, installProductApi } from './fixtures'

const budgets = createRequire(import.meta.url)('../../config/performance-budgets.json') as {
  measurement: {
    ciInpJitterMs: number
  }
  routes: Record<string, {
    transferredJsBytes: number
    lcpMs: number
    inpMs: number
    cls: number
    webglContexts: number
  }>
}

interface BrowserVitals {
  lcpMs: number
  cls: number
  inpMs: number
  interactionCount: number
  transferredJsBytes: number
  webglContexts: number
}

// Recording and tracing add compositor work that would contaminate Event Timing.
test.use({ video: 'off', trace: 'off' })

test.beforeEach(async ({ page }) => {
  await installInjectedWallet(page)
  await installProductApi(page, createProductState())
  await page.addInitScript(() => {
    const measurements = { lcpMs: 0, cls: 0, inpMs: 0, interactionCount: 0, webglContexts: 0 }
    Object.defineProperty(window, '__velostraVitals', { value: measurements })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) measurements.lcpMs = Math.max(measurements.lcpMs, entry.startTime)
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
        if (!entry.hadRecentInput) measurements.cls += entry.value ?? 0
      }
    }).observe({ type: 'layout-shift', buffered: true })
    const interactionIds = new Set<number>()
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { duration: number; interactionId?: number }>) {
        if (!entry.interactionId) continue
        interactionIds.add(entry.interactionId)
        measurements.interactionCount = interactionIds.size
        measurements.inpMs = Math.max(measurements.inpMs, entry.duration)
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit)
    const original = HTMLCanvasElement.prototype.getContext
    const observedContexts = new WeakSet<object>()
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
      const context = original.apply(this, args)
      if (
        (args[0] === 'webgl' || args[0] === 'webgl2')
        && context
        && !observedContexts.has(context)
      ) {
        observedContexts.add(context)
        measurements.webglContexts += 1
      }
      return context
    } as typeof original
  })
})

for (const [route, budget] of Object.entries(budgets.routes)) {
  test(`${route} stays within browser performance budgets`, async ({ page }) => {
    await page.goto(route)
    await expect(page.locator('#main-content')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
    })
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Connect Wallet' })
      .click()
    await expect(page.getByRole('dialog', { name: 'Choose a wallet' })).toBeVisible()
    await page.waitForTimeout(250)
    const vitals = await page.evaluate(() => {
      const captured = (window as Window & {
        __velostraVitals: Omit<BrowserVitals, 'transferredJsBytes'>
      }).__velostraVitals
      const transferredJsBytes = performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.includes('/assets/') && entry.name.endsWith('.js'))
        .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0)
      return { ...captured, transferredJsBytes }
    }) as BrowserVitals
    const inpLimitMs = budget.inpMs + (process.env.CI ? budgets.measurement.ciInpJitterMs : 0)

    console.log('BROWSER PERFORMANCE', JSON.stringify({ route, vitals, budget, inpLimitMs }))

    expect(vitals.transferredJsBytes).toBeLessThanOrEqual(budget.transferredJsBytes)
    expect(vitals.lcpMs).toBeLessThanOrEqual(budget.lcpMs)
    expect(vitals.interactionCount).toBeGreaterThan(0)
    expect(vitals.inpMs).toBeLessThanOrEqual(inpLimitMs)
    expect(vitals.cls).toBeLessThanOrEqual(budget.cls)
    expect(vitals.webglContexts).toBeLessThanOrEqual(budget.webglContexts)
  })
}
