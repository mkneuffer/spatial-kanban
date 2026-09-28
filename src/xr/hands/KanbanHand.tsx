import { Suspense, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import {
  CombinedPointer,
  DefaultXRInputSourceRayPointer,
  PointerCursorModel,
  defaultGrabPointerOpacity,
  defaultTouchPointerOpacity,
  useGrabPointer,
  usePointerXRInputSourceEvents,
  useTouchPointer,
  useXR,
  useXRInputSourceStateContext,
  useXRSpace,
} from '@react-three/xr'
import type { Intersection } from '@pmndrs/pointer-events'
import { Matrix4, Vector3, type Group, type Mesh, type MeshToonMaterial, type Object3D, type ShaderMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createHandMaterial, createOutlineMaterial, styleHandModel } from './metaDarkV6'
import {
  HAND_RAY_MIN_DISTANCE,
  PINCH_GRAB_RADIUS,
  POKE_CLICK_MS,
  POKE_HOVER_RADIUS,
  pokeAllowed,
  pokePressed,
} from './nearField'

/** Same order as XRHand iteration (WebXR Hand Input spec), which `fillPoses` relies on. */
const JOINTS: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
]

let bodyMaterial: MeshToonMaterial | null = null
let outlineMaterial: ShaderMaterial | null = null

/** The generic-hand skeleton (self-hosted, like the ProtoGen template) in the Meta Dark v6 look. */
function MetaDarkHandModel() {
  const state = useXRInputSourceStateContext('hand')
  const handedness = state.inputSource.handedness === 'left' ? 'left' : 'right'
  const gltf = useLoader(GLTFLoader, `${import.meta.env.BASE_URL}webxr-profiles/generic-hand/${handedness}.glb`)
  const model = useMemo(() => {
    const m = cloneSkeleton(gltf.scene)
    bodyMaterial ??= createHandMaterial()
    outlineMaterial ??= createOutlineMaterial()
    // Style first: the wrist fade is baked from the bind pose, before any tracked pose lands.
    styleHandModel(m, bodyMaterial, outlineMaterial)
    m.traverse((o) => {
      if ((o as Mesh).isMesh) o.frustumCulled = false
    })
    return m
  }, [gltf])
  state.object = model

  // Joint poses relative to this component's space (the hand's target-ray space).
  const space = useXRSpace()
  const update = useMemo(() => {
    const hand = state.inputSource.hand
    const buffer = new Float32Array(JOINTS.length * 16)
    const joints = JOINTS.map((name) => {
      const joint = model.getObjectByName(name)
      if (joint) joint.matrixAutoUpdate = false
      return joint
    })
    return (frame: XRFrame | undefined) => {
      if (!frame?.fillPoses || !space) return
      if (!frame.fillPoses(hand.values(), space, buffer)) return
      for (let i = 0; i < joints.length; i++) joints[i]?.matrix.fromArray(buffer, i * 16)
    }
  }, [model, space, state.inputSource.hand])
  useFrame((_s, _d, frame) => update(frame as XRFrame | undefined))

  return <primitive object={model} />
}

interface HandGate {
  /** Thumb–index tip gap (m). */
  gap: number
  /** Poke may start a press. */
  poke: boolean
}

type Space = Object3D & { transformReady?: boolean }

const _index = new Vector3()
const _thumb = new Vector3()
const _inv = new Matrix4()

/**
 * Places the pinch-point and fingertip pointer spaces from this frame's joint poses,
 * before pointers intersect (pmndrs moves pointers at priority -50, but updates
 * XRSpace groups at 0, so its own joint spaces lag a frame).
 */
function useFingerSpaces(pinch: RefObject<Group | null>, tip: RefObject<Group | null>, gate: HandGate) {
  const state = useXRInputSourceStateContext('hand')
  const origin = useXR((s) => s.originReferenceSpace)
  useFrame((_s, _d, xrFrame) => {
    const frame = xrFrame as XRFrame | undefined
    const p = pinch.current as Space | null
    const t = tip.current as Space | null
    if (!p || !t) return
    const hand = state.inputSource.hand
    const indexSpace = hand.get('index-finger-tip')
    const thumbSpace = hand.get('thumb-tip')
    const index = origin && indexSpace && frame?.getJointPose?.(indexSpace, origin)
    const thumb = origin && thumbSpace && frame?.getJointPose?.(thumbSpace, origin)
    const ok = !!index && !!thumb && !!p.parent
    p.transformReady = t.transformReady = ok
    if (!ok) return
    _index.set(index.transform.position.x, index.transform.position.y, index.transform.position.z)
    _thumb.set(thumb.transform.position.x, thumb.transform.position.y, thumb.transform.position.z)
    gate.gap = _index.distanceTo(_thumb)
    gate.poke = pokeAllowed(gate.gap, gate.poke)
    // Express the reference-space points in the parent (target-ray) group, whose matrix
    // is whatever it currently holds, so the world result is this frame's joint pose.
    _inv.copy(p.parent!.matrix).invert()
    _thumb.add(_index).multiplyScalar(0.5).applyMatrix4(_inv)
    _index.applyMatrix4(_inv)
    p.matrix.makeTranslation(_thumb)
    t.matrix.makeTranslation(_index)
  }, -60)
}

function PinchGrabPointer({ space }: { space: RefObject<Group | null> }) {
  const state = useXRInputSourceStateContext('hand')
  const pointer = useGrabPointer(space, state, { radius: PINCH_GRAB_RADIUS })
  usePointerXRInputSourceEvents(pointer, state.inputSource, 'select', state.events)
  return (
    <group ref={space} matrixAutoUpdate={false}>
      <PointerCursorModel pointer={pointer} opacity={defaultGrabPointerOpacity} />
    </group>
  )
}

const _n = new Vector3()
const _d = new Vector3()

/** Signed fingertip distance along the hit surface's normal, and whether the surface faces the finger. */
function sampleSurface(i: Intersection | undefined): { distance: number; front: boolean } {
  if (!i || (i.object as Object3D & { isVoidObject?: boolean }).isVoidObject) return { distance: NaN, front: false }
  const local = i.face?.normal ?? i.normal
  if (!local) return { distance: i.distance, front: true }
  i.object.updateWorldMatrix(true, false)
  _n.copy(local).transformDirection(i.object.matrixWorld)
  // Every pokeable surface here (cards, columns, buttons, keys) faces its local +z.
  return { distance: _d.copy(i.pointerPosition).sub(i.pointOnFace).dot(_n), front: local.z > 0.5 }
}

/**
 * Index-tip poke. pmndrs' touch pointer presses at a single radius (3 cm by default),
 * several centimetres before the finger reaches the card, and releases at the same
 * radius, so a finger sliding across the board chatters. This one presses at the
 * surface, only from the front, and releases after a clear lift.
 */
function PokePointer({ space, gate }: { space: RefObject<Group | null>; gate: HandGate }) {
  const state = useXRInputSourceStateContext('hand')
  const pointer = useTouchPointer(space, state, {
    hoverRadius: POKE_HOVER_RADIUS,
    // Disable the built-in press; pressing is driven below.
    downRadius: -1,
    clickThresholdMs: POKE_CLICK_MS,
    // Out of the running while a pinch is forming, so the pinch grab gets the card.
    filter: () => gate.poke,
  })
  const pressed = useRef(false)
  useFrame(() => {
    const sample = sampleSurface(pointer.getIntersection())
    const next = pokePressed(pressed.current, { enabled: pointer.getEnabled(), allowed: gate.poke, ...sample })
    if (next === pressed.current) return
    pressed.current = next
    const event = { timeStamp: performance.now(), button: 0 }
    if (next) pointer.down(event)
    else pointer.up(event)
  }, -49)
  return (
    <group ref={space} matrixAutoUpdate={false}>
      <PointerCursorModel pointer={pointer} opacity={defaultTouchPointerOpacity} />
    </group>
  )
}

/**
 * Tracked-hand implementation: Meta Dark v6 visuals, pinch-point grab, fingertip
 * poke, and the far-field ray. One pointer is active at a time; the nearest hit wins.
 */
export function KanbanHand() {
  const gate = useMemo<HandGate>(() => ({ gap: NaN, poke: false }), [])
  const pinch = useRef<Group>(null)
  const tip = useRef<Group>(null)
  useFingerSpaces(pinch, tip, gate)
  return (
    <>
      <Suspense fallback={null}>
        <MetaDarkHandModel />
      </Suspense>
      <CombinedPointer>
        <PinchGrabPointer space={pinch} />
        <PokePointer space={tip} gate={gate} />
        <DefaultXRInputSourceRayPointer makeDefault minDistance={HAND_RAY_MIN_DISTANCE} rayModel={{ maxLength: 0.2 }} />
      </CombinedPointer>
    </>
  )
}
