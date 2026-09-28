import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'

/**
 * Board-space particle effects (PLAN §12): ripples, dust, confetti, sparkles
 * and light sweeps, all simulated on the CPU and drawn as one instanced mesh
 * (one draw call, no textures — shapes are computed in the fragment shader).
 */

export const Shape = { Dot: 0, Square: 1, Ring: 2, Star: 3, Band: 4 } as const
export type Shape = (typeof Shape)[keyof typeof Shape]

export interface ParticleSpec {
  x: number
  y: number
  z: number
  vx?: number
  vy?: number
  vz?: number
  /** Acceleration along board-local −y (m/s²). */
  gravity?: number
  /** Velocity damping per second (0 = none). */
  drag?: number
  size: number
  /** Final size multiplier over the particle's life. */
  grow?: number
  /** Width/height ratio (bands, confetti strips). */
  aspect?: number
  rot?: number
  spin?: number
  /** Confetti flutter: how fast the piece flips (rad/s). */
  flip?: number
  life: number
  delay?: number
  color: string | Color
  alpha?: number
  shape: Shape
}

interface Particle extends Required<Omit<ParticleSpec, 'color'>> {
  color: Color
  age: number
}

const VERT = /* glsl */ `
attribute vec4 iColor;
attribute float iShape;
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  vUv = uv;
  vColor = iColor;
  vShape = iShape;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float a;
  if (vShape < 0.5) {
    a = pow(max(0.0, 1.0 - d), 1.6);
  } else if (vShape < 1.5) {
    a = 1.0;
  } else if (vShape < 2.5) {
    a = smoothstep(0.16, 0.0, abs(d - 0.84)) * step(d, 1.0);
  } else if (vShape < 3.5) {
    float cross = max(1.0 - smoothstep(0.0, 0.09, abs(p.x)) , 1.0 - smoothstep(0.0, 0.09, abs(p.y)));
    a = max(cross * (1.0 - d), pow(max(0.0, 1.0 - d * 1.6), 2.0));
  } else {
    float band = 1.0 - abs(p.y) * 2.0;
    float ends = smoothstep(0.0, 0.08, 0.5 - abs(p.x));
    a = band * band * ends;
  }
  a *= vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()
const _z = new Vector3(0, 0, 1)

export class ParticleSystem {
  readonly mesh: InstancedMesh
  private color: InstancedBufferAttribute
  private shape: InstancedBufferAttribute
  private live: Particle[] = []
  private pool: Particle[] = []

  constructor(readonly capacity = 640) {
    const geometry = new PlaneGeometry(1, 1)
    this.color = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    this.shape = new InstancedBufferAttribute(new Float32Array(capacity), 1)
    this.color.setUsage(DynamicDrawUsage)
    this.shape.setUsage(DynamicDrawUsage)
    geometry.setAttribute('iColor', this.color)
    geometry.setAttribute('iShape', this.shape)
    const material = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false })
    this.mesh = new InstancedMesh(geometry, material, capacity)
    this.mesh.name = 'fx-particles'
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4
    this.mesh.count = 0
    this.mesh.raycast = () => {}
  }

  get active() {
    return this.live.length
  }

  emit(spec: ParticleSpec) {
    if (this.live.length >= this.capacity) return
    const p = this.pool.pop() ?? ({ color: new Color() } as Particle)
    p.x = spec.x
    p.y = spec.y
    p.z = spec.z
    p.vx = spec.vx ?? 0
    p.vy = spec.vy ?? 0
    p.vz = spec.vz ?? 0
    p.gravity = spec.gravity ?? 0
    p.drag = spec.drag ?? 0
    p.size = spec.size
    p.grow = spec.grow ?? 1
    p.aspect = spec.aspect ?? 1
    p.rot = spec.rot ?? 0
    p.spin = spec.spin ?? 0
    p.flip = spec.flip ?? 0
    p.life = spec.life
    p.delay = spec.delay ?? 0
    p.alpha = spec.alpha ?? 1
    p.shape = spec.shape
    p.age = 0
    p.color.set(spec.color)
    this.live.push(p)
  }

  clear() {
    this.pool.push(...this.live)
    this.live.length = 0
    this.mesh.count = 0
  }

  /** Advance the simulation and upload instances. `opacity` fades everything (tracking loss). */
  update(dt: number, opacity = 1) {
    if (this.live.length === 0 && this.mesh.count === 0) return
    const step = Math.min(dt, 1 / 20)
    let n = 0
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]
      if (p.delay > 0) {
        p.delay -= step
        continue
      }
      p.age += step
      if (p.age >= p.life) {
        this.live[i] = this.live[this.live.length - 1]
        this.live.pop()
        this.pool.push(p)
        continue
      }
      const damp = p.drag ? Math.exp(-p.drag * step) : 1
      p.vx *= damp
      p.vy = p.vy * damp - p.gravity * step
      p.vz *= damp
      p.x += p.vx * step
      p.y += p.vy * step
      p.z = Math.max(0.0015, p.z + p.vz * step)
      p.rot += p.spin * step
    }
    for (const p of this.live) {
      if (p.delay > 0 || n >= this.capacity) continue
      const t = p.age / p.life
      const size = p.size * (1 + (p.grow - 1) * easeOut(t))
      // Fade in fast, fade out over the last 40% of life.
      const fade = Math.min(1, t * 12) * (t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1)
      const flipScale = p.flip ? Math.max(0.15, Math.abs(Math.cos(p.age * p.flip))) : 1
      _q.setFromAxisAngle(_z, p.rot)
      _p.set(p.x, p.y, p.z)
      _s.set(size * p.aspect * flipScale, size, 1)
      _m.compose(_p, _q, _s)
      this.mesh.setMatrixAt(n, _m)
      this.color.setXYZW(n, p.color.r, p.color.g, p.color.b, p.alpha * fade * opacity)
      this.shape.setX(n, p.shape)
      n++
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    this.color.needsUpdate = true
    this.shape.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
    this.mesh.dispose()
  }
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t)
}
