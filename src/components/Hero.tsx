import { lazy, Suspense, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { Activity, ArrowUpRight, ShieldCheck, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { VELOSTRA_ESCROW_ADDRESS } from '../lib/contract'
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
  { value: '100ms', label: 'Target block', note: 'execution velocity' },
  { value: '$0.08', label: 'Entry price', note: 'per verified call' },
  { value: '24 / 7', label: 'Agent market', note: 'always available' },
]

function ArtifactPoster() {
  return (
    <div className="hero__poster" aria-hidden="true">
      <div className="hero__poster-card">
        <i /><i />
        <span className="hero__poster-core" />
        <span className="hero__poster-scan" />
      </div>
      <span className="hero__poster-orbit hero__poster-orbit--one" />
      <span className="hero__poster-orbit hero__poster-orbit--two" />
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
          idleTask = window.requestIdleCallback(() => setEnableWebGL(true), { timeout: 900 })
          return
        }
        setEnableWebGL(true)
      }, 700)
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
  const stageXTarget = useTransform(pointerX, [-1, 1], [-12, 12])
  const stageYTarget = useTransform(pointerY, [-1, 1], [-9, 9])
  const stageRotateXTarget = useTransform(pointerY, [-1, 1], [1.8, -1.8])
  const stageRotateYTarget = useTransform(pointerX, [-1, 1], [-2.2, 2.2])
  const contentXTarget = useTransform(pointerX, [-1, 1], [5, -5])
  const contentYTarget = useTransform(pointerY, [-1, 1], [3, -3])
  const glowXTarget = useTransform(pointerX, [-1, 1], [-34, 34])
  const glowYTarget = useTransform(pointerY, [-1, 1], [-22, 22])
  const stageX = useSpring(stageXTarget, { stiffness: 78, damping: 24, mass: 0.55 })
  const stageY = useSpring(stageYTarget, { stiffness: 78, damping: 24, mass: 0.55 })
  const stageRotateX = useSpring(stageRotateXTarget, { stiffness: 72, damping: 24, mass: 0.6 })
  const stageRotateY = useSpring(stageRotateYTarget, { stiffness: 72, damping: 24, mass: 0.6 })
  const contentX = useSpring(contentXTarget, { stiffness: 62, damping: 25, mass: 0.7 })
  const contentY = useSpring(contentYTarget, { stiffness: 62, damping: 25, mass: 0.7 })
  const glowX = useSpring(glowXTarget, { stiffness: 38, damping: 24, mass: 0.9 })
  const glowY = useSpring(glowYTarget, { stiffness: 38, damping: 24, mass: 0.9 })
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

      <div className="hero__grid">
        <motion.div className="hero__content" variants={container} initial="hidden" animate="show" style={{ x: contentX, y: contentY }}>
          <motion.div className="hero__eyebrow" variants={item}>
            <span className="hero__eyebrow-index mono">VL / 001</span>
            <span className="hero__eyebrow-status">
              <i />
              {contractIsConfigured ? 'Protocol online' : 'Protocol preview'}
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
            <Link className="btn btn--primary" to="/marketplace">
              Explore live agents
              <span className="btn__arrow"><ArrowUpRight size={16} /></span>
            </Link>
            <Link className="btn btn--ghost" to="/builder">
              Deploy an agent
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
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          style={{ x: stageX, y: stageY, rotateX: stageRotateX, rotateY: stageRotateY }}
        >
          <div className="hero__stage-frame" />
          <AdaptiveScene />

          <div className="hero__hud hero__hud--top">
            <span className="mono">EXECUTION OBJECT / 014</span>
            <span className="hero__hud-live"><i /> adaptive</span>
          </div>

          <motion.div
            className="hero__receipt"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="hero__receipt-head">
              <Activity size={15} color="var(--signal)" />
              <span className="mono">agent_call / settled</span>
            </div>
            <div className="hero__receipt-value">
              <strong>$0.30</strong>
              <span>+0.27 builder</span>
            </div>
            <div className="hero__receipt-bars">
              <i /><i /><i /><i /><i />
            </div>
          </motion.div>

          <div className="hero__coordinate mono">
            RHC / 4663
            <br />
            LATENCY OPTIMIZED
          </div>
        </motion.div>
      </div>

      <motion.div
        className="hero__stats"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.68, delay: 0.58, ease: [0.16, 1, 0.3, 1] }}
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
