import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'

/**
 * Baked-style contact shadows (PLAN §12): one soft rounded-rect blob per card,
 * instanced, instead of real-time shadow maps. Opacity and blur grow with lift.
 */

const vertex = /* glsl */ `
attribute vec4 iShape; // w, h, radius, blur
attribute float iAlpha;
varying vec2 vP;
varying vec4 vShape;
varying float vAlpha;
void main() {
  vec2 size = iShape.xy + vec2(iShape.w * 2.0);
  vP = position.xy * size;
  vShape = iShape;
  vAlpha = iAlpha;
  vec4 p = instanceMatrix * vec4(vP, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`

const fragment = /* glsl */ `
varying vec2 vP;
varying vec4 vShape;
varying float vAlpha;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = sdRoundRect(vP, vShape.xy * 0.5, vShape.z);
  float a = 1.0 - smoothstep(-vShape.w * 0.6, vShape.w, d);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * vAlpha);
}
`

export function createShadowMaterial() {
  return new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false })
}

export interface ShadowSpec {
  x: number
  y: number
  z: number
  w: number
  h: number
  r: number
  blur: number
  alpha: number
  rot: number
  scale: number
}

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()
const _z = new Vector3(0, 0, 1)

export class ShadowBatch {
  readonly root = new Group()
  private mesh!: InstancedMesh
  private shape!: InstancedBufferAttribute
  private alpha!: InstancedBufferAttribute
  private count = 0
  private capacity = 0

  constructor(private material: ShaderMaterial, capacity = 128) {
    this.root.name = 'shadows'
    this.allocate(capacity)
  }

  private allocate(capacity: number) {
    const old = this.mesh
    const geometry = new PlaneGeometry(1, 1)
    this.shape = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    this.alpha = new InstancedBufferAttribute(new Float32Array(capacity), 1)
    this.shape.setUsage(DynamicDrawUsage)
    this.alpha.setUsage(DynamicDrawUsage)
    geometry.setAttribute('iShape', this.shape)
    geometry.setAttribute('iAlpha', this.alpha)
    const mesh = new InstancedMesh(geometry, this.material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.renderOrder = 1
    mesh.raycast = () => {}
    if (old) {
      this.root.remove(old)
      old.geometry.dispose()
      old.dispose()
    }
    this.root.add(mesh)
    this.mesh = mesh
    this.capacity = capacity
  }

  begin() {
    this.count = 0
  }

  push(s: ShadowSpec) {
    if (s.alpha <= 0.001) return
    if (this.count >= this.capacity) {
      this.allocate(this.capacity * 2)
      this.count = 0
    }
    const i = this.count++
    _q.setFromAxisAngle(_z, s.rot)
    _p.set(s.x, s.y, s.z)
    _s.set(s.scale, s.scale, 1)
    _m.compose(_p, _q, _s)
    this.mesh.setMatrixAt(i, _m)
    this.shape.setXYZW(i, s.w, s.h, s.r, s.blur)
    this.alpha.setX(i, s.alpha)
  }

  end() {
    this.mesh.count = this.count
    this.mesh.instanceMatrix.needsUpdate = true
    this.shape.needsUpdate = true
    this.alpha.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}
