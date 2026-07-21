import { lazy, Suspense, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { ArrowUpRight, Check, ShieldCheck, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { VELOSTRA_ESCROW_ADDRESS } from '../lib/contract'
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_IS_TESTNET } from '../lib/chain'
import './Hero.css'

const Scene3DBackground = lazy(() => import('./Scene3DBackground'))

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.06 } },
}

const item = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.68, ease: [0.16, 1, 0.3, 1] as const },
  },
}

const stats = [
  { value: '90%', label: 'Builder yield', note: 'programmatic split' },
  { value: '100 ms', label: 'Target block', note: 'execution velocity' },
  { value: '$0.08', label: 'Entry price', note: 'per verified call' },
  { value: '24 / 7', label: 'Agent market', note: 'always available' },
]

function ArtifactPoster() {
  return (
    <div className="hero__poster" aria-hidden="true">
      <div className="hero__poster-rings">
        <i /><i /><i />
      </div>
      <div className="hero__poster-crystal">
        <i /><i />
      </div>
      <span className="hero__poster-beam" />
      <span className="hero__poster-node hero__poster-node--one" />
      <span className="hero__poster-node hero__poster-node--two" />
      <span className="hero__poster-node hero__poster-node--three" />
      <span className="hero__poster-node hero__poster-node--four" />
    </div>
  )
}

function AdaptiveScene() {
  const [enableWebGL, setEnableWebGL] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 821px) and (prefers-reduced-motion: no-preference)')
    let timer = 0
    let idleTask = 0

    const cancelScheduledLoad = () => {
      window.clearTimeout(timer)
      if (idleTask && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleTask)
      idleTask = 0
    }

    const sync = () => {
      cancelScheduledLoad()
      if (!query.matches) {
        setEnableWebGL(false)
        return
      }

      timer = window.setTimeout(() => {
        if ('requestIdleCallback' in window) {
          idleTask = window.requestIdleCallback(() => setEnableWebGL(true), { timeout: 650 })
          return
        }
        setEnableWebGL(true)
      }, 240)
    }

    sync()
    query.addEventListener('change', sync)
    return () => {
      cancelScheduledLoad()
      query.removeEventListener('change', sync)
    }
  }, [])

  if (!enableWebGL) return <ArtifactPoster />

  return (
    <Suspense fallback={<ArtifactPoster />}>
      <Scene3DBackground />
    </Suspense>
  )
}

export default function Hero() {
  const reducedMotion = useReducedMotion()
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const stageXTarget = useTransform(pointerX, [-1, 1], [-13, 13])
  const stageYTarget = useTransform(pointerY, [-1, 1], [-10, 10])
  const stageRotateXTarget = useTransform(pointerY, [-1, 1], [1.45, -1.45])
  const stageRotateYTarget = useTransform(pointerX, [-1, 1], [-1.8, 1.8])
  const contentXTarget = useTransform(pointerX, [-1, 1], [4, -4])
  const contentYTarget = useTransform(pointerY, [-1, 1], [2.5, -2.5])
  const glowXTarget = useTransform(pointerX, [-1, 1], [-42, 42])
  const glowYTarget = useTransform(pointerY, [-1, 1], [-28, 28])
  const stageX = useSpring(stageXTarget, { stiffness: 76, damping: 26, mass: 0.62 })
  const stageY = useSpring(stageYTarget, { stiffness: 76, damping: 26, mass: 0.62 })
  const stageRotateX = useSpring(stageRotateXTarget, { stiffness: 70, damping: 25, mass: 0.68 })
  const stageRotateY = useSpring(stageRotateYTarget, { stiffness: 70, damping: 25, mass: 0.68 })
  const contentX = useSpring(contentXTarget, { stiffness: 60, damping: 26, mass: 0.72 })
  const contentY = useSpring(contentYTarget, { stiffness: 60, damping: 26, mass: 0.72 })
  const glowX = useSpring(glowXTarget, { stiffness: 34, damping: 26, mass: 0.96 })
  const glowY = useSpring(glowYTarget, { stiffness: 34, damping: 26, mass: 0.96 })
  const contractIsConfigured = /^0x[0-9a-fA-F]{40}$/.test(VELOSTRA_ESCROW_ADDRESS)

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (reducedMotion || event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2)
    pointerY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2)
  }

  const resetPointer = () => {
    pointerX.set(0)
    pointerY.set(0)
  }

  return (
    <section className="hero" id="top" onPointerMove={handlePointerMove} onPointerLeave={resetPointer}>
      <motion.div className="hero__glow" style={{ x: glowX, y: glowY }} />
      <div className="hero__atmosphere" aria-hidden="true" />

      <div className="hero__grid">
        <motion.div className="hero__content" variants={container} initial="hidden" animate="show" style={{ x: contentX, y: contentY }}>
          <motion.div className="hero__eyebrow" variants={item}>
            <span className="hero__eyebrow-index mono">VL / 001</span>
            <span className="hero__eyebrow-status">
              <i />
              {contractIsConfigured
                ? ROBINHOOD_IS_TESTNET ? 'Public testnet online' : 'Protocol online'
                : 'Protocol preview'}
            </span>
          </motion.div>

          <motion.h1 className="hero__title" variants={item}>
            Intelligence,
            <br />
            priced at the
            <br />
            <span>speed of intent.</span>
          </motion.h1>

          <motion.p className="hero__sub" variants={item}>
            Velostra is the execution market for specialized AI. Deploy an agent, price every
            verified call, and route earnings through transparent onchain settlement.
          </motion.p>

          <motion.div className="hero__cta" variants={item}>
            <Link className="btn btn--primary" to={ROBINHOOD_IS_TESTNET ? '/testnet' : '/marketplace'}>
              {ROBINHOOD_IS_TESTNET ? 'Enter public testnet' : 'Explore live agents'}
              <span className="btn__arrow"><ArrowUpRight size={16} /></span>
            </Link>
            <Link className="btn btn--ghost" to={ROBINHOOD_IS_TESTNET ? '/marketplace' : '/builder'}>
              {ROBINHOOD_IS_TESTNET ? 'Explore agents' : 'Deploy an agent'}
              <Workflow size={15} strokeWidth={1.7} />
            </Link>
          </motion.div>

          <motion.div className="hero__proof" variants={item}>
            <ShieldCheck size={16} color="var(--signal)" strokeWidth={1.7} />
            <span>Deterministic 90/10 routing</span>
            <i />
            <span>Receipt-verified execution</span>
          </motion.div>
        </motion.div>

        <motion.div
          className="hero__stage"
          initial={{ opacity: 0, scale: 0.95, filter: 'blur(8px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.18, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          style={{ x: stageX, y: stageY, rotateX: stageRotateX, rotateY: stageRotateY }}
        >
          <div className="hero__stage-frame" />
          <AdaptiveScene />

          <div className="hero__hud hero__hud--top">
            <span className="mono">KINETIC SETTLEMENT CORE / 014</span>
            <span className="hero__hud-live"><i /> live geometry</span>
          </div>

          <div className="hero__signal-map" aria-hidden="true">
            <span className="hero__signal hero__signal--request"><i /> request</span>
            <span className="hero__signal hero__signal--verify"><i /> verify</span>
            <span className="hero__signal hero__signal--settle"><i /> settle</span>
            <span className="hero__signal hero__signal--index"><i /> index</span>
          </div>

          <motion.div
            className="hero__receipt"
            animate={reducedMotion ? undefined : { y: [0, -5, 0] }}
            transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="hero__receipt-head">
              <span className="hero__receipt-check"><Check size={12} strokeWidth={2.2} /></span>
              <span className="mono">settlement receipt</span>
              <b className="mono">FINAL</b>
            </div>
            <div className="hero__receipt-value">
              <strong>$0.30</strong>
              <span>+$0.27 builder</span>
            </div>
            <div className="hero__receipt-track"><i /></div>
            <div className="hero__receipt-meta mono">
              <span>CALL 8FA2</span>
              <span>90 / 10 ROUTED</span>
            </div>
          </motion.div>

          <div className="hero__coordinate mono">
            RHC / {ROBINHOOD_CHAIN_ID}
            <br />
            RECONCILIATION ACTIVE
          </div>

          <div className="hero__stage-rail mono">
            <span><i /> request sealed</span>
            <span><i /> execution verified</span>
            <span><i /> value settled</span>
          </div>
        </motion.div>
      </div>

      <motion.div
        className="hero__stats"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.76, delay: 0.52, ease: [0.16, 1, 0.3, 1] }}
      >
        {stats.map((stat, index) => (
          <div className="hero__stat" key={stat.label}>
            <span className="hero__stat-index mono">0{index + 1}</span>
            <div>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
            <small>{stat.note}</small>
          </div>
        ))}
      </motion.div>
    </section>
  )
}
