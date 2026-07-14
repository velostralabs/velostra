import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, RoundedBox, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import './Scene3DBackground.css'

type MotionInput = MutableRefObject<{
  x: number
  y: number
  scroll: number
  reduced: boolean
}>

function DataModule({
  position,
  rotation,
  accent,
  scale = 1,
}: {
  position: [number, number, number]
  rotation: [number, number, number]
  accent: string
  scale?: number
}) {
  return (
    <Float speed={1.6} rotationIntensity={0.18} floatIntensity={0.35}>
      <group position={position} rotation={rotation} scale={scale}>
        <RoundedBox args={[1.5, 0.86, 0.22]} radius={0.08} smoothness={3}>
          <meshPhysicalMaterial
            color="#10161d"
            metalness={0.72}
            roughness={0.23}
            clearcoat={1}
            clearcoatRoughness={0.16}
          />
        </RoundedBox>
        <RoundedBox args={[1.24, 0.57, 0.025]} radius={0.045} smoothness={4} position={[0, 0, 0.13]}>
          <meshBasicMaterial color="#070b0f" />
        </RoundedBox>
        <mesh position={[-0.42, 0.12, 0.16]}>
          <boxGeometry args={[0.19, 0.16, 0.025]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.2} />
        </mesh>
        <mesh position={[0.17, 0.14, 0.16]}>
          <boxGeometry args={[0.62, 0.045, 0.02]} />
          <meshBasicMaterial color="#68716e" />
        </mesh>
        <mesh position={[0.03, -0.1, 0.16]}>
          <boxGeometry args={[0.88, 0.035, 0.02]} />
          <meshBasicMaterial color={accent} transparent opacity={0.5} />
        </mesh>
      </group>
    </Float>
  )
}

function ExecutionArtifact({ input }: { input: MotionInput }) {
  const artifact = useRef<THREE.Group>(null)
  const core = useRef<THREE.Group>(null)
  const scan = useRef<THREE.Mesh>(null)

  useFrame((state, delta) => {
    if (!artifact.current || !core.current || !scan.current) return
    const time = state.clock.elapsedTime
    const motion = input.current
    const multiplier = motion.reduced ? 0 : 1

    artifact.current.rotation.x = THREE.MathUtils.damp(
      artifact.current.rotation.x,
      -0.12 + motion.y * 0.13 * multiplier + motion.scroll * 0.025,
      4,
      delta
    )
    artifact.current.rotation.y = THREE.MathUtils.damp(
      artifact.current.rotation.y,
      0.18 + motion.x * 0.22 * multiplier,
      4,
      delta
    )
    artifact.current.rotation.z = THREE.MathUtils.damp(
      artifact.current.rotation.z,
      -0.055 + motion.x * 0.025 * multiplier,
      3,
      delta
    )
    artifact.current.position.y = Math.sin(time * 0.72) * 0.09 * multiplier - motion.scroll * 0.12
    core.current.position.z = 0.77 + Math.sin(time * 1.35) * 0.045 * multiplier
    scan.current.position.y = motion.reduced ? 0 : ((time * 0.7) % 3.3) - 1.65
  })

  return (
    <group ref={artifact} scale={0.86}>
      <RoundedBox args={[4.25, 5.18, 0.62]} radius={0.2} smoothness={4}>
        <meshPhysicalMaterial
          color="#080c12"
          metalness={0.84}
          roughness={0.2}
          clearcoat={1}
          clearcoatRoughness={0.12}
        />
      </RoundedBox>

      <RoundedBox args={[3.84, 4.75, 0.1]} radius={0.14} smoothness={3} position={[0, 0, 0.35]}>
        <meshPhysicalMaterial
          color="#111821"
          metalness={0.5}
          roughness={0.28}
          transparent
          opacity={0.92}
        />
      </RoundedBox>

      <RoundedBox args={[3.45, 4.25, 0.055]} radius={0.1} smoothness={3} position={[0, 0, 0.43]}>
        <meshBasicMaterial color="#06090d" />
      </RoundedBox>

      <group ref={core} position={[0, 0.05, 0.77]}>
        <RoundedBox
          args={[0.5, 2.75, 0.3]}
          radius={0.12}
          smoothness={3}
          position={[-0.53, 0.18, 0]}
          rotation={[0, 0, 0.42]}
        >
          <meshStandardMaterial
            color="#c9ff5f"
            emissive="#8ecb36"
            emissiveIntensity={1.25}
            metalness={0.25}
            roughness={0.17}
          />
        </RoundedBox>
        <RoundedBox
          args={[0.5, 2.75, 0.3]}
          radius={0.12}
          smoothness={3}
          position={[0.53, 0.18, 0]}
          rotation={[0, 0, -0.42]}
        >
          <meshStandardMaterial
            color="#8fe9dc"
            emissive="#3f8f86"
            emissiveIntensity={1.1}
            metalness={0.25}
            roughness={0.17}
          />
        </RoundedBox>
        <mesh position={[0, -1.03, 0.03]} rotation={[0, 0, Math.PI / 4]}>
          <octahedronGeometry args={[0.39, 0]} />
          <meshPhysicalMaterial
            color="#efffd0"
            emissive="#c9ff5f"
            emissiveIntensity={0.65}
            metalness={0.38}
            roughness={0.08}
            clearcoat={1}
          />
        </mesh>
      </group>

      <mesh ref={scan} position={[0, -1.5, 0.62]}>
        <boxGeometry args={[3.08, 0.012, 0.018]} />
        <meshBasicMaterial color="#c9ff5f" transparent opacity={0.34} />
      </mesh>

      <group position={[0, -1.78, 0.52]}>
        {[-1.1, -0.55, 0, 0.55, 1.1].map((x, index) => (
          <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[index === 2 ? 0.34 : 0.42, 0.07, 0.04]} />
            <meshBasicMaterial
              color={index === 2 ? '#c9ff5f' : '#39433f'}
              transparent
              opacity={index === 2 ? 0.9 : 0.65}
            />
          </mesh>
        ))}
      </group>

      <DataModule position={[-2.85, 1.65, 0.08]} rotation={[0.05, 0.38, -0.08]} accent="#c9ff5f" />
      <DataModule position={[2.82, -1.45, -0.05]} rotation={[-0.05, -0.42, 0.06]} accent="#8fe9dc" scale={0.92} />

      <Float speed={1.2} rotationIntensity={0.28} floatIntensity={0.42}>
        <mesh position={[2.75, 1.75, -0.45]} rotation={[0.4, 0.25, 0.7]}>
          <tetrahedronGeometry args={[0.34, 0]} />
          <meshStandardMaterial color="#d6b684" metalness={0.8} roughness={0.18} />
        </mesh>
      </Float>
      <Float speed={1.4} rotationIntensity={0.3} floatIntensity={0.5}>
        <mesh position={[-2.5, -2.05, -0.35]} rotation={[0.2, -0.3, 0.4]}>
          <octahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial color="#8fe9dc" metalness={0.65} roughness={0.2} />
        </mesh>
      </Float>
    </group>
  )
}

function ArtifactScene({ input }: { input: MotionInput }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6, 5]} intensity={2.2} color="#f3ffe2" />
      <pointLight position={[-4, 1, 4]} intensity={28} distance={10} color="#8fe9dc" />
      <pointLight position={[4, -2, 3]} intensity={24} distance={9} color="#c9ff5f" />
      <ExecutionArtifact input={input} />
      <Sparkles count={20} scale={[8, 7, 4]} size={1.3} speed={0.22} opacity={0.42} color="#dce7df" />
    </>
  )
}

export default function Scene3DBackground() {
  const [mounted, setMounted] = useState(false)
  const [active, setActive] = useState(true)
  const [reduced, setReduced] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const input = useRef({ x: 0, y: 0, scroll: 0, reduced: false })

  useEffect(() => {
    setMounted(true)

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const root = rootRef.current
    let intersecting = true

    const syncMotion = () => {
      input.current.reduced = motionQuery.matches
      setReduced(motionQuery.matches)
    }
    const syncActivity = () => setActive(intersecting && !document.hidden)
    const observer = new IntersectionObserver(
      ([entry]) => {
        intersecting = entry.isIntersecting
        syncActivity()
      },
      { rootMargin: '140px' }
    )
    if (root) observer.observe(root)

    const handlePointer = (event: PointerEvent) => {
      if (!intersecting) return
      input.current.x = (event.clientX / window.innerWidth) * 2 - 1
      input.current.y = -((event.clientY / window.innerHeight) * 2 - 1)
    }
    const handleScroll = () => {
      if (!intersecting) return
      input.current.scroll = Math.min(window.scrollY / Math.max(window.innerHeight, 1), 2)
    }

    syncMotion()
    syncActivity()
    motionQuery.addEventListener('change', syncMotion)
    document.addEventListener('visibilitychange', syncActivity)
    window.addEventListener('pointermove', handlePointer, { passive: true })
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      motionQuery.removeEventListener('change', syncMotion)
      document.removeEventListener('visibilitychange', syncActivity)
      window.removeEventListener('pointermove', handlePointer)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  if (!mounted) return <div className="scene3d scene3d--fallback" />

  return (
    <div ref={rootRef} className="scene3d" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 9.6], fov: 38 }}
        dpr={[1, 1.3]}
        frameloop={active && !reduced ? 'always' : 'demand'}
        performance={{ min: 0.55 }}
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      >
        <ArtifactScene input={input} />
      </Canvas>
    </div>
  )
}
