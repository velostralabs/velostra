import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Edges, Float, Line, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import './Scene3DBackground.css'

type MotionInput = MutableRefObject<{
  x: number
  y: number
  scroll: number
  reduced: boolean
}>

type CrystalFacet = {
  color: string
  opacity: number
  shape: THREE.Shape
}

const makeShape = (points: Array<[number, number]>) => {
  const shape = new THREE.Shape()
  points.forEach(([x, y], index) => index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y))
  shape.closePath()
  return shape
}

const leftCrystalWing = makeShape([[-1.82, 2.24], [-0.52, 1.02], [-0.1, -0.28], [-0.1, -2.16], [-0.91, -1.16], [-1.5, 0.2]])
const rightCrystalWing = makeShape([[1.82, 2.24], [0.52, 1.02], [0.1, -0.28], [0.1, -2.16], [0.91, -1.16], [1.5, 0.2]])
const leftCrystalFacets: CrystalFacet[] = [
  { shape: makeShape([[-1.82, 2.24], [-0.52, 1.02], [-1.29, 1.24]]), color: '#f4ffc4', opacity: 0.78 },
  { shape: makeShape([[-1.82, 2.24], [-1.29, 1.24], [-1.5, 0.2]]), color: '#86c81e', opacity: 0.6 },
  { shape: makeShape([[-0.52, 1.02], [-0.1, -0.28], [-0.82, 0.34]]), color: '#ddff82', opacity: 0.62 },
  { shape: makeShape([[-0.82, 0.34], [-0.1, -0.28], [-0.1, -2.16], [-0.91, -1.16]]), color: '#173803', opacity: 0.72 },
]
const rightCrystalFacets: CrystalFacet[] = [
  { shape: makeShape([[1.82, 2.24], [0.52, 1.02], [1.29, 1.24]]), color: '#f6ffd0', opacity: 0.84 },
  { shape: makeShape([[1.82, 2.24], [1.29, 1.24], [1.5, 0.2]]), color: '#9bdd2d', opacity: 0.62 },
  { shape: makeShape([[0.52, 1.02], [0.1, -0.28], [0.82, 0.34]]), color: '#e5ff91', opacity: 0.66 },
  { shape: makeShape([[0.82, 0.34], [0.1, -0.28], [0.1, -2.16], [0.91, -1.16]]), color: '#214604', opacity: 0.7 },
]

const signalCurves = [
  new THREE.CubicBezierCurve3(
    new THREE.Vector3(-4.7, 1.55, -0.9),
    new THREE.Vector3(-3.1, 2.5, 0.2),
    new THREE.Vector3(-2.3, 0.15, 0.7),
    new THREE.Vector3(-0.75, 0.45, 0.55),
  ),
  new THREE.CubicBezierCurve3(
    new THREE.Vector3(4.65, 1.7, -1.1),
    new THREE.Vector3(3.15, 2.8, -0.1),
    new THREE.Vector3(2.35, 0.2, 0.7),
    new THREE.Vector3(0.78, 0.48, 0.52),
  ),
  new THREE.CubicBezierCurve3(
    new THREE.Vector3(-4.5, -1.82, -1.35),
    new THREE.Vector3(-2.7, -2.7, -0.1),
    new THREE.Vector3(-2.05, -0.7, 0.4),
    new THREE.Vector3(-0.68, -0.62, 0.55),
  ),
  new THREE.CubicBezierCurve3(
    new THREE.Vector3(4.45, -1.74, -1.25),
    new THREE.Vector3(2.8, -2.65, -0.05),
    new THREE.Vector3(2.1, -0.72, 0.44),
    new THREE.Vector3(0.7, -0.62, 0.56),
  ),
]

function CrystalWing({ shape, facets, color }: { shape: THREE.Shape; facets: CrystalFacet[]; color: string }) {
  return (
    <group>
      <mesh castShadow>
        <extrudeGeometry args={[shape, { depth: 0.42, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.045, bevelThickness: 0.06 }]} />
        <meshPhysicalMaterial
          color={color}
          emissive="#4e780d"
          emissiveIntensity={0.12}
          metalness={0.18}
          roughness={0.11}
          clearcoat={1}
          clearcoatRoughness={0.06}
          reflectivity={1}
        />
        <Edges threshold={10} color="#eaffae" scale={1.001} />
      </mesh>
      {facets.map((facet, index) => (
        <mesh key={index} position={[0, 0, 0.49]}>
          <shapeGeometry args={[facet.shape]} />
          <meshBasicMaterial color={facet.color} transparent opacity={facet.opacity} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function CrystalV() {
  return (
    <group scale={0.92}>
      <group position={[0, 0, -0.14]} scale={1.035}>
        <mesh>
          <extrudeGeometry args={[leftCrystalWing, { depth: 0.18, bevelEnabled: false }]} />
          <meshBasicMaterial color="#78ff86" transparent opacity={0.1} wireframe />
        </mesh>
        <mesh>
          <extrudeGeometry args={[rightCrystalWing, { depth: 0.18, bevelEnabled: false }]} />
          <meshBasicMaterial color="#c9ff5f" transparent opacity={0.1} wireframe />
        </mesh>
      </group>
      <CrystalWing shape={leftCrystalWing} facets={leftCrystalFacets} color="#8ed321" />
      <CrystalWing shape={rightCrystalWing} facets={rightCrystalFacets} color="#b8ef3e" />
      <mesh position={[0, -2.24, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.48, 0.48, 0.014, 64]} />
        <meshBasicMaterial color="#d7ff75" transparent opacity={0.34} toneMapped={false} />
      </mesh>
    </group>
  )
}

function SignalNetwork({ reduced }: { reduced: boolean }) {
  const packetRefs = useRef<Array<THREE.Mesh | null>>([])
  const pulseRefs = useRef<Array<THREE.Mesh | null>>([])
  const pointSets = useMemo(() => signalCurves.map((curve) => curve.getPoints(52)), [])

  useFrame((state) => {
    const time = reduced ? 0 : state.clock.elapsedTime
    packetRefs.current.forEach((packet, index) => {
      if (!packet) return
      const progress = (time * (0.12 + index * 0.012) + index * 0.22) % 1
      packet.position.copy(signalCurves[index].getPointAt(progress))
      const intensity = 0.72 + Math.sin(time * 5 + index) * 0.18
      packet.scale.setScalar(intensity)
    })
    pulseRefs.current.forEach((pulse, index) => {
      if (!pulse) return
      const scale = 1 + Math.sin(time * 2.4 + index * 0.8) * 0.26
      pulse.scale.setScalar(scale)
    })
  })

  return (
    <group>
      {pointSets.map((points, index) => (
        <group key={index}>
          <Line
            points={points}
            color={index % 2 === 0 ? '#c9ff5f' : '#8fe9dc'}
            lineWidth={0.72}
            transparent
            opacity={0.28}
          />
          <mesh ref={(node) => { packetRefs.current[index] = node }}>
            <sphereGeometry args={[0.072, 18, 18]} />
            <meshBasicMaterial color={index % 2 === 0 ? '#d7ff7a' : '#a8fff1'} toneMapped={false} />
          </mesh>
          <mesh ref={(node) => { pulseRefs.current[index] = node }} position={signalCurves[index].getPointAt(0)}>
            <octahedronGeometry args={[0.13, 0]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? '#b9f044' : '#80d9cd'}
              emissive={index % 2 === 0 ? '#6d9d16' : '#24746b'}
              emissiveIntensity={0.7}
              metalness={0.55}
              roughness={0.18}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function KineticRings({ reduced }: { reduced: boolean }) {
  const ringOne = useRef<THREE.Group>(null)
  const ringTwo = useRef<THREE.Group>(null)
  const ringThree = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (reduced) return
    if (ringOne.current) ringOne.current.rotation.z += delta * 0.095
    if (ringTwo.current) ringTwo.current.rotation.z -= delta * 0.14
    if (ringThree.current) ringThree.current.rotation.y += delta * 0.11
  })

  return (
    <group position={[0, 0, -0.58]}>
      <group ref={ringOne} rotation={[0.12, 0.06, 0.1]}>
        <mesh>
          <torusGeometry args={[3.05, 0.012, 8, 180]} />
          <meshBasicMaterial color="#9bdc68" transparent opacity={0.28} toneMapped={false} />
        </mesh>
        {[0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].map((angle) => (
          <mesh key={angle} position={[Math.cos(angle) * 3.05, Math.sin(angle) * 3.05, 0]}>
            <sphereGeometry args={[0.055, 14, 14]} />
            <meshBasicMaterial color="#c9ff5f" toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group ref={ringTwo} rotation={[0.18, -0.08, -0.25]}>
        <mesh>
          <torusGeometry args={[2.52, 0.008, 8, 160]} />
          <meshBasicMaterial color="#8fe9dc" transparent opacity={0.2} toneMapped={false} />
        </mesh>
        <mesh rotation={[0, 0, 0.88]}>
          <torusGeometry args={[2.52, 0.028, 8, 24, 0.72]} />
          <meshBasicMaterial color="#c9ff5f" transparent opacity={0.74} toneMapped={false} />
        </mesh>
      </group>
      <group ref={ringThree} rotation={[1.02, 0.28, 0]}>
        <mesh>
          <torusGeometry args={[2.16, 0.008, 8, 150]} />
          <meshBasicMaterial color="#d9e8df" transparent opacity={0.14} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function ExecutionCore({ input }: { input: MotionInput }) {
  const root = useRef<THREE.Group>(null)
  const crystal = useRef<THREE.Group>(null)
  const scan = useRef<THREE.Mesh>(null)
  const platform = useRef<THREE.Mesh>(null)

  useFrame((state, delta) => {
    if (!root.current || !crystal.current || !scan.current || !platform.current) return
    const time = state.clock.elapsedTime
    const motion = input.current
    const multiplier = motion.reduced ? 0 : 1

    root.current.rotation.x = THREE.MathUtils.damp(
      root.current.rotation.x,
      -0.04 + motion.y * 0.1 * multiplier + motion.scroll * 0.018,
      4.4,
      delta,
    )
    root.current.rotation.y = THREE.MathUtils.damp(
      root.current.rotation.y,
      motion.x * 0.18 * multiplier,
      4.4,
      delta,
    )
    root.current.position.y = THREE.MathUtils.damp(root.current.position.y, -motion.scroll * 0.12, 3.2, delta)
    crystal.current.position.y = Math.sin(time * 0.75) * 0.095 * multiplier + 0.16
    crystal.current.rotation.y = Math.sin(time * 0.38) * 0.055 * multiplier
    scan.current.position.y = motion.reduced ? 0 : ((time * 0.76) % 4.7) - 2.35
    platform.current.scale.x = 1 + Math.sin(time * 1.05) * 0.055 * multiplier
    platform.current.scale.z = 1 + Math.sin(time * 1.05) * 0.055 * multiplier
  })

  return (
    <group ref={root} scale={0.94}>
      <KineticRings reduced={input.current.reduced} />
      <SignalNetwork reduced={input.current.reduced} />

      <group ref={crystal} position={[0, 0.16, 0.5]}>
        <CrystalV />
      </group>

      <mesh ref={scan} position={[0, -2.2, 0.9]}>
        <planeGeometry args={[4.3, 0.012]} />
        <meshBasicMaterial color="#c9ff5f" transparent opacity={0.25} toneMapped={false} />
      </mesh>

      <mesh ref={platform} position={[0, -2.34, -0.24]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.72, 2.45, 96]} />
        <meshBasicMaterial
          color="#a7ec3e"
          transparent
          opacity={0.095}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, -2.38, -0.38]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.5, 96]} />
        <meshBasicMaterial color="#08100b" transparent opacity={0.72} side={THREE.DoubleSide} />
      </mesh>

      <Float speed={1.15} rotationIntensity={0.26} floatIntensity={0.4}>
        <mesh position={[3.45, 2.25, -0.72]} rotation={[0.4, 0.25, 0.7]}>
          <icosahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial color="#d6b684" metalness={0.86} roughness={0.15} />
        </mesh>
      </Float>
      <Float speed={1.35} rotationIntensity={0.3} floatIntensity={0.46}>
        <mesh position={[-3.35, -2.22, -0.58]} rotation={[0.2, -0.3, 0.4]}>
          <octahedronGeometry args={[0.18, 0]} />
          <meshStandardMaterial color="#8fe9dc" emissive="#286e67" emissiveIntensity={0.34} metalness={0.72} roughness={0.16} />
        </mesh>
      </Float>
    </group>
  )
}

function CoreScene({ input }: { input: MotionInput }) {
  return (
    <>
      <ambientLight intensity={0.42} />
      <hemisphereLight intensity={0.7} color="#efffde" groundColor="#030609" />
      <directionalLight position={[4, 7, 6]} intensity={3.1} color="#f4ffe7" />
      <directionalLight position={[-5, -1, 3]} intensity={1.7} color="#8fe9dc" />
      <pointLight position={[-4, 1.5, 4]} intensity={34} distance={11} color="#8fe9dc" />
      <pointLight position={[4, -1.2, 3.5]} intensity={39} distance={10} color="#c9ff5f" />
      <pointLight position={[0, 3.5, 1]} intensity={22} distance={8} color="#e9ffb4" />
      <ExecutionCore input={input} />
      <Sparkles count={42} scale={[10, 7.8, 5]} size={1.05} speed={0.28} opacity={0.48} color="#dce7df" />
    </>
  )
}

function FrameDriver({ active, pauseUntil }: { active: boolean; pauseUntil: MutableRefObject<number> }) {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    if (!active) return
    let frame = 0
    let lastFrame = 0

    const render = (time: number) => {
      if (time >= pauseUntil.current && time - lastFrame >= 1000 / 60) {
        lastFrame = time
        invalidate()
      }
      frame = window.requestAnimationFrame(render)
    }

    frame = window.requestAnimationFrame(render)
    return () => window.cancelAnimationFrame(frame)
  }, [active, invalidate, pauseUntil])

  return null
}

export default function Scene3DBackground() {
  const [mounted, setMounted] = useState(false)
  const [active, setActive] = useState(true)
  const [reduced, setReduced] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const pauseUntil = useRef(0)
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
      { rootMargin: '140px' },
    )
    if (root) observer.observe(root)

    const handlePointer = (event: PointerEvent) => {
      if (!intersecting) return
      input.current.x = (event.clientX / window.innerWidth) * 2 - 1
      input.current.y = -((event.clientY / window.innerHeight) * 2 - 1)
    }
    const handleInteraction = () => {
      pauseUntil.current = performance.now() + 420
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
    window.addEventListener('pointerdown', handleInteraction, { passive: true, capture: true })
    window.addEventListener('keydown', handleInteraction, { passive: true, capture: true })
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      motionQuery.removeEventListener('change', syncMotion)
      document.removeEventListener('visibilitychange', syncActivity)
      window.removeEventListener('pointermove', handlePointer)
      window.removeEventListener('pointerdown', handleInteraction, { capture: true })
      window.removeEventListener('keydown', handleInteraction, { capture: true })
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  if (!mounted) return <div className="scene3d scene3d--fallback" />

  return (
    <div ref={rootRef} className="scene3d" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0.05, 10.6], fov: 39 }}
        dpr={[1.4, 2]}
        frameloop="demand"
        performance={{ min: 0.72 }}
        resize={{ debounce: 0 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', precision: 'highp' }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.08
        }}
      >
        <FrameDriver active={active && !reduced} pauseUntil={pauseUntil} />
        <CoreScene input={input} />
      </Canvas>
    </div>
  )
}
