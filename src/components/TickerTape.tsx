import { CHAIN_FACTS } from '../lib/chain'
import './TickerTape.css'

export default function TickerTape() {
  const items = [...CHAIN_FACTS, ...CHAIN_FACTS, ...CHAIN_FACTS]

  return (
    <div className="ticker" aria-label="Network status">
      <div className="ticker__status">
        <span className="ticker__pulse" />
        <span>Protocol preview</span>
      </div>
      <div className="ticker__viewport">
        <div className="ticker__track">
          {items.map((fact, index) => (
            <span className="ticker__item" key={index}>
              <span className="ticker__label mono">{fact.label}</span>
              <span className="ticker__value mono">{fact.value}</span>
            </span>
          ))}
        </div>
      </div>
      <span className="ticker__edition mono">V / 01</span>
    </div>
  )
}
