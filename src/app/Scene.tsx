import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { noEvents, PointerEvents, XR } from '@react-three/xr'
import { PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { BoardContent } from '../board/BoardContent'
import { useView } from '../board/viewStore'
import { PRESET_SIZES } from '../data/placements'
import { useSettings } from '../data/settings'
import { xrStore } from '../xr/session'
import { XRExperience } from '../xr/XRExperience'

/** Procedural studio environment for glossy materials — no HDR download needed (works offline and in AR). */
function Environment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.8
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

/** Dev-only handle for inspecting the scene from the console. */
function DevHandle() {
  const state = useThree()
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __sk: unknown }).__sk = state
  }, [state])
  return null
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a8f98', 0.7]} />
      <directionalLight position={[1.5, 3, 2.5]} intensity={1.1} />
    </>
  )
}

/** Desktop 3D view (no XR): the board hangs on a studio wall; orbit with the mouse. */
function DesktopScene({ dark }: { dark: boolean }) {
  const preset = useSettings((s) => s.scalePreset)
  const size = PRESET_SIZES[preset]
  const centerY = 1.45
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))
  // Fit the board (plus a margin) to the narrower of the two view axes.
  const dist = Math.max(0.6, Math.max((size[1] * 1.25) / (2 * Math.tan((22.5 * Math.PI) / 180)), (size[0] * 1.12) / (2 * Math.tan((22.5 * Math.PI) / 180) * aspect)))
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    camera.position.set(0, centerY + 0.05, dist)
    camera.lookAt(0, centerY, 0)
  }, [camera, dist])
  const wall = dark ? '#1a1f27' : '#e9e6e0'
  const floor = dark ? '#12161c' : '#cfc9bf'
  return (
    <>
      <color attach="background" args={[dark ? '#0d1117' : '#efece6']} />
      <fog attach="fog" args={[dark ? '#0d1117' : '#efece6', 6, 14]} />
      <mesh position={[0, 2, -0.02]} raycast={() => {}}>
        <planeGeometry args={[12, 4]} />
        <meshStandardMaterial color={wall} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 3]} raycast={() => {}}>
        <planeGeometry args={[12, 6.04]} />
        <meshStandardMaterial color={floor} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.05, -0.012]} raycast={() => {}}>
        <boxGeometry args={[12, 0.1, 0.02]} />
        <meshStandardMaterial color={dark ? '#20262f' : '#f7f5f0'} roughness={0.7} />
      </mesh>
      <group position={[0, centerY, 0.012]}>
        <BoardContent size={size} dark={dark} />
      </group>
      <OrbitControls
        makeDefault
        target={[0, centerY, 0]}
        enableDamping
        dampingFactor={0.12}
        minDistance={0.35}
        maxDistance={5}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2 + 0.05}
        minAzimuthAngle={-1.1}
        maxAzimuthAngle={1.1}
        zoomSpeed={0.7}
      />
    </>
  )
}

export function Scene({ dark }: { dark: boolean }) {
  const mode = useView((s) => s.mode)
  const dpr = useMemo<[number, number]>(() => [1, Math.min(2, window.devicePixelRatio || 1)], [])
  return (
    <Canvas
      events={noEvents}
      frameloop={mode === '2d' ? 'never' : 'always'}
      dpr={dpr}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 45, near: 0.02, far: 60, position: [0, 1.5, 2] }}
      style={{ touchAction: 'none' }}
    >
      <PointerEvents />
      <XR store={xrStore}>
        <Environment />
        <Lights />
        {import.meta.env.DEV && <DevHandle />}
        {mode === 'xr' ? <XRExperience dark /> : <DesktopScene dark={dark} />}
      </XR>
    </Canvas>
  )
}
