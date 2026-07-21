import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import BrandMark from './BrandMark'

export default function PageTransition({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()

  if (reducedMotion) return <>{children}</>

  return (
    <div className="page-transition">
      <motion.div
        className="page-transition__veil page-transition__veil--accent"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        exit={{ scaleX: 1 }}
        transition={{ duration: 0.72, delay: 0.02, ease: [0.76, 0, 0.24, 1] }}
      />
      <motion.div
        className="page-transition__veil page-transition__veil--main"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        exit={{ scaleX: 1 }}
        transition={{ duration: 0.62, ease: [0.76, 0, 0.24, 1] }}
      >
        <motion.div
          className="page-transition__signature"
          initial={{ opacity: 1, x: 0 }}
          animate={{ opacity: 0, x: 22 }}
          exit={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28 }}
        >
          <BrandMark />
          <span className="mono">VELOSTRA / VERIFIED EXECUTION</span>
        </motion.div>
      </motion.div>
      <motion.div
        className="page-transition__content"
        initial={{ opacity: 0, y: 18, scale: 0.996, clipPath: 'inset(0 0 3% 0)' }}
        animate={{ opacity: 1, y: 0, scale: 1, clipPath: 'inset(0 0 0% 0)' }}
        exit={{ opacity: 0, y: -10, scale: 0.998, clipPath: 'inset(3% 0 0 0)' }}
        transition={{ duration: 0.68, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </div>
  )
}