import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion'
import { ArrowUpRight, Braces, Database, Radio, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_IS_TESTNET } from '../lib/chain'
import './ExecutionAtlas.css'

const sampleCalls = [
  { id: 'VL-8FA2', agent: 'Atlas Reasoner', gross: '$0.30', builder: '+$0.27', state: 'settled' },
  { id: 'VL-C104', agent: 'Sentinel Audit', gross: '$1.20', builder: '+$1.08', state: 'indexed' },
  { id: 'VL-44D9', agent: 'Flow Optimizer', gross: '$0.08', builder: '+$0.07', state: 'verified' },
  { id: 'VL-90E1', agent: 'Signal Extractor', gross: '$0.55', builder: '+$0.50', state: 'routed' },
]

const invariants = [
  { value: '01', label: 'correlation id', note: 'per durable call' },
  { value: '04', label: 'escrow events', note: 'indexed recovery evidence' },
  { value: '90%', label: 'builder route', note: 'deterministic split' },
  { value: '0x', label: 'duplicate effects', note: 'conditional finalization' },
]

const route = ['Request sealed', 'Agent executed', 'Value routed', 'Receipt indexed']

export default function ExecutionAtlas() {
  const sectionRef = useRef<HTMLElement>(null)
  const isInView = useInView(sectionRef, { margin: '-16% 0px -18% 0px' })
  const reducedMotion = useReducedMotion()
  const [activeCall, setActiveCall] = useState(0)

  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const auraX = useMotionValue(-700)
  const auraY = useMotionValue(-700)
  const imageXTarget = useTransform(pointerX, [-1, 1], [-18, 18])
  const imageYTarget = useTransform(pointerY, [-1, 1], [-10, 10])
  const imageRotateXTarget = useTransform(pointerY, [-1, 1], [1.1, -1.1])
  const imageRotateYTarget = useTransform(pointerX, [-1, 1], [-1.4, 1.4])
  const imageX = useSpring(imageXTarget, { stiffness: 72, damping: 24, mass: 0.65 })
  const imageY = useSpring(imageYTarget, { stiffness: 72, damping: 24, mass: 0.65 })
  const imageRotateX = useSpring(imageRotateXTarget, { stiffness: 68, damping: 25, mass: 0.7 })
  const imageRotateY = useSpring(imageRotateYTarget, { stiffness: 68, damping: 25, mass: 0.7 })
  const auraXSmooth = useSpring(auraX, { stiffness: 105, damping: 27, mass: 0.38 })
  const auraYSmooth = useSpring(auraY, { stiffness: 105, damping: 27, mass: 0.38 })

  useEffect(() => {
    if (!isInView || reducedMotion) return
    const timer = window.setInterval(() => {
      setActiveCall((current) => (current + 1) % sampleCalls.length)
    }, 2200)
    return () => window.clearInterval(timer)
  }, [isInView, reducedMotion])

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2)
    pointerY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2)
    auraX.set(event.clientX - rect.left - 280)
    auraY.set(event.clientY - rect.top - 280)
  }

  const resetPointer = () => {
    pointerX.set(0)
    pointerY.set(0)
    auraX.set(-700)
    auraY.set(-700)
  }

  const current = sampleCalls[activeCall]

  return (
    <section className="atlas" id="live-index" ref={sectionRef}>
      <div className="atlas__statusbar">
        <span className="mono">FIG. 00 / EXECUTION FIELD</span>
        <span className="atlas__status"><i /> simulated protocol feed</span>
        <span className="mono">RHC / {ROBINHOOD_CHAIN_ID}</span>
      </div>

      <div className="atlas__intro">
        <div>
          <span className="section-eyebrow">00 / Evidence field</span>
          <h2>Proof should feel like a place you can enter.</h2>
        </div>
        <div className="atlas__intro-copy">
          <p>
            Every paid call leaves an explorable trail from intent to ownership.
            The landscape is not decoration. It is the protocol made legible.
          </p>
          <Link to="/proof">Inspect settlement proof <ArrowUpRight size={15} /></Link>
        </div>
      </div>

      <div
        className="atlas__landscape"
        onPointerMove={handlePointerMove}
        onPointerLeave={resetPointer}
      >
        {!reducedMotion && <motion.div className="atlas__aura" style={{ x: auraXSmooth, y: auraYSmooth }} />}
        <motion.img
          className="atlas__landscape-image"
          src="/visuals/velostra-evidence-landscape.webp"
          alt=""
          loading="lazy"
          decoding="async"
          style={{ x: imageX, y: imageY, rotateX: imageRotateX, rotateY: imageRotateY }}
        />
        <div className="atlas__landscape-grade" aria-hidden="true" />
        <div className="atlas__coordinates mono" aria-hidden="true">
          <span>40.7128 N</span>
          <span>74.0060 W</span>
          <i />
        </div>

        <div className="atlas__field-copy">
          <span className="mono">LIVE EVIDENCE / 8FA2</span>
          <strong>Execution leaves architecture.</strong>
          <p>Each luminous edge maps to an explicit state transition.</p>
        </div>

        <div className="atlas__route" aria-label="Settlement route">
          {route.map((label, index) => (
            <motion.div
              className={index <= activeCall ? 'atlas__route-step atlas__route-step--active' : 'atlas__route-step'}
              key={label}
              animate={{ opacity: index <= activeCall ? 1 : 0.88 }}
              transition={{ duration: 0.45 }}
            >
              <span className="mono">0{index + 1}</span>
              <strong>{label}</strong>
              <i />
            </motion.div>
          ))}
        </div>

        <div className="atlas__trace-card">
          <div className="atlas__trace-head">
            <span><Radio size={13} /> Active trace</span>
            <span className="mono">{current.id}</span>
          </div>
          <motion.div
            className="atlas__trace-body"
            key={current.id}
            initial={{ opacity: 0, y: 9 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="mono">EXECUTION AGENT</span>
            <strong>{current.agent}</strong>
            <div>
              <span>Gross <b>{current.gross}</b></span>
              <span>Builder <b>{current.builder}</b></span>
            </div>
          </motion.div>
          <div className="atlas__trace-state"><i /><span>{current.state}</span><b className="mono">FINAL</b></div>
          {!reducedMotion && (
            <motion.i
              className="atlas__trace-progress"
              key={`progress-${current.id}`}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 2.2, ease: 'linear' }}
            />
          )}
        </div>

        <div className="atlas__field-dock">
          <span><Braces size={14} /> deterministic finalization</span>
          <span><Database size={14} /> chain + postgres aligned</span>
          <span><ShieldCheck size={14} /> replay protected</span>
          <span className="mono">{ROBINHOOD_IS_TESTNET ? 'PUBLIC TESTNET' : 'PROTOCOL SIMULATION'}</span>
        </div>
      </div>

      <div className="atlas__invariants">
        {invariants.map((metric, index) => (
          <div className="atlas__invariant" key={metric.label}>
            <span className="mono">0{index + 1}</span>
            <strong>{metric.value}</strong>
            <div><b>{metric.label}</b><small className="mono">{metric.note}</small></div>
          </div>
        ))}
      </div>
    </section>
  )
}