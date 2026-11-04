import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useXR } from '@react-three/xr'
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Object3D,
} from 'three'
import { useBoardStore } from '../../data/store'
import { useSettings } from '../../data/settings'
import { playSound } from '../../fx/audio'
import { pulse } from '../../fx/haptics'
import { gamepadOf, inputSourceOf, isPrimaryButton, pointerKindOf, type XPointerEvent } from '../../board/BoardInteraction'
import { useBoardRuntime } from '../../board/runtime'
import type { P2 } from '../../render/strokes'
import { MARKER_ORDER, MARKERS, useInk, type InkGhost, type InkStroke, type MarkerId, type ToolId } from './ink'

/**
 * Working whiteboard markers and eraser (the tray on the bottom edge).
 *
 * - Pick one up from the tray: click / tap / pull the trigger on it, or grab it
 *   with a hand or controller.
 * - Mouse, touch and far rays draw where they point while pressed. Click the
 *   tray (or press Esc) to put the tool back.
 * - Held in a hand or controller, the tool works like a real one: press the nib
 *   against the board to draw. The board pushes back (the marker never sinks
 *   in), and you feel a buzz while the nib drags. Let go and it drops back
 *   into the tray.
 */

/** Real-world sizes (m). Tools don't scale with the board; a marker is a marker. */
export const MARKER_LEN = 0.147
export const MARKER_R = 0.0097
const NIB_TIP = -0.0745 // nib tip on the marker's local z axis (tip points along -z)
/** Eraser block; the felt pad faces -z, its face at z = -ERASER.d / 2. */
const ERASER = { w: 0.13, h: 0.05, d: 0.0415 }
const ERASE_RADIUS = 0.028
/** The nib touches the board when it's this close to the surface (m). */
const CONTACT = 0.0035
/** After pick-up, the tool must be this far off the board (or off its edges) before it writes. */
const ARM_HEIGHT = 0.02
/** Ink sits just above the melamine, under the notes. */
const INK_Z = 0.0009

export interface TrayGeometry {
  /** Tray center x (board-local) and width. */
  x: number
  w: number
  /** Top of the tray ledge (y) and the z where tools rest. */
  top: number
  z: number
  k: number
}

// ─── shared materials & geometry ──────────────────────────────────────────────

function streakTexture() {
  // Dry-erase ink isn't flat: it's slightly streaky along the stroke, with denser edges.
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 32
  const g = c.getContext('2d')!
  const img = g.createImageData(64, 32)
  for (let y = 0; y < 32; y++) {
    const across = Math.abs(y / 31 - 0.5) * 2 // 0 center → 1 edge
    const edge = across > 0.92 ? 0.35 : across > 0.78 ? 1 : 0.86
    for (let x = 0; x < 64; x++) {
      const streak = 0.9 + 0.1 * Math.sin(y * 1.7 + Math.sin(x * 0.2) * 0.6)
      const a = Math.max(0, Math.min(1, edge * streak * (0.94 + Math.random() * 0.06)))
      const i = (y * 64 + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  g.putImageData(img, 0, 0)
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  return t
}

let shared: ReturnType<typeof createShared> | null = null
function createShared() {
  const streak = streakTexture()
  const ink = new MeshBasicMaterial({ vertexColors: true, transparent: true, map: streak, depthWrite: false, side: DoubleSide })
  const ghost = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.07, depthWrite: false, side: DoubleSide })
  const plastic = (color: string, rough = 0.38) => new MeshPhysicalMaterial({ color, roughness: rough, clearcoat: 0.6, clearcoatRoughness: 0.25 })
  const barrel = plastic('#f3f3f1', 0.42)
  const markerParts = Object.fromEntries(
    MARKER_ORDER.map((id) => [
      id,
      { cap: plastic(MARKERS[id].body, 0.3), nib: new MeshStandardMaterial({ color: new Color(MARKERS[id].ink).offsetHSL(0, 0, 0.06), roughness: 0.95 }) },
    ]),
  ) as Record<MarkerId, { cap: MeshPhysicalMaterial; nib: MeshStandardMaterial }>
  const collar = new MeshStandardMaterial({ color: '#d9d9d6', roughness: 0.5 })
  const eraserBody = plastic('#2d3748', 0.45)
  const felt = new MeshStandardMaterial({ color: '#d8d3c7', roughness: 1 })
  const g = {
    barrel: new CylinderGeometry(MARKER_R * 0.96, MARKER_R, 0.098, 20, 1).rotateX(Math.PI / 2).translate(0, 0, 0.004),
    band: new CylinderGeometry(MARKER_R * 1.01, MARKER_R * 1.01, 0.03, 20, 1).rotateX(Math.PI / 2).translate(0, 0, -0.012),
    endPlug: new CylinderGeometry(MARKER_R * 0.9, MARKER_R * 0.96, 0.012, 20, 1).rotateX(Math.PI / 2).translate(0, 0, 0.059),
    collar: new CylinderGeometry(MARKER_R * 0.95, MARKER_R * 0.5, 0.012, 20, 1).rotateX(Math.PI / 2).translate(0, 0, -0.051),
    nib: new CylinderGeometry(0.0019, 0.0026, 0.01, 12, 1).rotateX(Math.PI / 2).translate(0, 0, -0.061),
    nibTip: new CylinderGeometry(0.0004, 0.0019, 0.0016, 12, 1).rotateX(Math.PI / 2).translate(0, 0, -0.0666),
    cap: new CylinderGeometry(MARKER_R * 1.12, MARKER_R * 1.12, 0.05, 20, 1).rotateX(Math.PI / 2),
    clip: new BoxGeometry(0.0035, 0.0028, 0.034),
    eraserBody: new BoxGeometry(ERASER.w, ERASER.h, ERASER.d * 0.78).translate(0, 0, ERASER.d * 0.11),
    eraserGrip: new BoxGeometry(ERASER.w * 0.8, ERASER.h * 0.5, ERASER.d * 0.3).translate(0, 0, ERASER.d * 0.6),
    felt: new BoxGeometry(ERASER.w * 0.98, ERASER.h * 0.96, ERASER.d * 0.22).translate(0, 0, -ERASER.d * 0.39),
  }
  return { ink, ghost, barrel, markerParts, collar, eraserBody, felt, g }
}
function sharedRes() {
  shared ??= createShared()
  return shared
}

// ─── ink geometry ─────────────────────────────────────────────────────────────

/** Constant-width ribbons with round caps, one draw call for many strokes. */
function buildInkGeometry(strokes: Array<InkStroke | InkGhost>, z: number): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (const s of strokes) {
    c.set(s.color)
    const pts = s.points
    const n = pts.length
    if (n === 0) continue
    const hw = s.width / 2
    let along = 0
    if (n > 1) {
      const base = pos.length / 3
      for (let i = 0; i < n; i++) {
        const p = pts[i]
        const prev = pts[Math.max(0, i - 1)]
        const next = pts[Math.min(n - 1, i + 1)]
        let tx = next[0] - prev[0]
        let ty = next[1] - prev[1]
        const tl = Math.hypot(tx, ty) || 1
        tx /= tl
        ty /= tl
        if (i > 0) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
        pos.push(p[0] - ty * hw, p[1] + tx * hw, z, p[0] + ty * hw, p[1] - tx * hw, z)
        col.push(c.r, c.g, c.b, c.r, c.g, c.b)
        uv.push(along * 30, 0, along * 30, 1)
        if (i < n - 1) {
          const a = base + i * 2
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
    }
    // Round caps (and dots for single taps).
    const ends = n > 1 ? [pts[0], pts[n - 1]] : [pts[0]]
    for (const p of ends) {
      const center = pos.length / 3
      pos.push(p[0], p[1], z)
      col.push(c.r, c.g, c.b)
      uv.push(0, 0.5)
      const seg = 10
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2
        pos.push(p[0] + Math.cos(a) * hw, p[1] + Math.sin(a) * hw, z)
        col.push(c.r, c.g, c.b)
        uv.push(0, 0.85)
        if (i > 0) idx.push(center, center + i, center + i + 1)
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

function InkLayer({ opacity }: { opacity: number }) {
  const S = sharedRes()
  const meshes = useMemo(() => {
    const m = (mat: MeshBasicMaterial, order: number) => {
      const mesh = new Mesh(new BufferGeometry(), mat)
      mesh.raycast = () => {}
      mesh.renderOrder = order
      return mesh
    }
    return { ghosts: m(S.ghost, -1), ink: m(S.ink, -1), live: m(S.ink, -1) }
  }, [S])
  const version = useInk((s) => s.version)
  const strokes = useInk((s) => s.strokes)
  const ghosts = useInk((s) => s.ghosts)
  useEffect(() => {
    meshes.ink.geometry.dispose()
    meshes.ink.geometry = buildInkGeometry(strokes, INK_Z)
    meshes.ghosts.geometry.dispose()
    meshes.ghosts.geometry = buildInkGeometry(ghosts, INK_Z * 0.6)
  }, [meshes, version, strokes, ghosts])
  // The live stroke changes every frame while drawing; rebuild it outside React.
  useEffect(
    () =>
      useInk.subscribe((s, prev) => {
        if (s.live === prev.live) return
        meshes.live.geometry.dispose()
        meshes.live.geometry = s.live ? buildInkGeometry([s.live], INK_Z * 1.1) : new BufferGeometry()
      }),
    [meshes],
  )
  useEffect(() => {
    S.ink.opacity = opacity * 0.94
    S.ghost.opacity = opacity * 0.07
  }, [S, opacity])
  useEffect(
    () => () => {
      meshes.ink.geometry.dispose()
      meshes.ghosts.geometry.dispose()
      meshes.live.geometry.dispose()
    },
    [meshes],
  )
  return (
    <>
      <primitive object={meshes.ghosts} />
      <primitive object={meshes.ink} />
      <primitive object={meshes.live} />
    </>
  )
}

// ─── tool models ──────────────────────────────────────────────────────────────

// The Alyx-Physics marker and eraser models (public/models/whiteboard-tools). Until they load, or if
// they can't, simple procedural stand-ins of the same size are shown.
type LoadedTools = Record<MarkerId | 'eraser', { geometry: BufferGeometry; material: MeshStandardMaterial }>
let loaded: LoadedTools | null = null
let loading: Promise<LoadedTools | null> | null = null
const loadListeners = new Set<() => void>()

function loadToolModels(): Promise<LoadedTools | null> {
  loading ??= (async () => {
    const base = `${import.meta.env.BASE_URL}models/whiteboard-tools/`
    const gltf = await new GLTFLoader().loadAsync(`${base}tools.glb`)
    const tex = new TextureLoader()
    const map = (url: string, srgb: boolean) => {
      const t = tex.load(url)
      t.flipY = false
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
      t.anisotropy = 4
      return t
    }
    const material = (prefix: string) => {
      const orm = map(`${base}${prefix}_orm.jpg`, false)
      return new MeshStandardMaterial({ map: map(`${base}${prefix}_c.jpg`, true), normalMap: map(`${base}${prefix}_n.jpg`, false), roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1 })
    }
    const geometryOf = (name: string) => {
      let g: BufferGeometry | null = null
      gltf.scene.traverse((o) => {
        if (!g && (o as Mesh).isMesh && (o.name === name || o.parent?.name === name)) g = (o as Mesh).geometry
      })
      if (!g) throw new Error(`missing ${name}`)
      return g as BufferGeometry
    }
    const out = {} as LoadedTools
    for (const id of MARKER_ORDER) out[id] = { geometry: geometryOf(`${MARKERS[id].model}_Mesh`), material: material(MARKERS[id].model) }
    // The eraser's felt faces -y in the model; turn it to face -z like the markers' nibs.
    out.eraser = { geometry: geometryOf('Eraser_Mesh').clone().rotateX(Math.PI / 2), material: material('Alyx_Eraser') }
    loaded = out
    loadListeners.forEach((fn) => fn())
    return out
  })().catch((err) => {
    console.warn('Whiteboard tools: using stand-in models', err)
    return null
  })
  return loading
}

function useToolModels(): LoadedTools | null {
  const [, force] = useState(0)
  useEffect(() => {
    if (loaded) return
    const fn = () => force((n) => n + 1)
    loadListeners.add(fn)
    void loadToolModels()
    return () => void loadListeners.delete(fn)
  }, [])
  return loaded
}

/** A dry-erase marker, nib along -z. `capped`: the stand-in shows its cap on the nib (resting). */
function MarkerModel({ id, capped }: { id: MarkerId; capped: boolean }) {
  const S = sharedRes()
  const models = useToolModels()
  if (models) return <mesh geometry={models[id].geometry} material={models[id].material} />
  const m = S.markerParts[id]
  return (
    <group>
      <mesh geometry={S.g.barrel} material={S.barrel} />
      <mesh geometry={S.g.band} material={m.cap} />
      <mesh geometry={S.g.endPlug} material={m.cap} />
      <mesh geometry={S.g.collar} material={S.collar} />
      <mesh geometry={S.g.nib} material={m.nib} />
      <mesh geometry={S.g.nibTip} material={m.nib} />
      <group position={[0, 0, capped ? -0.047 : 0.072]}>
        <mesh geometry={S.g.cap} material={m.cap} />
        <mesh geometry={S.g.clip} material={m.cap} position={[0, MARKER_R * 1.2, 0.004]} />
      </group>
    </group>
  )
}

/** Eraser, felt face toward -z. */
function EraserModel() {
  const S = sharedRes()
  const models = useToolModels()
  if (models) return <mesh geometry={models.eraser.geometry} material={models.eraser.material} position={[0, 0, (0.019 - 0.0225) / 2]} />
  return (
    <group>
      <mesh geometry={S.g.eraserBody} material={S.eraserBody} />
      <mesh geometry={S.g.eraserGrip} material={S.eraserBody} />
      <mesh geometry={S.g.felt} material={S.felt} />
    </group>
  )
}

function ToolModel({ tool, capped }: { tool: ToolId; capped: boolean }) {
  return tool === 'eraser' ? <EraserModel /> : <MarkerModel id={tool} capped={capped} />
}

// ─── tray slots ───────────────────────────────────────────────────────────────

function slotPose(tool: ToolId, tray: TrayGeometry): { position: [number, number, number]; rotation: [number, number, number] } {
  const i = tool === 'eraser' ? -1 : MARKER_ORDER.indexOf(tool)
  if (i < 0) {
    // Eraser rests felt-down on the right end of the ledge.
    return { position: [tray.x + tray.w / 2 - ERASER.w * 0.62, tray.top + ERASER.d / 2, tray.z], rotation: [Math.PI / 2, 0, 0] }
  }
  // Markers lie along the ledge, nibs pointing left, slightly fanned like they were dropped there.
  const x = tray.x - tray.w / 2 + 0.085 + i * 0.152 * Math.min(1, tray.k)
  return { position: [x, tray.top + MARKER_R * 1.12, tray.z + (i % 2 ? 0.004 : -0.003)], rotation: [0, Math.PI / 2 + (i - 1.5) * 0.035, (i * 0.9) % 1.2] }
}

const _v = new Vector3()
const _m = new Matrix4()
const _inv = new Matrix4()

function toBoardLocal(root: Object3D, world: Vector3, out: Vector3) {
  root.updateWorldMatrix(true, false)
  return out.copy(world).applyMatrix4(_inv.copy(root.matrixWorld).invert())
}

// ─── main component ───────────────────────────────────────────────────────────

export function WhiteboardTools({ size, tray, opacity }: { size: [number, number]; tray: TrayGeometry; opacity: number }) {
  const boardId = useBoardStore((s) => s.doc.board.id)
  const held = useInk((s) => s.held)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const [W, H] = size

  useEffect(() => useInk.getState().load(boardId), [boardId])

  // Mouse users: Esc puts the tool back. Orbiting is off while a tool is in hand, so a drag draws.
  useEffect(() => {
    if (held?.by !== 'pointer') return
    if (controls) controls.enabled = false
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') putBack()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (controls) controls.enabled = true
    }
  }, [held?.by, controls])

  const pickUp = (tool: ToolId) => (raw: unknown) => {
    const e = raw as XPointerEvent
    e.stopPropagation()
    if (!isPrimaryButton(e) || useSettings.getState().skinId !== 'whiteboard') return
    const ink = useInk.getState()
    if (ink.held?.tool === tool) {
      putBack()
      return
    }
    const kind = pointerKindOf(e.pointerType)
    const source = inputSourceOf(e) ?? undefined
    // A pinch or a controller's squeeze holds the tool in hand; a fingertip poke, mouse, touch screen or ray uses it as a pointer.
    const by = kind === 'grab' && source ? 'hand' : 'pointer'
    ink.pick({ tool, by, source })
    playSound(tool === 'eraser' ? 'stick' : 'uncap')
    pulse(gamepadOf(e), 'firm')
  }

  return (
    <group>
      <InkLayer opacity={opacity} />
      {[...MARKER_ORDER, 'eraser' as const].map((tool) => {
        const pose = slotPose(tool, tray)
        const inHand = held?.tool === tool
        return (
          <group key={tool} position={pose.position} rotation={pose.rotation} visible={!inHand}>
            <ToolModel tool={tool} capped />
            {/* A generous invisible handle: small tools are hard to hit with a ray. */}
            <mesh
              visible={false}
              onPointerDown={pickUp(tool)}
              onPointerEnter={(raw: unknown) => {
                ;(raw as XPointerEvent).stopPropagation()
                document.body.style.cursor = 'grab'
              }}
              onPointerLeave={() => {
                document.body.style.cursor = ''
              }}
            >
              {tool === 'eraser' ? <boxGeometry args={[ERASER.w * 1.15, ERASER.h * 1.3, ERASER.d * 1.6]} /> : <boxGeometry args={[MARKER_R * 4, MARKER_R * 4, MARKER_LEN * 1.1]} />}
              <meshBasicMaterial />
            </mesh>
          </group>
        )
      })}
      {held?.by === 'pointer' && <PointerDrawing key={held.tool} tool={held.tool} W={W} H={H} />}
      {held?.by === 'hand' && held.source && <HandDrawing key={held.tool} tool={held.tool} source={held.source} W={W} H={H} />}
    </group>
  )
}

function putBack() {
  const ink = useInk.getState()
  if (!ink.held) return
  ink.pick(null)
  playSound('drop')
}

function inBoard(x: number, y: number, W: number, H: number) {
  return Math.abs(x) <= W / 2 && Math.abs(y) <= H / 2
}

/** Erase along the path from a to b so fast wipes don't skip. */
function eraseAlong(a: P2 | null, b: P2) {
  const ink = useInk.getState()
  if (!a) {
    ink.erase(b, ERASE_RADIUS)
    return
  }
  const d = Math.hypot(b[0] - a[0], b[1] - a[1])
  const steps = Math.max(1, Math.ceil(d / (ERASE_RADIUS * 0.5)))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    ink.erase([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ERASE_RADIUS)
  }
}

// ─── mouse / touch / far ray ──────────────────────────────────────────────────

/** Tilt of a marker held like a pen: nib on the board, the barrel leaning toward the viewer, down and right. */
const PEN_DIR = new Vector3(-0.32, 0.42, -1).normalize()
const PEN_Q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), PEN_DIR)

function PointerDrawing({ tool, W, H }: { tool: ToolId; W: number; H: number }) {
  const runtime = useBoardRuntime()
  const group = useRef<Group>(null)
  const state = useRef({ x: 0, y: 0, visible: false, down: null as number | null, last: null as P2 | null, lastSound: 0, lift: 1 })
  const [, force] = useState(0)

  const at = (raw: unknown): P2 | null => {
    const e = raw as XPointerEvent
    if (!runtime.root || !e.point) return null
    toBoardLocal(runtime.root, e.point, _v)
    return [_v.x, _v.y]
  }
  const handlers = {
    onPointerMove: (raw: unknown) => {
      const e = raw as XPointerEvent
      e.stopPropagation()
      const p = at(e)
      if (!p) return
      const s = state.current
      s.x = p[0]
      s.y = p[1]
      s.visible = true
      if (s.down !== e.pointerId) return
      if (tool === 'eraser') {
        eraseAlong(s.last, p)
      } else {
        useInk.getState().extend(p)
      }
      const now = performance.now()
      if (s.last && now - s.lastSound > 70 && Math.hypot(p[0] - s.last[0], p[1] - s.last[1]) > 0.002) {
        playSound(tool === 'eraser' ? 'wipe' : 'scribble')
        s.lastSound = now
      }
      s.last = p
    },
    onPointerDown: (raw: unknown) => {
      const e = raw as XPointerEvent & { target: { setPointerCapture?(id: number): void } }
      e.stopPropagation()
      if (!isPrimaryButton(e)) return
      const p = at(e)
      if (!p) return
      const s = state.current
      s.down = e.pointerId
      s.last = p
      e.target.setPointerCapture?.(e.pointerId)
      if (tool === 'eraser') eraseAlong(null, p)
      else useInk.getState().begin(MARKERS[tool].ink, MARKERS[tool].width, p)
      pulse(gamepadOf(e), 'tick')
    },
    onPointerUp: (raw: unknown) => {
      const e = raw as XPointerEvent & { target: { releasePointerCapture?(id: number): void } }
      e.stopPropagation()
      const s = state.current
      if (s.down !== e.pointerId) return
      s.down = null
      s.last = null
      e.target.releasePointerCapture?.(e.pointerId)
      useInk.getState().end()
    },
    onPointerLeave: () => {
      state.current.visible = false
      force((n) => n + 1)
    },
    onPointerCancel: () => {
      state.current.down = null
      useInk.getState().end()
    },
  }

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const s = state.current
    g.visible = s.visible
    // The nib dips onto the board while pressed and hovers just off it otherwise.
    const target = s.down !== null ? 0 : 1
    s.lift += (target - s.lift) * Math.min(1, dt * 18)
    if (tool === 'eraser') {
      g.quaternion.identity()
      g.position.set(s.x, s.y, ERASER.d / 2 + 0.002 + s.lift * 0.012)
    } else {
      g.quaternion.copy(PEN_Q)
      // Place the nib tip at the cursor.
      _v.set(0, 0, NIB_TIP).applyQuaternion(PEN_Q)
      g.position.set(s.x - _v.x, s.y - _v.y, -_v.z + 0.0012 + s.lift * 0.012)
    }
  })

  return (
    <>
      {/* Drawing surface: in front of the notes so a drag draws instead of moving cards. */}
      <mesh position={[0, 0, 0.0095]} {...handlers}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <group ref={group} visible={false}>
        <group raycast={() => {}}>
          <ToolModel tool={tool} capped={false} />
        </group>
      </group>
    </>
  )
}

// ─── in hand (XR) ─────────────────────────────────────────────────────────────

/** Where the tool sits in the grip: the marker lies along the controller's pointing axis like a pen. */
const GRIP_OFFSET = new Matrix4().compose(new Vector3(0, -0.012, -0.045), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.35), new Vector3(1, 1, 1))

const _a = new Vector3()
const _b = new Vector3()
const _dir = new Vector3()
const _hq = new Quaternion()
const FORWARD = new Vector3(0, 0, -1)
/** On a tracked hand, the point of the marker the fingers pinch (local z): the nib sits ~5 cm past the fingertips. */
const PINCH_AT = -0.022

function jointPosition(frame: XRFrame, hand: XRHand, joint: XRHandJoint, ref: XRReferenceSpace, out: Vector3): boolean {
  const space = hand.get(joint)
  const p = space && frame.getJointPose ? frame.getJointPose(space, ref) : undefined
  if (!p) return false
  const t = p.transform.position
  out.set(t.x, t.y, t.z)
  return true
}

/**
 * World matrix of a tool held by `source`. Controllers: the grip pose plus a pen offset. Tracked
 * hands: a marker sits in the pinch between thumb and index tips and points along the index
 * finger, like a pen; the eraser rests in the palm (grip space), felt away from the palm.
 */
function heldPose(frame: XRFrame, ref: XRReferenceSpace, source: XRInputSource, tool: ToolId, out: Matrix4): boolean {
  const hand = source.hand
  if (hand && tool !== 'eraser') {
    if (!jointPosition(frame, hand, 'thumb-tip', ref, _a) || !jointPosition(frame, hand, 'index-finger-tip', ref, _b)) return false
    const pinch = _a.add(_b).multiplyScalar(0.5)
    // Point along the index finger (knuckle → tip), falling back to the pointing ray.
    if (jointPosition(frame, hand, 'index-finger-phalanx-proximal', ref, _dir)) _dir.subVectors(_b, _dir).normalize()
    else {
      const ray = frame.getPose(source.targetRaySpace, ref)
      if (!ray) return false
      _dir.set(0, 0, -1).applyQuaternion(_hq.set(ray.transform.orientation.x, ray.transform.orientation.y, ray.transform.orientation.z, ray.transform.orientation.w))
    }
    _hq.setFromUnitVectors(FORWARD, _dir)
    // Place the marker so its PINCH_AT point sits in the pinch.
    const pos = pinch.sub(_v.set(0, 0, PINCH_AT).applyQuaternion(_hq))
    out.compose(pos, _hq, _b.set(1, 1, 1))
    return true
  }
  const p = frame.getPose(source.gripSpace ?? source.targetRaySpace, ref)
  if (!p) return false
  out.fromArray(p.transform.matrix)
  // The eraser sits in the palm (HandDrawing turns it flat to the board); a marker in a controller's grip like a pen.
  if (tool !== 'eraser') out.multiply(GRIP_OFFSET)
  return true
}

function HandDrawing({ tool, source, W, H }: { tool: ToolId; source: XRInputSource; W: number; H: number }) {
  const runtime = useBoardRuntime()
  const gl = useThree((s) => s.gl)
  const session = useXR((s) => s.session)
  const originSpace = useXR((s) => s.originReferenceSpace)
  const group = useRef<Group>(null)
  const st = useRef({ last: null as P2 | null, drawing: false, lastBuzz: 0, lastSound: 0, armed: false })

  // Letting go drops the tool back into the tray.
  useEffect(() => {
    if (!session) return
    const onEnd = (e: XRInputSourceEvent) => {
      if (e.inputSource !== source) return
      useInk.getState().end()
      putBack()
    }
    // A tracked hand holds by pinching (select); a controller by squeezing its grip, so the
    // trigger stays free while a marker is in hand.
    const type = source.hand ? 'selectend' : 'squeezeend'
    session.addEventListener(type, onEnd)
    return () => session.removeEventListener(type, onEnd)
  }, [session, source])

  const tip = useMemo(() => new Vector3(), [])
  const pose = useMemo(() => ({ pos: new Vector3(), q: new Quaternion(), s: new Vector3() }), [])

  useFrame(() => {
    const g = group.current
    const root = runtime.root
    if (!g || !root) return
    const frame = gl.xr.getFrame?.() as XRFrame | undefined
    const ref = originSpace ?? gl.xr.getReferenceSpace() ?? undefined
    const held = frame && ref ? heldPose(frame, ref, source, tool, _m) : false
    if (!held) {
      g.visible = false
      return
    }
    g.visible = true
    // Tool pose in world (_m), then in board space.
    root.updateWorldMatrix(true, false)
    _inv.copy(root.matrixWorld).invert()
    _m.premultiply(_inv)
    _m.decompose(pose.pos, pose.q, pose.s)
    if (tool === 'eraser') {
      // Like Alyx's eraser: the felt turns flat to the board, keeping only the hand's twist about the board normal.
      _v.set(1, 0, 0).applyQuaternion(pose.q)
      pose.q.setFromAxisAngle(_dir.set(0, 0, 1), Math.atan2(_v.y, _v.x))
    }

    // The contact point: the nib tip, or the middle of the eraser's felt.
    tip.set(0, 0, tool === 'eraser' ? -ERASER.d / 2 : NIB_TIP).applyQuaternion(pose.q).add(pose.pos)
    const over = inBoard(tip.x, tip.y, W, H)
    // The board pushes back: never let the tool sink into the surface (Alyx-style).
    if (over && tip.z < 0 && tip.z > -0.08) {
      pose.pos.z -= tip.z
      tip.z = 0
    }
    g.position.copy(pose.pos)
    g.quaternion.copy(pose.q)

    const s = st.current
    // The tray sits right under the board: a tool only writes once it has been lifted clear of the
    // board after pick-up, so grabbing it never leaves a stray mark on the bottom edge.
    if (!s.armed && (!over || tip.z > ARM_HEIGHT)) s.armed = true
    const touching = s.armed && over && tip.z <= CONTACT && tip.z > -0.08
    const point: P2 = [tip.x, tip.y]
    const ink = useInk.getState()
    if (touching) {
      if (!s.drawing) {
        s.drawing = true
        s.last = null
        if (tool !== 'eraser') ink.begin(MARKERS[tool].ink, MARKERS[tool].width, point)
        pulse(source.gamepad, 'tick')
      } else if (tool !== 'eraser') {
        ink.extend(point)
      }
      if (tool === 'eraser') eraseAlong(s.last, point)
      const now = performance.now()
      const moved = s.last ? Math.hypot(point[0] - s.last[0], point[1] - s.last[1]) : 0
      if (moved > 0.0015 && now - s.lastBuzz > 45) {
        pulse(source.gamepad, 'tick')
        s.lastBuzz = now
      }
      if (moved > 0.002 && now - s.lastSound > 70) {
        playSound(tool === 'eraser' ? 'wipe' : 'scribble')
        s.lastSound = now
      }
      s.last = point
    } else if (s.drawing) {
      s.drawing = false
      s.last = null
      ink.end()
    }
  })

  return (
    <group ref={group} visible={false}>
      <group raycast={() => {}}>
        <ToolModel tool={tool} capped={false} />
      </group>
    </group>
  )
}
