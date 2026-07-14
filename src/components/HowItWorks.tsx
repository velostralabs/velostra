import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import { Boxes, Fingerprint, RadioTower, WalletCards, type LucideIcon } from 'lucide-react'
import './HowItWorks.css'

type FlowStep = {
  index: string
  tag: string
  title: string
  body: string
  metric: string
  metricLabel: string
  icon: LucideIcon
}

const steps: FlowStep[] = [
  {
    index: '01',
    tag: 'Builder intent',
    title: 'Publish specialized intelligence',
    body: 'Connect the API you already run, define its price, capability, and execution policy. Velostra turns it into a market-ready agent.',
    metric: '< 5 min',
    metricLabel: 'to publish',
    icon: Boxes,
  },
  {
    index: '02',
    tag: 'Verified execution',
    title: 'Every request becomes a receipt',
    body: 'The gateway signs, meters, and correlates each call before a settlement can move. Output and payment share one durable identity.',
    metric: '1 : 1',
    metricLabel: 'call to receipt',
    icon: Fingerprint,
  },
  {
    index: '03',
    tag: 'Onchain routing',
    title: 'Value moves by deterministic rule',
    body: 'Confirmed calls route builder earnings and protocol revenue through the escrow contract with a transparent 90/10 split.',
    metric: '90 / 10',
    metricLabel: 'fixed split',
    icon: RadioTower,
  },
  {
    index: '04',
    tag: 'Builder liquidity',
    title: 'Claim without platform friction',
    body: 'Earnings stay attributable, auditable, and available to claim from the builder wallet without opaque payout windows.',
    metric: '24 / 7',
    metricLabel: 'claim access',
    icon: WalletCards,
  },
]

export default function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null)
  const isInView = useInView(sectionRef, { margin: '-18% 0px -18% 0px' })
  const reducedMotion = useReducedMotion()
  const [active, setActive] = useState(0)
  const [interactionHeld, setInteractionHeld] = useState(false)
  const current = steps[active]

  useEffect(() => {
    if (!isInView || reducedMotion || interactionHeld) return
    const timer = window.setInterval(() => setActive((step) => (step + 1) % steps.length), 3200)
    return () => window.clearInterval(timer)
  }, [interactionHeld, isInView, reducedMotion])

  return (
    <section className="how" id="system" ref={sectionRef}>
      <div className="how__intro">
        <div className="section-head">
          <span className="section-eyebrow">01 / Execution system</span>
          <h2 className="section-title">One identity from prompt to payout.</h2>
          <p className="section-copy">
            The experience feels instant. Underneath, every step is explicit, attributable,
            and recoverable by design.
          </p>
        </div>

        <div className="how__manifest" role="tablist" aria-label="Velostra execution steps">
          {steps.map((step, index) => {
            const Icon = step.icon
            const isActive = active === index
            return (
              <button
                type="button"
                className={'how__step' + (isActive ? ' how__step--active' : '')}
                key={step.index}
                onMouseEnter={() => { setInteractionHeld(true); setActive(index) }}
                onMouseLeave={() => setInteractionHeld(false)}
                onFocus={() => { setInteractionHeld(true); setActive(index) }}
                onBlur={() => setInteractionHeld(false)}
                onClick={() => { setInteractionHeld(true); setActive(index) }}
                role="tab"
                aria-selected={isActive}
              >
                <span className="how__step-index mono">{step.index}</span>
                <span className="how__step-icon"><Icon size={17} strokeWidth={1.6} /></span>
                <span className="how__step-copy">
                  <small>{step.tag}</small>
                  <strong>{step.title}</strong>
                </span>
                <span className="how__step-arrow">↗</span>
                {isActive && !reducedMotion && (
                  <motion.span className="how__step-progress" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 3.2, ease: 'linear' }} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flow-console">
        <div className="flow-console__chrome">
          <span className="mono">VELOSTRA / EXECUTION TRACE</span>
          <span className="flow-console__status"><i /> synchronized</span>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
          className="flow-console__body"
          key={current.index}
          initial={{ opacity: 0, y: 16, filter: 'blur(5px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
          transition={{ duration: 0.56, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="flow-console__meta">
            <span className="mono">STEP {current.index}</span>
            <span>{current.tag}</span>
          </div>

          <h3>{current.title}</h3>
          <p>{current.body}</p>

          <div className="flow-console__route">
            {['USER', 'ESCROW', 'BUILDER'].map((node, index) => (
              <div className={'flow-node' + (index <= active % 3 ? ' flow-node--active' : '')} key={node}>
                <span className="mono">0{index + 1}</span>
                <strong>{node}</strong>
                <i />
              </div>
            ))}
            <div className="flow-console__beam" />
          </div>

          <div className="flow-console__signal" aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => (
              <i key={index} style={{ height: 16 + ((index * 17) % 58) + '%' }} />
            ))}
          </div>

          <div className="flow-console__footer">
            <div>
              <span>Observed result</span>
              <strong>{current.metric}</strong>
            </div>
            <span className="mono">{current.metricLabel}</span>
          </div>
          </motion.div>
        </AnimatePresence>

        <div className="flow-console__rail mono">
          <span>AUTH / HMAC</span>
          <span>STATE / DURABLE</span>
          <span>SETTLEMENT / VERIFIED</span>
        </div>
      </div>
    </section>
  )
}
