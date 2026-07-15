import { lazy, Suspense, useLayoutEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import ScrollReveal from './components/ScrollReveal'
import PageTransition from './components/PageTransition'
import RouteManager from './components/RouteManager'
import InterfaceEffects from './components/InterfaceEffects'
import TickerTape from './components/TickerTape'
import HomeIndexRail from './components/HomeIndexRail'
import Nav from './components/Nav'
import ExecutionAtlas from './components/ExecutionAtlas'
import Hero from './components/Hero'
import HowItWorks from './components/HowItWorks'
import Economics from './components/Economics'
import SettlementProof from './components/SettlementProof'
import MarketplacePreview from './components/MarketplacePreview'
import Footer from './components/Footer'
import BrandMark from './components/BrandMark'
import './polish.css'
import './luxury.css'

const Marketplace = lazy(() => import('./pages/Marketplace'))
const AgentDetail = lazy(() => import('./pages/AgentDetail'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Builder = lazy(() => import('./pages/Builder'))
const Admin = lazy(() => import('./pages/Admin'))
const Docs = lazy(() => import('./pages/Docs'))
const NotFound = lazy(() => import('./pages/NotFound'))

const homeSectionTargets: Record<string, string> = {
  '/index': 'live-index',
  '/system': 'system',
  '/proof': 'proof',
  '/economics': 'economics',
}

function Home() {
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    const targetId = homeSectionTargets[pathname]
    if (!targetId) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      return
    }

    const alignRoute = () => {
      const target = document.getElementById(targetId)
      if (!target) return
      const navOffset = window.innerWidth <= 760 ? 88 : 112
      const top = window.scrollY + target.getBoundingClientRect().top - navOffset
      window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'auto' })
    }

    alignRoute()
    window.addEventListener('load', alignRoute)
    const timers = [
      window.setTimeout(alignRoute, 220),
      window.setTimeout(alignRoute, 760),
      window.setTimeout(alignRoute, 1600),
    ]

    return () => {
      window.removeEventListener('load', alignRoute)
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [pathname])

  return (
    <div className="app app--home">
      <TickerTape />
      <Nav />
      <main className="home-main" id="main-content" tabIndex={-1}>
        <Hero />
        <ExecutionAtlas />
        <ScrollReveal>
          <HowItWorks />
        </ScrollReveal>
        <ScrollReveal>
          <SettlementProof />
        </ScrollReveal>
        <ScrollReveal>
          <Economics />
        </ScrollReveal>
        <ScrollReveal>
          <MarketplacePreview />
        </ScrollReveal>
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const homeRoute = ['/', '/index', '/system', '/proof', '/economics'].includes(location.pathname)
  const transitionKey = homeRoute ? 'home' : location.pathname

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <RouteManager />
      <InterfaceEffects />
      {homeRoute && <HomeIndexRail />}
      <Suspense fallback={<RouteFallback />}>
        <AnimatePresence mode="sync" initial={false}>
          <Routes location={location} key={transitionKey}>
            <Route path="/" element={<PageTransition><Home /></PageTransition>} />
            <Route path="/index" element={<PageTransition><Home /></PageTransition>} />
            <Route path="/system" element={<PageTransition><Home /></PageTransition>} />
            <Route path="/proof" element={<PageTransition><Home /></PageTransition>} />
            <Route path="/economics" element={<PageTransition><Home /></PageTransition>} />
            <Route path="/marketplace" element={<PageTransition><Marketplace /></PageTransition>} />
            <Route path="/agents/:slug" element={<PageTransition><AgentDetail /></PageTransition>} />
            <Route path="/agent/:slug" element={<LegacyAgentRedirect />} />
            <Route path="/dashboard" element={<PageTransition><Dashboard /></PageTransition>} />
            <Route path="/builder" element={<PageTransition><Builder /></PageTransition>} />
            <Route path="/admin" element={<PageTransition><Admin /></PageTransition>} />
            <Route path="/docs" element={<PageTransition><Docs /></PageTransition>} />
            <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
          </Routes>
        </AnimatePresence>
      </Suspense>
    </>
  )
}

function LegacyAgentRedirect() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={pathname.replace('/agent/', '/agents/') + search + hash} replace />
}

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <BrandMark className="route-fallback__mark" />
      <span className="mono">Loading Velostra</span>
    </div>
  )
}
