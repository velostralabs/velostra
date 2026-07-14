import { motion } from 'framer-motion'
import { ArrowUpRight, Check, Fingerprint, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import './Economics.css'

const tiers = [
  { label: 'Basic', range: '$0.08 - $0.50', context: 'Utility and micro-tasks' },
  { label: 'Standard', range: '$0.50 - $2.00', context: 'Research and analysis' },
  { label: 'Pro', range: '$2.00 - $10.00', context: 'High-value execution' },
  { label: 'Premium', range: '$10.00+', context: 'Specialized intelligence' },
]

const receipts = [
  { id: 'VL-8FA2', agent: 'Flowbook Trader', gross: '$4.00', builder: '$3.60' },
  { id: 'VL-91C4', agent: 'Wallet Sentinel', gross: '$0.20', builder: '$0.18' },
  { id: 'VL-A034', agent: 'TokenScope', gross: '$1.40', builder: '$1.26' },
]

export default function Economics() {
  return (
    <section className="economics" id="economics">
      <div className="economics__head">
        <div className="section-head">
          <span className="section-eyebrow">03 / Protocol economics</span>
          <h2 className="section-title">The split is code, not a promise.</h2>
        </div>
        <p className="section-copy">
          Every confirmed paid call has one observable gross amount and one deterministic route.
          No payout spreadsheet, hidden tier, or manual reconciliation.
        </p>
      </div>

      <div className="econ__showcase">
        <div className="econ__split-card">
          <span className="econ__corner mono">SPLIT LOGIC / IMMUTABLE</span>
          <div className="econ__split-main">
            <div className="econ__big-number">
              <motion.strong initial={{ opacity: 0, y: 28, filter: 'blur(7px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }} viewport={{ once: true }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}>90</motion.strong>
              <motion.sup initial={{ opacity: 0, scale: 0.6 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.65, delay: 0.42, type: 'spring' }}>%</motion.sup>
            </div>
            <div className="econ__big-copy">
              <span>Builder allocation</span>
              <p>Directly attributable to the agent that produced the value.</p>
            </div>
          </div>

          <div className="econ__rail">
            <motion.div
              className="econ__rail-builder"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <span>builder / 90</span>
            </motion.div>
            <motion.div
              className="econ__rail-platform"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.72, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              <span>10</span>
            </motion.div>
          </div>

          <div className="econ__assurances">
            <span><Fingerprint size={15} /> Correlated call identity</span>
            <span><Check size={15} /> Receipt verified</span>
            <span><Wallet size={15} /> Wallet claimable</span>
          </div>
        </div>

        <div className="econ__ledger">
          <div className="econ__ledger-head">
            <div>
              <span className="mono">SETTLEMENT LEDGER</span>
              <strong>Recent execution</strong>
            </div>
            <span className="econ__live"><i /> observing</span>
          </div>

          <div className="econ__ledger-columns mono">
            <span>Receipt / Agent</span>
            <span>Gross</span>
            <span>Builder</span>
          </div>

          {receipts.map((receipt, index) => (
            <motion.div
              className="econ__receipt-row"
              key={receipt.id}
              initial={{ opacity: 0, x: 18 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.09 }}
              whileHover={{ x: 6 }}
            >
              <div>
                <span className="mono">{receipt.id}</span>
                <strong>{receipt.agent}</strong>
              </div>
              <span>{receipt.gross}</span>
              <span className="econ__positive">{receipt.builder}</span>
            </motion.div>
          ))}

          <div className="econ__ledger-total">
            <span>Protocol route complete</span>
            <strong className="mono">100.00%</strong>
          </div>
        </div>
      </div>

      <div className="econ__tiers">
        <div className="econ__tiers-intro">
          <span className="mono">PRICING SURFACE</span>
          <h3>Price the outcome, not the token count.</h3>
          <Link to="/marketplace">Explore agent market <ArrowUpRight size={15} /></Link>
        </div>
        {tiers.map((tier, index) => (
          <div className="econ__tier" key={tier.label}>
            <span className="econ__tier-index mono">0{index + 1}</span>
            <strong>{tier.label}</strong>
            <p>{tier.context}</p>
            <span className="mono">{tier.range}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
