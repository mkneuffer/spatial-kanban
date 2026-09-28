import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three'

/**
 * Instanced paper sticky notes with a vertex-shader curl (PLAN §7.3): a
 * permanent small curl on the bottom-right corner, and a peel from the bottom
 * edge driven per instance while the note is grabbed. All notes, including the
 * one being dragged, stay in one draw call.
 */

const VERT_HEAD = /* glsl */ `
attribute vec3 iPaper; // w, h, curl (0..1)
varying float vY01;
varying float vCurl;
`

const VERT_BEGIN = /* glsl */ `
float y01 = position.y + 0.5;
float x01 = position.x + 0.5;
vec3 transformed = vec3(position.xy * iPaper.xy, 0.0);
// Peel: the bottom 55% lifts off the board, bending progressively.
float bend = max(0.0, 0.55 - y01) / 0.55;
float peel = iPaper.z * bend * bend * iPaper.y * 0.42;
// Resting corner curl, bottom-right.
float cx = max(0.0, x01 - 0.72) / 0.28;
float cy = max(0.0, 0.26 - y01) / 0.26;
float corner = pow(cx * cy, 1.6) * iPaper.x * 0.05;
transformed.z += peel + corner;
// Keep the paper from stretching as it bends.
transformed.y += peel * 0.35 * bend;
vY01 = y01;
vCurl = peel + corner;
`

const NORMAL_BEGIN = /* glsl */ `
float ny01 = position.y + 0.5;
float nb = max(0.0, 0.55 - ny01) / 0.55;
float dzdy = -iPaper.z * 2.0 * nb / 0.55 * 0.42;
vec3 objectNormal = normalize(vec3(0.0, -dzdy, 1.0));
`

const FRAG_HEAD = /* glsl */ `
varying float vY01;
varying float vCurl;
`

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
// Adhesive strip slightly darker; lifted paper catches a touch of shade.
diffuseColor.rgb *= mix(0.93, 1.0, smoothstep(0.86, 0.8, vY01));
diffuseColor.rgb *= 1.0 - clamp(vCurl * 6.0, 0.0, 0.12);
`

export function createPaperMaterial() {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: DoubleSide })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', NORMAL_BEGIN)
      .replace('#include <begin_vertex>', VERT_BEGIN)
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <color_fragment>', FRAG_COLOR)
  }
  m.customProgramCacheKey = () => 'paper-v1'
  return m
}

export interface PaperSpec {
  x: number
  y: number
  z: number
  w: number
  h: number
  rot: number
  scale: number
  sx: number
  curl: number
  color: Color | string
}

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()
const _z = new Vector3(0, 0, 1)
const _c = new Color()

export class PaperBatch {
  readonly root = new Group()
  mesh!: InstancedMesh
  private paper!: InstancedBufferAttribute
  private count = 0
  private capacity = 0
  private geometry = new PlaneGeometry(1, 1, 6, 12)

  constructor(private material: MeshStandardMaterial | ShaderMaterial, capacity = 128) {
    this.root.name = 'paper'
    this.allocate(capacity)
  }

  private allocate(capacity: number) {
    const old = this.mesh
    const geometry = this.geometry.clone()
    this.paper = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    this.paper.setUsage(DynamicDrawUsage)
    geometry.setAttribute('iPaper', this.paper)
    const mesh = new InstancedMesh(geometry, this.material, capacity)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
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

  begin() {
    this.count = 0
  }

  push(p: PaperSpec) {
    if (this.count >= this.capacity) {
      this.allocate(this.capacity * 2)
      this.count = 0
    }
    const i = this.count++
    _q.setFromAxisAngle(_z, p.rot)
    _p.set(p.x, p.y, p.z)
    _s.set(p.scale * p.sx, p.scale, p.scale)
    _m.compose(_p, _q, _s)
    this.mesh.setMatrixAt(i, _m)
    this.mesh.setColorAt(i, typeof p.color === 'object' ? p.color : _c.set(p.color))
    this.paper.setXYZ(i, p.w, p.h, p.curl)
  }

  end() {
    this.mesh.count = this.count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.paper.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}
