import { useId } from 'react'
import './BrandMark.css'

type BrandMarkProps = {
  className?: string
  title?: string
}

export default function BrandMark({ className = '', title }: BrandMarkProps) {
  const gradientId = `velostra-mark-${useId().replace(/:/g, '')}`

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
        <linearGradient id={gradientId} x1="14" y1="8" x2="49" y2="57" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5F7EE" />
          <stop offset="0.42" stopColor="#DCEBAA" />
          <stop offset="1" stopColor="#9EDB42" />
        </linearGradient>
      </defs>

      <path className="brand-mark__facet" d="M7 10.5 31.6 3l25.5 7.5L49 35.8 32 61 14.9 35.8 7 10.5Z" />
      <path fill={`url(#${gradientId})`} d="M12.6 11.8h13.2L32 31.1l6.2-19.3h13.2L38.1 53.2H25.9L12.6 11.8Z" />
      <path className="brand-mark__cut" d="m25.8 11.8 6.2 19.3 6.2-19.3L32 7.1l-6.2 4.7Z" />
      <path className="brand-mark__edge" d="M14.8 13.4 27.5 51h9L49.2 13.4" />
      <rect className="brand-mark__node" x="29.35" y="28.45" width="5.3" height="5.3" rx="1" transform="rotate(45 32 31.1)" />
    </svg>
  )
}
