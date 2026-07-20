import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion'
import { ArrowUpRight, Check, Fingerprint, RadioTower, ScrollText, WalletCards } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from './BrandMark'
import { ROBINHOOD_CHAIN_ID } from '../lib/chain'
import './SettlementProof.css'

const trace = [
  { index: '01', title: 'Request sealed', copy: 'Identity and pricing policy attach before execution.', icon: Fingerprint },
  { index: '02', title: 'Call correlated', copy: 'One durable call ID follows output and value.', icon: RadioTower },
  { index: '03', title: 'Revenue routed', copy: 'The 90/10 split resolves by deterministic rule.', icon: WalletCards },
  { index: '04', title: 'Receipt indexed', copy: 'Reconciliation keeps chain and database aligned.', icon: ScrollText },
]

const topology = [
  { key: 'request', label: 'REQUEST', path: 'M320 320 C232 235 194 163 126 126', point: [126, 126] },
  { key: 'builder', label: 'BUILDER', path: 'M320 320 C418 252 472 218 536 170', point: [536, 170] },
  { key: 'ledger', label: 'LEDGER', path: 'M320 320 C384 407 434 460 510 522', point: [510, 522] },
  { key: 'receipt', label: 'RECEIPT', path: 'M320 320 C255 407 214 464 142 520', point: [142, 520] },
]

const proofMetrics = [
  { value: '1 : 1', label: 'Call to settlement receipt' },
  { value: '90%', label: 'Direct builder allocation' },
  { value: '0', label: 'Opaque payout steps' },
  { value: '24 / 7', label: 'Automated reconciliation' },
]

const settlementValues = [
  ['$4.00', '$0.00', '$0.00'],
  ['$4.00', '+$3.60', '$0.00'],
  ['$4.00', '+$3.60', '+$0.40'],
  ['$4.00', '+$3.60', '+$0.40'],
]

export default function SettlementProof() {
  const stageRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(stageRef, { margin: '-18% 0px -18% 0px' })
  const reducedMotion = useReducedMotion()
  const [activeStep, setActiveStep] = useState(0)
  const [interactionHeld, setInteractionHeld] = useState(false)

  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const auraX = useMotionValue(-500)
  const auraY = useMotionValue(-500)
  const orbitXTarget = useTransform(pointerX, [-1, 1], [-12, 12])
  const orbitYTarget = useTransform(pointerY, [-1, 1], [-10, 10])
  const orbitRotateXTarget = useTransform(pointerY, [-1, 1], [2.4, -2.4])
  const orbitRotateYTarget = useTransform(pointerX, [-1, 1], [-2.8, 2.8])
  const orbitX = useSpring(orbitXTarget, { stiffness: 90, damping: 24, mass: 0.5 })
  const orbitY = useSpring(orbitYTarget, { stiffness: 90, damping: 24, mass: 0.5 })
  const orbitRotateX = useSpring(orbitRotateXTarget, { stiffness: 75, damping: 22, mass: 0.55 })
  const orbitRotateY = useSpring(orbitRotateYTarget, { stiffness: 75, damping: 22, mass: 0.55 })
  const auraXSmooth = useSpring(auraX, { stiffness: 115, damping: 27, mass: 0.35 })
  const auraYSmooth = useSpring(auraY, { stiffness: 115, damping: 27, mass: 0.35 })

  useEffect(() => {
    if (!isInView || reducedMotion || interactionHeld) return
    const timer = window.setInterval(() => setActiveStep((step) => (step + 1) % trace.length), 2400)
    return () => window.clearInterval(timer)
  }, [interactionHeld, isInView, reducedMotion])

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2)
    pointerY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2)
    auraX.set(event.clientX - rect.left - 190)
    auraY.set(event.clientY - rect.top - 190)
  }

  const resetPointer = () => {
    pointerX.set(0)
    pointerY.set(0)
    auraX.set(-500)
    auraY.set(-500)
  }

  return (
    <section className="proof" id="proof">
      <div className="proof__head">
        <div>
          <span className="section-eyebrow">02 / Settlement proof</span>
          <h2>Every dollar has a route.<br />Every route has a receipt.</h2>
        </div>
        <div className="proof__head-copy">
          <p>
            Institutional infrastructure should be able to explain every state transition.
            Velostra makes execution, attribution, and settlement legible by default.
          </p>
          <Link to="/docs">Audit the architecture <ArrowUpRight size={15} /></Link>
        </div>
      </div>

      <div className="proof__stage" ref={stageRef}>
        <motion.div
          className="proof__visual"
          initial={{ opacity: 0, scale: 0.975 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-12%' }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={handlePointerMove}
          onPointerLeave={resetPointer}
        >
          {!reducedMotion && <motion.div className="proof__cursor-aura" style={{ x: auraXSmooth, y: auraYSmooth }} />}

          <div className="proof__visual-chrome">
            <span className="mono">LIVE SETTLEMENT TOPOLOGY</span>
            <span className="proof__chrome-state"><i /> processing <b className="mono">{trace[activeStep].index} / 04</b></span>
            <span className="proof__chrome-progress"><motion.i animate={{ scaleX: (activeStep + 1) / trace.length }} /></span>
          </div>

          <motion.div
            className="proof__orbit"
            style={{ x: orbitX, y: orbitY, rotateX: orbitRotateX, rotateY: orbitRotateY }}
          >
            <svg viewBox="0 0 640 640" aria-hidden="true">
              <defs>
                <radialGradient id="proofHalo" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#c9ff5f" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="#c9ff5f" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="proofRoute" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#8fe9dc" />
                  <stop offset="52%" stopColor="#c9ff5f" />
                  <stop offset="100%" stopColor="#efffd0" />
                </linearGradient>
              </defs>
              <circle cx="320" cy="320" r="265" fill="url(#proofHalo)" />
              <circle className="proof__ring proof__ring--muted" cx="320" cy="320" r="250" />
              <motion.circle
                className="proof__ring proof__ring--dash"
                cx="320"
                cy="320"
                r="208"
                animate={{ strokeDashoffset: [0, -152] }}
                transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
              />
              <motion.circle
                className="proof__ring proof__ring--dash proof__ring--counter"
                cx="320"
                cy="320"
                r="176"
                animate={{ strokeDashoffset: [0, 118] }}
                transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
              />
              <circle className="proof__ring proof__ring--inner" cx="320" cy="320" r="143" />

              {topology.map((route, index) => {
                const isActive = activeStep === index
                return (
                  <g key={route.key} className={isActive ? 'proof__route-group proof__route-group--active' : 'proof__route-group'}>
                    <motion.path
                      className="proof__route"
                      d={route.path}
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: isActive ? 1 : 0.42 }}
                      animate={{ opacity: isActive ? 1 : 0.32 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.65, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
                    />
                    {!reducedMotion && (
                      <circle className="proof__packet" r={isActive ? 4.2 : 2.5}>
                        <animateMotion path={route.path} dur={isActive ? '1.35s' : '3.4s'} begin={`${index * -0.72}s`} repeatCount="indefinite" />
                      </circle>
                    )}
                    <motion.circle
                      className="proof__endpoint-halo"
                      cx={route.point[0]}
                      cy={route.point[1]}
                      animate={{ r: isActive ? [8, 17, 8] : 8, opacity: isActive ? [0.5, 0, 0.5] : 0 }}
                      transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <motion.circle
                      cx={route.point[0]}
                      cy={route.point[1]}
                      fill="#c9ff5f"
                      animate={{ r: isActive ? 7 : 4.5, opacity: isActive ? 1 : 0.72 }}
                      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </g>
                )
              })}
            </svg>

            <div className={`proof__core proof__core--step-${activeStep + 1}`}>
              <BrandMark className="proof__core-mark" />
              <motion.strong key={`status-${activeStep}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                {activeStep === 3 ? 'VERIFIED' : 'SETTLING'}
              </motion.strong>
              <motion.span className="mono" key={`label-${activeStep}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {trace[activeStep].title}
              </motion.span>
            </div>

            {topology.map((node, index) => (
              <motion.button
                type="button"
                key={node.key}
                className={`proof__node proof__node--${node.key}${activeStep === index ? ' proof__node--active' : ''}`}
                onMouseEnter={() => { setInteractionHeld(true); setActiveStep(index) }}
                onMouseLeave={() => setInteractionHeld(false)}
                onFocus={() => { setInteractionHeld(true); setActiveStep(index) }}
                onBlur={() => setInteractionHeld(false)}
                onClick={() => { setInteractionHeld(true); setActiveStep(index) }}
                animate={{ scale: activeStep === index ? 1.045 : 1 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                aria-label={`Inspect ${trace[index].title}`}
              >
                <span className="mono">{trace[index].index}</span><strong>{node.label}</strong><i />
              </motion.button>
            ))}
          </motion.div>

          <div className="proof__readouts">
            {['Gross value', 'Builder route', 'Protocol route'].map((label, index) => (
              <div key={label} className={activeStep >= index ? 'proof__readout--active' : ''}>
                <span>{label}</span>
                <motion.strong
                  key={`${activeStep}-${label}`}
                  className={index === 1 && activeStep >= 1 ? 'proof__positive' : undefined}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {settlementValues[activeStep][index]}
                </motion.strong>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="proof__narrative">
          <div className="proof__status"><span><i /> Deterministic by design</span><span className="mono">RHC / {ROBINHOOD_CHAIN_ID}</span></div>
          <h3>A settlement system that can explain itself.</h3>
          <p>
            No invisible payout queue. No spreadsheet between value creation and ownership.
            Each layer exposes the proof needed by users, builders, and operators.
          </p>

          <div className="proof__trace">
            {trace.map((item, index) => {
              const Icon = item.icon
              const isActive = activeStep === index
              return (
                <motion.button
                  type="button"
                  className={`proof__trace-item${isActive ? ' proof__trace-item--active' : ''}`}
                  key={item.index}
                  initial={{ opacity: 0, x: 18 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.55, delay: index * 0.09 }}
                  onMouseEnter={() => { setInteractionHeld(true); setActiveStep(index) }}
                  onMouseLeave={() => setInteractionHeld(false)}
                  onFocus={() => { setInteractionHeld(true); setActiveStep(index) }}
                  onBlur={() => setInteractionHeld(false)}
                  onClick={() => { setInteractionHeld(true); setActiveStep(index) }}
                  aria-pressed={isActive}
                >
                  <span className="proof__trace-icon"><Icon size={16} strokeWidth={1.6} /></span>
                  <div><span className="mono">{item.index}</span><strong>{item.title}</strong><p>{item.copy}</p></div>
                  <span className="proof__trace-check"><Check size={14} /></span>
                </motion.button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="proof__metrics">
        {proofMetrics.map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: index * 0.08 }}
          >
            <span className="mono">0{index + 1}</span>
            <strong>{metric.value}</strong>
            <p>{metric.label}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}