import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { applyPageMetadata, type PageMetadata } from '../lib/metadata'

const routeMetadata: Record<string, Omit<PageMetadata, 'path'>> = {
  '/': {
    title: 'Velostra — Verified AI Execution Market',
    description: 'Deploy specialized AI agents, price verified calls, and settle value through a recoverable onchain execution market.',
  },
  '/index': {
    title: 'Live Execution Index — Velostra',
    description: 'Inspect the live execution ledger connecting AI agent requests, verified receipts, and settlement outcomes.',
  },
  '/system': {
    title: 'Execution System — Velostra',
    description: 'See how Velostra turns agent intent into priced execution, correlated receipts, and recoverable settlement.',
  },
  '/proof': {
    title: 'Settlement Proof — Velostra',
    description: 'Trace how every verified AI execution is correlated, settled onchain, and reconciled against durable records.',
  },
  '/economics': {
    title: 'Protocol Economics — Velostra',
    description: 'Explore transparent per-call pricing and Velostra’s deterministic 90/10 builder and protocol settlement split.',
  },
  '/marketplace': {
    title: 'Agent Marketplace — Velostra',
    description: 'Discover specialized AI agents with transparent pricing, verified execution, and onchain settlement receipts.',
  },
  '/testnet': {
    title: 'Public Testnet — Velostra',
    description: 'Use the public Velostra testnet to verify live agent execution, settlement, claims, and recovery flows.',
  },
  '/dashboard': {
    title: 'Execution Console — Velostra',
    description: 'Private wallet console for Velostra balances, calls, settlement receipts, and recovery state.',
    robots: 'noindex, nofollow',
  },
  '/builder': {
    title: 'Builder Studio — Velostra',
    description: 'Private builder workspace for publishing agents, reviewing earnings, and managing settlement claims.',
    robots: 'noindex, nofollow',
  },
  '/admin': {
    title: 'Governance — Velostra',
    description: 'Restricted Velostra governance and operational control surface.',
    robots: 'noindex, nofollow',
  },
  '/docs': {
    title: 'Protocol Documentation — Velostra',
    description: 'Read the Velostra protocol model, public testnet guide, API lifecycle, and onchain settlement architecture.',
  },
}

const semanticSections: Record<string, string> = {
  '/index': 'live-index',
  '/system': 'system',
  '/proof': 'proof',
  '/economics': 'economics',
}

const legacyHashes = new Set(['system', 'proof', 'economics', 'marketplace'])
const scrollPositions = new Map<string, number>()

export default function RouteManager() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const previousPathAndHash = useRef('')

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  }, [])

  useEffect(() => {
    if (location.pathname !== '/' || !location.hash) return
    const legacySection = decodeURIComponent(location.hash.slice(1))
    if (!legacyHashes.has(legacySection)) return
    const canonicalPath = legacySection === 'marketplace' ? '/marketplace' : '/' + legacySection
    navigate(canonicalPath + location.search, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate])

  useLayoutEffect(() => {
    const isAgent = location.pathname.startsWith('/agents/')
    const metadata = isAgent
      ? {
          title: 'Agent Execution — Velostra',
          description: 'Run a specialized AI agent with transparent pricing and a correlated Velostra settlement receipt.',
          robots: 'index, follow' as const,
        }
      : routeMetadata[location.pathname] ?? {
          title: 'Page Not Found — Velostra',
          description: 'The requested Velostra route does not exist.',
          robots: 'noindex, nofollow' as const,
        }
    applyPageMetadata({ ...metadata, path: location.pathname })

    const pathAndHash = location.pathname + location.hash
    const samePage = previousPathAndHash.current === pathAndHash
    const activeRouteKey = location.pathname + location.search + location.hash
    previousPathAndHash.current = pathAndHash

    const semanticTarget = semanticSections[location.pathname]
    const hashTarget = location.hash ? decodeURIComponent(location.hash.slice(1)) : ''
    const targetId = semanticTarget || hashTarget

    let frame = 0
    let settleTimers: number[] = []
    if (targetId || !samePage) {
      if (targetId) {
        const alignTarget = (behavior: ScrollBehavior) => {
          document.getElementById(targetId)?.scrollIntoView({ behavior, block: 'start' })
        }

        const initialBehavior = navigationType === 'PUSH' ? 'smooth' : 'auto'
        const correctAlignment = () => {
          const target = document.getElementById(targetId)
          if (!target) return
          const expectedTop = window.innerWidth <= 760 ? 88 : 112
          if (Math.abs(target.getBoundingClientRect().top - expectedTop) > 3) alignTarget('auto')
        }

        frame = window.requestAnimationFrame(() => alignTarget(initialBehavior))
        settleTimers = [600, 1300, 2400].map((delay) =>
          window.setTimeout(correctAlignment, delay)
        )
      } else {
        const restoredPosition = navigationType === 'POP' ? scrollPositions.get(activeRouteKey) : undefined
        frame = window.requestAnimationFrame(() => {
          window.scrollTo({ top: restoredPosition ?? 0, left: 0, behavior: 'auto' })
        })
      }
    }

    return () => {
      window.cancelAnimationFrame(frame)
      settleTimers.forEach((timer) => window.clearTimeout(timer))
      scrollPositions.set(activeRouteKey, window.scrollY)
    }
  }, [location.pathname, location.search, location.hash, navigationType])

  return null
}
