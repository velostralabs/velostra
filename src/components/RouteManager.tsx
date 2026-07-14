import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

const routeTitles: Record<string, string> = {
  '/': 'Velostra — Verified AI Execution Market',
  '/index': 'Live Execution Index — Velostra',
  '/system': 'Execution System — Velostra',
  '/proof': 'Settlement Proof — Velostra',
  '/economics': 'Protocol Economics — Velostra',
  '/marketplace': 'Agent Marketplace — Velostra',
  '/dashboard': 'Execution Console — Velostra',
  '/builder': 'Builder Studio — Velostra',
  '/admin': 'Governance — Velostra',
  '/docs': 'Protocol Documentation — Velostra',
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
    document.title = isAgent ? 'Agent Execution — Velostra' : (routeTitles[location.pathname] ?? 'Velostra')

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
        const alignTarget = () => {
          const target = document.getElementById(targetId)
          if (!target) return
          const navOffset = window.innerWidth <= 760 ? 88 : 112
          const top = window.scrollY + target.getBoundingClientRect().top - navOffset
          const distance = Math.abs(top - window.scrollY)
          const behavior = navigationType === 'POP' || distance > window.innerHeight * 1.5 ? 'auto' : 'smooth'
          window.scrollTo({ top: Math.max(0, top), left: 0, behavior })
        }

        frame = window.requestAnimationFrame(alignTarget)
        settleTimers = [
          window.setTimeout(alignTarget, 220),
          window.setTimeout(alignTarget, 720),
          window.setTimeout(alignTarget, 1500),
        ]
      } else {
        const restoredPosition = navigationType === 'POP' ? scrollPositions.get(activeRouteKey) : undefined
        const alignPage = () => window.scrollTo({ top: restoredPosition ?? 0, left: 0, behavior: 'auto' })
        frame = window.requestAnimationFrame(alignPage)
        settleTimers = [
          window.setTimeout(alignPage, 220),
          window.setTimeout(alignPage, 720),
          window.setTimeout(alignPage, 1500),
        ]
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
