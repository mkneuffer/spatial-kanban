import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from 'three'

/**
 * Instanced rounded rectangles ("chips") — card bodies, lanes, pills, avatars,
 * status dots and buttons all render through this one primitive (PLAN §12:
 * instanced meshes). Each instance has its own size and corner radius, so
 * corners never stretch, plus a vertical clip range for scrolling columns.
 *
 * Geometry is corner-parametrized: every vertex stores which corner it belongs
 * to (aCorner ∈ {-1,0,1}²) and a unit offset around that corner (aOffset). The
 * vertex shader builds position = aCorner·(half − r) + aOffset·r.
 */

const SEGMENTS = 6 // per corner quarter-circle

export function createChipGeometry(withSides = true): BufferGeometry {
  const corners: Array<[number, number, number]> = [
    [1, 1, 0],
    [-1, 1, Math.PI / 2],
    [-1, -1, Math.PI],
    [1, -1, (3 * Math.PI) / 2],
  ]
  const ring: Array<{ c: [number, number]; o: [number, number] }> = []
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = a0 + (i / SEGMENTS) * (Math.PI / 2)
      ring.push({ c: [cx, cy], o: [Math.cos(a), Math.sin(a)] })
    }
  }
  const corner: number[] = []
  const offset: number[] = []
  const zs: number[] = []
  const normal: number[] = []
  const index: number[] = []
  const push = (c: [number, number], o: [number, number], z: number, n: [number, number, number]) => {
    corner.push(c[0], c[1])
    offset.push(o[0], o[1])
    zs.push(z)
    normal.push(...n)
    return zs.length - 1
  }
  // Front face (z = +0.5): fan from the center.
  const center = push([0, 0], [0, 0], 0.5, [0, 0, 1])
  const front = ring.map((p) => push(p.c, p.o, 0.5, [0, 0, 1]))
  for (let i = 0; i < front.length; i++) index.push(center, front[i], front[(i + 1) % front.length])

  if (withSides) {
    // Back face (z = −0.5).
    const bc = push([0, 0], [0, 0], -0.5, [0, 0, -1])
    const back = ring.map((p) => push(p.c, p.o, -0.5, [0, 0, -1]))
    for (let i = 0; i < back.length; i++) index.push(bc, back[(i + 1) % back.length], back[i])
    // Side walls.
    const top = ring.map((p) => push(p.c, p.o, 0.5, [p.o[0], p.o[1], 0]))
    const bot = ring.map((p) => push(p.c, p.o, -0.5, [p.o[0], p.o[1], 0]))
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length
      index.push(top[i], bot[i], bot[j], top[i], bot[j], top[j])
    }
  }

  const g = new BufferGeometry()
  // `position` is required by three; the shader ignores it.
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(zs.length * 3), 3))
  g.setAttribute('aCorner', new Float32BufferAttribute(corner, 2))
  g.setAttribute('aOffset', new Float32BufferAttribute(offset, 2))
  g.setAttribute('aZ', new Float32BufferAttribute(zs, 1))
  g.setAttribute('normal', new Float32BufferAttribute(normal, 3))
  g.setIndex(index)
  return g
}

const VERT_HEAD = /* glsl */ `
attribute vec2 aCorner;
attribute vec2 aOffset;
attribute float aZ;
attribute vec4 iShape; // w, h, radius, depth
attribute vec3 iClip;  // minY, maxY, alpha (batch-local)
varying float vBatchY;
varying vec3 vClip;
`

const VERT_BEGIN = /* glsl */ `
vec2 halfSize = iShape.xy * 0.5;
float rad = min(iShape.z, min(halfSize.x, halfSize.y));
vec3 transformed = vec3(aCorner * (halfSize - rad) + aOffset * rad, aZ * iShape.w);
vBatchY = (instanceMatrix * vec4(transformed, 1.0)).y;
vClip = iClip;
`

const FRAG_HEAD = /* glsl */ `
varying float vBatchY;
varying vec3 vClip;
`

const FRAG_CLIP = /* glsl */ `
if (vBatchY < vClip.x || vBatchY > vClip.y) discard;
`

function patchChipShader(material: Material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', VERT_BEGIN)
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_CLIP}`)
      .replace('#include <opaque_fragment>', `diffuseColor.a *= vClip.z;\n#include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => 'chip-v1'
  return material
}

export function createChipMaterial(
  opts: { lit?: boolean; transparent?: boolean; roughness?: number; metalness?: number; clearcoat?: number; envMapIntensity?: number } = {},
) {
  const m =
    opts.lit === false
      ? new MeshBasicMaterial({ color: 0xffffff, transparent: !!opts.transparent })
      : opts.clearcoat
        ? new MeshPhysicalMaterial({
            color: 0xffffff,
            roughness: opts.roughness ?? 0.4,
            metalness: opts.metalness ?? 0,
            clearcoat: opts.clearcoat,
            clearcoatRoughness: 0.06,
            transparent: !!opts.transparent,
          })
        : new MeshStandardMaterial({
            color: 0xffffff,
            roughness: opts.roughness ?? 0.7,
            metalness: opts.metalness ?? 0,
            envMapIntensity: opts.envMapIntensity ?? 1,
            transparent: !!opts.transparent,
          })
  if (opts.transparent) m.depthWrite = false
  return patchChipShader(m)
}

export interface ChipSpec {
  x: number
  y: number
  z: number
  w: number
  h: number
  /** Corner radius. */
  r: number
  /** Thickness; 0 for flat plates. */
  d?: number
  rot?: number
  /** Horizontal squash for flip transitions (1 = none). */
  sx?: number
  scale?: number
  color: Color | string | number
  clipMin?: number
  clipMax?: number
  alpha?: number
}

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()
const _z = new Vector3(0, 0, 1)
const _c = new Color()

/**
 * A growable instanced batch. Call `begin()`, `push()` any number of chips,
 * then `end()` once per frame. One draw call regardless of count. Mount
 * `root` in the scene; the mesh inside is swapped when capacity grows.
 */
export class ChipBatch {
  readonly root = new Group()
  mesh!: InstancedMesh
  private shape!: InstancedBufferAttribute
  private clip!: InstancedBufferAttribute
  private count = 0
  private capacity = 0

  constructor(
    private material: Material,
    capacity = 64,
    private withSides = true,
    name = 'chips',
  ) {
    this.root.name = name
    this.allocate(capacity)
  }

  private allocate(capacity: number) {
    const old = this.mesh
    const geometry = createChipGeometry(this.withSides)
    this.shape = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    this.clip = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.shape.setUsage(DynamicDrawUsage)
    this.clip.setUsage(DynamicDrawUsage)
    geometry.setAttribute('iShape', this.shape)
    geometry.setAttribute('iClip', this.clip)
    const mesh = new InstancedMesh(geometry, this.material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.renderOrder = old?.renderOrder ?? 0
    // Pointer events use dedicated hit proxies, not the batch.
    mesh.raycast = () => {}
    mesh.setColorAt(0, _c.set(0xffffff))
    if (old) {
      this.root.remove(old)
      old.geometry.dispose()
      old.dispose()
    }
    this.root.add(mesh)
    this.mesh = mesh
    this.capacity = capacity
  }

  set renderOrder(v: number) {
    this.mesh.renderOrder = v
  }

  begin() {
    this.count = 0
  }

  push(c: ChipSpec) {
    if (this.count >= this.capacity) {
      // Rare: re-allocate at double size. Instances pushed so far this frame are re-pushed next frame.
      this.allocate(this.capacity * 2)
      this.count = 0
    }
    const i = this.count++
    const s = c.scale ?? 1
    _q.setFromAxisAngle(_z, c.rot ?? 0)
    _p.set(c.x, c.y, c.z)
    _s.set(s * (c.sx ?? 1), s, s)
    _m.compose(_p, _q, _s)
    this.mesh.setMatrixAt(i, _m)
    this.mesh.setColorAt(i, typeof c.color === 'object' ? c.color : _c.set(c.color))
    this.shape.setXYZW(i, c.w, c.h, c.r, c.d ?? 0)
    this.clip.setXYZ(i, c.clipMin ?? -1e5, c.clipMax ?? 1e5, c.alpha ?? 1)
  }

  end() {
    this.mesh.count = this.count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.shape.needsUpdate = true
    this.clip.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}

/** Convenience: an Object3D wrapper for adding several batches at once. */
export function group(...objects: Object3D[]): Object3D {
  const g = new Object3D()
  for (const o of objects) g.add(o)
  return g
}
