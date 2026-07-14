import { type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { ArrowUpRight, ChartNoAxesCombined, Code2, FileSearch, ScanSearch, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import './MarketplacePreview.css'

const agents = [
  {
    name: 'Flowbook Trader',
    category: 'Market execution',
    price: '$4.00',
    tier: 'PRO',
    metric: '98.7%',
    metricLabel: 'signal confidence',
    icon: ChartNoAxesCombined,
  },
  {
    name: 'Wallet Sentinel',
    category: 'Wallet intelligence',
    price: '$0.20',
    tier: 'BASIC',
    metric: '34ms',
    metricLabel: 'analysis',
    icon: ShieldCheck,
  },
  {
    name: 'Contract Auditor',
    category: 'Code security',
    price: '$6.50',
    tier: 'PRO',
    metric: '142',
    metricLabel: 'checks',
    icon: Code2,
  },
  {
    name: 'TokenScope',
    category: 'Token research',
    price: '$1.40',
    tier: 'STANDARD',
    metric: '18',
    metricLabel: 'sources',
    icon: ScanSearch,
  },
  {
    name: 'Narrative Desk',
    category: 'Deep research',
    price: '$2.80',
    tier: 'PRO',
    metric: '6.4m',
    metricLabel: 'tokens indexed',
    icon: FileSearch,
  },
]

export default function MarketplacePreview() {
  const reducedMotion = useReducedMotion()
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const glareX = useMotionValue(-600)
  const glareY = useMotionValue(-600)
  const waferRotateXTarget = useTransform(pointerY, [-1, 1], [63, 51])
  const waferRotateZTarget = useTransform(pointerX, [-1, 1], [-25, -15])
  const waferXTarget = useTransform(pointerX, [-1, 1], [-15, 15])
  const waferYTarget = useTransform(pointerY, [-1, 1], [-8, 8])
  const waferRotateX = useSpring(waferRotateXTarget, { stiffness: 84, damping: 24, mass: 0.55 })
  const waferRotateZ = useSpring(waferRotateZTarget, { stiffness: 84, damping: 24, mass: 0.55 })
  const waferX = useSpring(waferXTarget, { stiffness: 84, damping: 24, mass: 0.55 })
  const waferY = useSpring(waferYTarget, { stiffness: 84, damping: 24, mass: 0.55 })
  const glareXSmooth = useSpring(glareX, { stiffness: 105, damping: 26, mass: 0.4 })
  const glareYSmooth = useSpring(glareY, { stiffness: 105, damping: 26, mass: 0.4 })
  const featured = agents[0]
  const FeaturedIcon = featured.icon

  const handleFeaturePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    pointerX.set(((event.clientX - rect.left) / rect.width - 0.5) * 2)
    pointerY.set(((event.clientY - rect.top) / rect.height - 0.5) * 2)
    glareX.set(event.clientX - rect.left - 210)
    glareY.set(event.clientY - rect.top - 210)
  }

  const resetFeaturePointer = () => {
    pointerX.set(0)
    pointerY.set(0)
    glareX.set(-600)
    glareY.set(-600)
  }

  return (
    <section className="marketplace" id="marketplace">
      <div className="marketplace__head">
        <div className="section-head">
          <span className="section-eyebrow">04 / Agent market</span>
          <h2 className="section-title">Specialized machines, ready on demand.</h2>
        </div>
        <div className="marketplace__head-side">
          <p className="section-copy">
            Discovery, execution, and verifiable settlement in one surface.
          </p>
          <Link to="/marketplace">
            Enter marketplace <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>

      <div className="mkt__bento">
        <motion.div
          className="mkt__feature"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={handleFeaturePointer}
          onPointerLeave={resetFeaturePointer}
        >
          {!reducedMotion && <motion.div className="mkt__feature-glare" style={{ x: glareXSmooth, y: glareYSmooth }} />}
          <div className="mkt__feature-copy">
            <div className="mkt__agent-top">
              <span className="mkt__agent-icon"><FeaturedIcon size={20} strokeWidth={1.5} /></span>
              <span className="mkt__tier mono">{featured.tier}</span>
            </div>
            <span className="mkt__featured-label mono">FEATURED EXECUTION AGENT</span>
            <h3>{featured.name}</h3>
            <p>
              Reads order flow, maps momentum regimes, and returns a risk-scored execution brief
              with verifiable call settlement.
            </p>
            <div className="mkt__feature-stats">
              <div><strong>{featured.metric}</strong><span>{featured.metricLabel}</span></div>
              <div><strong>{featured.price}</strong><span>per call</span></div>
            </div>
            <Link to="/marketplace" className="mkt__run">
              Inspect agent <ArrowUpRight size={15} />
            </Link>
          </div>

          <div className="mkt__feature-visual" aria-hidden="true">
            <motion.div className="mkt__wafer" style={{ x: waferX, y: waferY, rotateX: waferRotateX, rotateZ: waferRotateZ }}>
              <i className="mkt__wafer-layer mkt__wafer-layer--one" />
              <i className="mkt__wafer-layer mkt__wafer-layer--two" />
              <div className="mkt__wafer-face">
                <span className="mono">FLOW / 04</span>
                <svg viewBox="0 0 320 150" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c9ff5f" stopOpacity="0.42" />
                      <stop offset="100%" stopColor="#c9ff5f" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,124 C25,116 30,93 57,100 C82,106 91,70 120,80 C146,90 155,41 184,55 C211,67 225,31 247,39 C273,48 286,17 320,22 L320,150 L0,150 Z"
                    fill="url(#area)"
                  />
                  <motion.path
                    d="M0,124 C25,116 30,93 57,100 C82,106 91,70 120,80 C146,90 155,41 184,55 C211,67 225,31 247,39 C273,48 286,17 320,22"
                    fill="none"
                    stroke="#c9ff5f"
                    strokeWidth="2"
                    initial={{ pathLength: 0, opacity: 0 }}
                    whileInView={{ pathLength: 1, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                  {!reducedMotion && (
                    <circle r="3" fill="#efffd0" className="mkt__chart-packet">
                      <animateMotion dur="3.8s" repeatCount="indefinite" path="M0,124 C25,116 30,93 57,100 C82,106 91,70 120,80 C146,90 155,41 184,55 C211,67 225,31 247,39 C273,48 286,17 320,22" />
                    </circle>
                  )}
                </svg>
                <div className="mkt__visual-readout">
                  <span>REGIME</span>
                  <strong>ACCUMULATION</strong>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>

        <div className="mkt__agent-grid">
          {agents.slice(1).map((agent, index) => {
            const Icon = agent.icon
            return (
              <motion.div
                className="mkt__agent"
                key={agent.name}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.55, delay: index * 0.07 }}
                whileHover={{ y: -5 }}
              >
                <Link to="/marketplace">
                  <div className="mkt__agent-top">
                    <span className="mkt__agent-icon"><Icon size={18} strokeWidth={1.5} /></span>
                    <span className="mkt__tier mono">{agent.tier}</span>
                  </div>
                  <div className="mkt__agent-copy">
                    <span>{agent.category}</span>
                    <h3>{agent.name}</h3>
                  </div>
                  <div className="mkt__agent-bottom">
                    <div><strong>{agent.metric}</strong><span>{agent.metricLabel}</span></div>
                    <span className="mono">{agent.price} / CALL</span>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
