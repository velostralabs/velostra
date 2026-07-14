import { useEffect } from 'react'
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring } from 'framer-motion'

export default function InterfaceEffects() {
  const reducedMotion = useReducedMotion()
  const rawX = useMotionValue(-700)
  const rawY = useMotionValue(-700)
  const cursorRawX = useMotionValue(-80)
  const cursorRawY = useMotionValue(-80)
  const cursorScaleRaw = useMotionValue(0.75)
  const cursorOpacity = useMotionValue(0)
  const x = useSpring(rawX, { stiffness: 82, damping: 24, mass: 0.45 })
  const y = useSpring(rawY, { stiffness: 82, damping: 24, mass: 0.45 })
  const lagX = useSpring(rawX, { stiffness: 24, damping: 20, mass: 0.9 })
  const lagY = useSpring(rawY, { stiffness: 24, damping: 20, mass: 0.9 })
  const cursorX = useSpring(cursorRawX, { stiffness: 420, damping: 34, mass: 0.18 })
  const cursorY = useSpring(cursorRawY, { stiffness: 420, damping: 34, mass: 0.18 })
  const cursorScale = useSpring(cursorScaleRaw, { stiffness: 330, damping: 24, mass: 0.2 })
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 130, damping: 28, mass: 0.22 })

  useEffect(() => {
    if (reducedMotion) return

    let frame = 0
    const handlePointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        cursorOpacity.set(0)
        return
      }
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        rawX.set(event.clientX - 260)
        rawY.set(event.clientY - 260)
        cursorRawX.set(event.clientX - 11)
        cursorRawY.set(event.clientY - 11)
        cursorOpacity.set(event.pointerType === 'mouse' ? 1 : 0)
      })
    }
    const handlePointerOver = (event: PointerEvent) => {
      const target = event.target as Element | null
      cursorScaleRaw.set(target?.closest('a, button, [role="button"], input, select, textarea') ? 1.85 : 0.82)
    }
    const handlePointerDown = () => cursorScaleRaw.set(0.58)
    const handlePointerUp = (event: PointerEvent) => {
      const target = event.target as Element | null
      cursorScaleRaw.set(target?.closest('a, button, [role="button"]') ? 1.85 : 0.82)
    }
    const handlePointerLeave = () => cursorOpacity.set(0)

    window.addEventListener('pointermove', handlePointer, { passive: true })
    window.addEventListener('pointerover', handlePointerOver, { passive: true })
    window.addEventListener('pointerdown', handlePointerDown, { passive: true })
    window.addEventListener('pointerup', handlePointerUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', handlePointerLeave)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', handlePointer)
      window.removeEventListener('pointerover', handlePointerOver)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
      document.documentElement.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [cursorOpacity, cursorRawX, cursorRawY, cursorScaleRaw, rawX, rawY, reducedMotion])

  return (
    <>
      {!reducedMotion && (
        <>
          <motion.div className="ambient-follow ambient-follow--lag" style={{ x: lagX, y: lagY }} aria-hidden="true" />
          <motion.div className="ambient-follow" style={{ x, y }} aria-hidden="true" />
          <motion.div
            className="interface-reticle"
            style={{ x: cursorX, y: cursorY, scale: cursorScale, opacity: cursorOpacity }}
            aria-hidden="true"
          ><i /></motion.div>
          <div className="interface-scan" aria-hidden="true" />
        </>
      )}
      <motion.div className="scroll-progress" style={{ scaleX: progress }} aria-hidden="true" />
    </>
  )
}