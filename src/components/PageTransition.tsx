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
        transition={{ duration: 0.92, delay: 0.04, ease: [0.76, 0, 0.24, 1] }}
      />
      <motion.div
        className="page-transition__veil page-transition__veil--main"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        exit={{ scaleX: 1 }}
        transition={{ duration: 0.78, ease: [0.76, 0, 0.24, 1] }}
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
        initial={{ opacity: 0, y: 24, scale: 0.992, filter: 'blur(9px)', clipPath: 'inset(0 0 7% 0)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', clipPath: 'inset(0 0 0% 0)' }}
        exit={{ opacity: 0, y: -14, scale: 0.996, filter: 'blur(5px)', clipPath: 'inset(5% 0 0 0)' }}
        transition={{ duration: 0.84, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </div>
  )
}