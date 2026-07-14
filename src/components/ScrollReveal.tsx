import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export default function ScrollReveal({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      className="cinematic-reveal"
      initial={reducedMotion ? false : { opacity: 0, y: 58, scale: 0.982, rotateX: 2.2, filter: 'blur(10px)', clipPath: 'inset(0 0 8% 0 round 16px)' }}
      whileInView={reducedMotion ? undefined : { opacity: 1, y: 0, scale: 1, rotateX: 0, filter: 'blur(0px)', clipPath: 'inset(0 0 0% 0 round 0px)' }}
      viewport={{ once: true, margin: '-5% 0px -8%' }}
      transition={{ duration: 1.12, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: '50% 0%', perspective: 1200 }}
    >
      {children}
    </motion.div>
  )
}