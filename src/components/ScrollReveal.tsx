import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export default function ScrollReveal({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      className="cinematic-reveal"
      initial={reducedMotion ? false : {
        opacity: 0.01,
        y: 26,
        scale: 0.996,
        rotateX: 0.5,
        clipPath: 'inset(0 0 2% 0 round 10px)',
      }}
      whileInView={reducedMotion ? undefined : {
        opacity: 1,
        y: 0,
        scale: 1,
        rotateX: 0,
        clipPath: 'inset(0 0 0% 0 round 0px)',
      }}
      viewport={{ once: true, margin: '-4% 0px -7%' }}
      transition={{ duration: 0.82, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: '50% 0%', perspective: 1400 }}
    >
      {children}
    </motion.div>
  )
}
