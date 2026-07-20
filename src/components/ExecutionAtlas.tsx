import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
import BrandMark from './BrandMark'
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_IS_TESTNET } from '../lib/chain'
import './ExecutionAtlas.css'

const sampleCalls = [
  { id: 'VL-8FA2', agent: 'Atlas Reasoner', gross: '$0.30', builder: '+$0.27', state: 'settled' },
  { id: 'VL-C104', agent: 'Sentinel Audit', gross: '$1.20', builder: '+$1.08', state: 'indexed' },
  { id: 'VL-44D9', agent: 'Flow Optimizer', gross: '$0.08', builder: '+$0.07', state: 'verified' },
  { id: 'VL-90E1', agent: 'Signal Extractor', gross: '$0.55', builder: '+$0.50', state: 'routed' },
  { id: 'VL-7BC0', agent: 'Policy Engine', gross: '$0.18', builder: '+$0.16', state: 'sealed' },
]

const invariants = [
  { value: '01', label: 'correlation id', note: 'per durable call' },
  { value: '04', label: 'escrow events', note: 'indexed recovery evidence' },
  { value: '90%', label: 'builder route', note: 'deterministic split' },
  { value: '0×', label: 'duplicate effects', note: 'conditional finalization' },
]

const protocolSignals = [
  'REQUEST SEALED',
  'AGENT VERIFIED',
  'OUTPUT RECEIVED',
  'CALL ID CORRELATED',
  'EARNINGS ROUTED',
  'RECEIPT INDEXED',
  'DRIFT CHECKED',
  'STATE RECOVERABLE',
]

export default function ExecutionAtlas() {
  const sectionRef = useRef<HTMLElement>(null)
  const isInView = useInView(sectionRef, { margin: '-16% 0px -18% 0px' })
  const reducedMotion = useReducedMotion()
  const [activeCall, setActiveCall] = useState(0)

  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const auraX = useMotionValue(-700)
  const auraY = useMotionValue(-700)
  const wordRotateXTarget = useTransform(pointerY, [-1, 1], [2.1, -2.1])
  const wordRotateYTarget = useTransform(pointerX, [-1, 1], [-2.8, 2.8])
  const wordXTarget = useTransform(pointerX, [-1, 1], [-8, 8])
  const wordYTarget = useTransform(pointerY, [-1, 1], [-5, 5])
  const wordRotateX = useSpring(wordRotateXTarget, { stiffness: 72, damping: 24, mass: 0.55 })
  const wordRotateY = useSpring(wordRotateYTarget, { stiffness: 72, damping: 24, mass: 0.55 })
  const wordX = useSpring(wordXTarget, { stiffness: 68, damping: 24, mass: 0.6 })
  const wordY = useSpring(wordYTarget, { stiffness: 68, damping: 24, mass: 0.6 })
  const auraXSmooth = useSpring(auraX, { stiffness: 105, damping: 27, mass: 0.38 })
  const auraYSmooth = useSpring(auraY, { stiffness: 105, damping: 27, mass: 0.38 })

  useEffect(() => {
    if (!isInView || reducedMotion) return
    const timer = window.setInterval(() => {
      setActiveCall((current) => (current + 1) % sampleCalls.length)
    }, 1900)
    return () => window.clearInterval(timer)
  }, [isInView, reducedMotion])

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (reducedMotion || event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2)
    pointerY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2)
    auraX.set(event.clientX - rect.left - 310)
    auraY.set(event.clientY - rect.top - 310)
  }

  const resetPointer = () => {
    pointerX.set(0)
    pointerY.set(0)
    auraX.set(-700)
    auraY.set(-700)
  }

  return (
    <section
      className="atlas"
      id="live-index"
      ref={sectionRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      {!reducedMotion && <motion.div className="atlas__aura" style={{ x: auraXSmooth, y: auraYSmooth }} />}

      <div className="atlas__frame">
        <div className="atlas__statusbar">
          <span className="mono">FIG. 00 · EXECUTION INDEX</span>
          <span className="atlas__status"><i /> simulated protocol feed</span>
          <span className="mono">MOVE CURSOR THROUGH THE PROOF</span>
        </div>

        <motion.div
          className="atlas__word"
          aria-label="Proof"
          style={{ x: wordX, y: wordY, rotateX: wordRotateX, rotateY: wordRotateY }}
        >
          {'PROOF'.split('').map((letter, index) => (
            <span key={`${letter}-${index}`} data-letter={letter} style={{ '--letter-index': index } as CSSProperties}>
              {letter}
            </span>
          ))}
        </motion.div>

        <div className="atlas__statement">
          <span className="atlas__statement-index mono">VL / PROTOCOL OBJECT 001</span>
          <p>
            One paid call enters. One correlated financial outcome leaves. Every transition
            emits enough evidence for the system to explain—and repair—itself.
          </p>
          <Link to="/proof">
            Inspect settlement proof <ArrowUpRight size={15} />
          </Link>
        </div>

        <div className="atlas__board">
          <div className="atlas__feed">
            <div className="atlas__panel-head">
              <div>
                <Radio size={14} />
                <span className="mono">SAMPLE EXECUTION STREAM</span>
              </div>
              <span className="atlas__panel-state"><i /> {ROBINHOOD_IS_TESTNET ? 'public testnet feed' : 'protocol simulation'}</span>
            </div>

            <div className="atlas__feed-columns mono">
              <span>CALL</span><span>AGENT</span><span>GROSS</span><span>BUILDER</span><span>STATE</span>
            </div>

            <div className="atlas__feed-rows">
              {sampleCalls.map((call, index) => {
                const active = activeCall === index
                return (
                  <motion.div
                    className={`atlas__feed-row ${active ? 'atlas__feed-row--active' : ''}`}
                    key={call.id}
                    animate={{ opacity: active ? 1 : 0.56 }}
                    transition={{ duration: 0.45 }}
                  >
                    <span className="mono">{call.id}</span>
                    <strong>{call.agent}</strong>
                    <span className="mono">{call.gross}</span>
                    <span className="atlas__positive mono">{call.builder}</span>
                    <span className="atlas__row-state mono"><i /> {call.state}</span>
                    {active && (
                      <motion.i
                        className="atlas__row-progress"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 1.9, ease: 'linear' }}
                      />
                    )}
                  </motion.div>
                )
              })}
            </div>

            <div className="atlas__feed-footer">
              <span><Braces size={14} /> deterministic finalization</span>
              <span><Database size={14} /> postgres + chain aligned</span>
              <span><ShieldCheck size={14} /> replay protected</span>
            </div>
          </div>

          <div className="atlas__aperture">
            <div className="atlas__panel-head">
              <div><span className="mono">SETTLEMENT APERTURE</span></div>
              <span className="mono">RHC / {ROBINHOOD_CHAIN_ID}</span>
            </div>

            <div className="atlas__aperture-visual" aria-hidden="true">
              <svg viewBox="0 0 520 520">
                <defs>
                  <linearGradient id="atlas-route" x1="0" y1="0" x2="1" y2="1">
                    <stop stopColor="#c9ff5f" />
                    <stop offset="1" stopColor="#8fe9dc" />
                  </linearGradient>
                  <radialGradient id="atlas-core">
                    <stop stopColor="#c9ff5f" stopOpacity=".14" />
                    <stop offset="1" stopColor="#c9ff5f" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="260" cy="260" r="208" className="atlas__ring atlas__ring--outer" />
                <circle cx="260" cy="260" r="165" className="atlas__ring atlas__ring--dash" />
                <circle cx="260" cy="260" r="112" className="atlas__ring atlas__ring--counter" />
                <circle cx="260" cy="260" r="92" fill="url(#atlas-core)" />
                <path d="M92 154 260 260 427 142M106 382 260 260 418 390" className="atlas__routes" />
                <g className="atlas__orbit-nodes">
                  <circle cx="92" cy="154" r="8" /><circle cx="427" cy="142" r="8" />
                  <circle cx="106" cy="382" r="8" /><circle cx="418" cy="390" r="8" />
                </g>
              </svg>
              <div className="atlas__aperture-core">
                <BrandMark />
                <strong>SETTLED</strong>
                <span className="mono">8FA2 / FINAL</span>
              </div>
              <span className="atlas__node atlas__node--one mono">REQUEST</span>
              <span className="atlas__node atlas__node--two mono">BUILDER</span>
              <span className="atlas__node atlas__node--three mono">LEDGER</span>
              <span className="atlas__node atlas__node--four mono">INDEXER</span>
            </div>

            <div className="atlas__aperture-readout mono">
              <span>CONFIRMATIONS <b>SAFE</b></span>
              <span>DRIFT <b>0.000000</b></span>
              <span>CURSOR <b>ALIGNED</b></span>
            </div>
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
      </div>

      <div className="atlas__signal-rail" aria-hidden="true">
        <div>
          {[...protocolSignals, ...protocolSignals].map((signal, index) => (
            <span key={`${signal}-${index}`}><i />{signal}</span>
          ))}
        </div>
      </div>
    </section>
  )
}
