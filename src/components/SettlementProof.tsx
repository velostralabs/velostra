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
import { ROBINHOOD_CHAIN_ID } from '../lib/chain'
import './SettlementProof.css'

const trace = [
  { index: '01', title: 'Request sealed', copy: 'Identity and pricing policy attach before execution.', icon: Fingerprint, code: 'AUTH / HMAC' },
  { index: '02', title: 'Call correlated', copy: 'One durable call ID follows output and value.', icon: RadioTower, code: 'CALL / 8FA2' },
  { index: '03', title: 'Revenue routed', copy: 'The 90/10 split resolves by deterministic rule.', icon: WalletCards, code: 'SPLIT / 90:10' },
  { index: '04', title: 'Receipt indexed', copy: 'Reconciliation keeps chain and database aligned.', icon: ScrollText, code: 'STATE / FINAL' },
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
  const glareX = useMotionValue(-500)
  const glareY = useMotionValue(-500)
  const stackRotateXTarget = useTransform(pointerY, [-1, 1], [2.2, -2.2])
  const stackRotateYTarget = useTransform(pointerX, [-1, 1], [-2.8, 2.8])
  const stackXTarget = useTransform(pointerX, [-1, 1], [-8, 8])
  const stackYTarget = useTransform(pointerY, [-1, 1], [-6, 6])
  const stackRotateX = useSpring(stackRotateXTarget, { stiffness: 74, damping: 24, mass: 0.58 })
  const stackRotateY = useSpring(stackRotateYTarget, { stiffness: 74, damping: 24, mass: 0.58 })
  const stackX = useSpring(stackXTarget, { stiffness: 86, damping: 25, mass: 0.5 })
  const stackY = useSpring(stackYTarget, { stiffness: 86, damping: 25, mass: 0.5 })
  const glareXSmooth = useSpring(glareX, { stiffness: 110, damping: 27, mass: 0.36 })
  const glareYSmooth = useSpring(glareY, { stiffness: 110, damping: 27, mass: 0.36 })

  useEffect(() => {
    if (!isInView || reducedMotion || interactionHeld) return
    const timer = window.setInterval(() => setActiveStep((step) => (step + 1) % trace.length), 2400)
    return () => window.clearInterval(timer)
  }, [interactionHeld, isInView, reducedMotion])

  const selectStep = (index: number) => {
    setInteractionHeld(true)
    setActiveStep(index)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2)
    pointerY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2)
    glareX.set(event.clientX - rect.left - 190)
    glareY.set(event.clientY - rect.top - 190)
  }

  const resetPointer = () => {
    pointerX.set(0)
    pointerY.set(0)
    glareX.set(-500)
    glareY.set(-500)
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
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-12%' }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={handlePointerMove}
          onPointerLeave={resetPointer}
        >
          {!reducedMotion && <motion.div className="proof__cursor-glare" style={{ x: glareXSmooth, y: glareYSmooth }} />}
          <div className="proof__visual-chrome">
            <span className="mono">VERIFIABLE RECEIPT VAULT</span>
            <span className="proof__chrome-state"><i /> processing <b className="mono">{trace[activeStep].index} / 04</b></span>
          </div>

          <motion.div
            className="proof__receipt-stack"
            style={{ x: stackX, y: stackY, rotateX: stackRotateX, rotateY: stackRotateY }}
          >
            <div className="proof__spine" aria-hidden="true"><motion.i animate={{ height: `${(activeStep + 1) * 25}%` }} /></div>
            {trace.map((item, index) => {
              const isActive = activeStep === index
              const isComplete = index <= activeStep
              return (
                <motion.button
                  type="button"
                  className={`proof__receipt${isActive ? ' proof__receipt--active' : ''}${isComplete ? ' proof__receipt--complete' : ''}`}
                  key={item.index}
                  onMouseEnter={() => selectStep(index)}
                  onMouseLeave={() => setInteractionHeld(false)}
                  onFocus={() => selectStep(index)}
                  onBlur={() => setInteractionHeld(false)}
                  onClick={() => selectStep(index)}
                  animate={{ x: isActive ? 15 : index * 3, z: isActive ? 26 : 0 }}
                  transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
                  aria-pressed={isActive}
                >
                  <span className="proof__receipt-index mono">{item.index}</span>
                  <span className="proof__receipt-title">
                    <small className="mono">{item.code}</small>
                    <strong>{item.title}</strong>
                  </span>
                  <span className="proof__receipt-value">
                    <small>observed state</small>
                    <strong>{index === 0 ? '$4.00' : index === 1 ? '8FA2' : index === 2 ? '90 / 10' : 'FINAL'}</strong>
                  </span>
                  <span className="proof__receipt-check"><Check size={13} /></span>
                </motion.button>
              )
            })}
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
                  onMouseEnter={() => selectStep(index)}
                  onMouseLeave={() => setInteractionHeld(false)}
                  onFocus={() => selectStep(index)}
                  onBlur={() => setInteractionHeld(false)}
                  onClick={() => selectStep(index)}
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