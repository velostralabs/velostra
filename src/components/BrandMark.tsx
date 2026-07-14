import { useId } from 'react'
import './BrandMark.css'

type BrandMarkProps = {
  className?: string
  title?: string
}

export default function BrandMark({ className = '', title }: BrandMarkProps) {
  const markId = `velostra-crystal-${useId().replace(/:/g, '')}`
  const leftGradient = `${markId}-left`
  const rightGradient = `${markId}-right`

  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={leftGradient} x1="7" y1="7" x2="31" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#DFFF78" />
          <stop offset="0.48" stopColor="#9EE12F" />
          <stop offset="1" stopColor="#477A09" />
        </linearGradient>
        <linearGradient id={rightGradient} x1="57" y1="7" x2="33" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0FF9C" />
          <stop offset="0.46" stopColor="#B9F64B" />
          <stop offset="1" stopColor="#5E950D" />
        </linearGradient>
      </defs>

      <ellipse className="brand-mark__glow" cx="32" cy="59.4" rx="13" ry="1.35" />
      <path className="brand-mark__wing" fill={`url(#${leftGradient})`} d="M6.5 6.5 24.4 21.2 30.8 36.2 30.8 58 20.5 47.2 12.7 28.7Z" />
      <path className="brand-mark__wing" fill={`url(#${rightGradient})`} d="m57.5 6.5-17.9 14.7-6.4 15V58l10.3-10.8 7.8-18.5Z" />
      <path className="brand-mark__facet brand-mark__facet--light" d="m6.5 6.5 17.9 14.7-7-2.5Z" />
      <path className="brand-mark__facet brand-mark__facet--mid" d="m24.4 21.2 6.4 15-8.7-6.8Z" />
      <path className="brand-mark__facet brand-mark__facet--shadow" d="m22.1 29.4 8.7 6.8V58L20.5 47.2Z" />
      <path className="brand-mark__facet brand-mark__facet--light" d="m57.5 6.5-17.9 14.7 7-2.5Z" />
      <path className="brand-mark__facet brand-mark__facet--mid" d="m39.6 21.2-6.4 15 8.7-6.8Z" />
      <path className="brand-mark__facet brand-mark__facet--shadow" d="m41.9 29.4-8.7 6.8V58l10.3-10.8Z" />
      <path className="brand-mark__ridge" d="M6.5 6.5 22.1 29.4 30.8 58M24.4 21.2l-11.7 7.5 7.8 18.5M57.5 6.5 41.9 29.4 33.2 58M39.6 21.2l11.7 7.5-7.8 18.5" />
    </svg>
  )
}
