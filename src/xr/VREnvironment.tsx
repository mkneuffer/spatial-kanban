import { useMemo } from 'react'
import { BackSide, CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

/** Without passthrough (immersive-vr), give the board a calm room: soft sky dome and a floor grid. */
export function VREnvironment() {
  const grid = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = '#20252c'
    g.fillRect(0, 0, 256, 256)
    g.strokeStyle = 'rgba(255,255,255,0.08)'
    g.lineWidth = 2
    g.strokeRect(0, 0, 256, 256)
    const t = new CanvasTexture(c)
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(40, 40)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [])
  return (
    <group>
      <mesh raycast={() => {}}>
        <sphereGeometry args={[40, 32, 16]} />
        <meshBasicMaterial color="#2a3240" side={BackSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
        <circleGeometry args={[20, 64]} />
        <meshStandardMaterial map={grid} roughness={0.95} />
      </mesh>
    </group>
  )
}
