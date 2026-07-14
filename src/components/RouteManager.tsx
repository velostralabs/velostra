import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

const routeTitles: Record<string, string> = {
  '/': 'Velostra — Verified AI Execution Market',
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

  useEffect(() => {
    const isAgent = location.pathname.startsWith('/agents/')
    document.title = isAgent ? 'Agent Execution — Velostra' : (routeTitles[location.pathname] ?? 'Velostra')

    const pathAndHash = location.pathname + location.hash
    const samePage = previousPathAndHash.current === pathAndHash
    const activeRouteKey = location.pathname + location.search + location.hash
    previousPathAndHash.current = pathAndHash

    let frame = 0
    if (!samePage) {
      frame = window.requestAnimationFrame(() => {
        const semanticTarget = semanticSections[location.pathname]
        const hashTarget = location.hash ? decodeURIComponent(location.hash.slice(1)) : ''
        const targetId = semanticTarget || hashTarget

        if (targetId) {
          document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }

        const restoredPosition = navigationType === 'POP' ? scrollPositions.get(activeRouteKey) : undefined
        window.scrollTo({ top: restoredPosition ?? 0, left: 0, behavior: 'auto' })
      })
    }

    return () => {
      window.cancelAnimationFrame(frame)
      scrollPositions.set(activeRouteKey, window.scrollY)
    }
  }, [location.pathname, location.search, location.hash, navigationType])

  return null
}
