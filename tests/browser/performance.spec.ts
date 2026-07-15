import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { createProductState, installInjectedWallet, installProductApi } from './fixtures'

const budgets = createRequire(import.meta.url)('../../config/performance-budgets.json') as {
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
  transferredJsBytes: number
  webglContexts: number
}

test.beforeEach(async ({ page }) => {
  await installInjectedWallet(page)
  await installProductApi(page, createProductState())
  await page.addInitScript(() => {
    const measurements = { lcpMs: 0, cls: 0, inpMs: 0, webglContexts: 0 }
    Object.defineProperty(window, '__velostraVitals', { value: measurements })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) measurements.lcpMs = Math.max(measurements.lcpMs, entry.startTime)
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
        if (!entry.hadRecentInput) measurements.cls += entry.value ?? 0
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { duration: number }>) {
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
    await page.keyboard.press('Tab')
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

    expect(vitals.transferredJsBytes).toBeLessThanOrEqual(budget.transferredJsBytes)
    expect(vitals.lcpMs).toBeLessThanOrEqual(budget.lcpMs)
    expect(vitals.inpMs).toBeLessThanOrEqual(budget.inpMs)
    expect(vitals.cls).toBeLessThanOrEqual(budget.cls)
    expect(vitals.webglContexts).toBeLessThanOrEqual(budget.webglContexts)
  })
}
