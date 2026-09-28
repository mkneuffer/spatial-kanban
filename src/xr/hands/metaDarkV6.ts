import {
  BackSide,
  BufferAttribute,
  DataTexture,
  FrontSide,
  MathUtils,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three'

/**
 * The ProtoGen "Meta Dark v6" tracked-hand look: a translucent near-black toon
 * body that fades out toward the wrist, with a solid white inverted-hull outline.
 *
 * Ported from ProtoGen-WebXR-Development `WebXR Template/src/xr-hands.js`
 * (`createHandMaterial`, `createMetaDarkV6OutlineMaterial`, `styleHandModel`),
 * whose values come from `materials/hands/meta-dark-v6.json`. Keep the shader
 * literals in step with that spec; colors are linear, not sRGB.
 */

export function createHandMaterial(): MeshToonMaterial {
  const ramp = new DataTexture(new Uint8Array([190, 225, 255]), 3, 1, RedFormat)
  ramp.minFilter = ramp.magFilter = NearestFilter
  ramp.needsUpdate = true
  const material = new MeshToonMaterial({
    color: '#ffffff',
    gradientMap: ramp,
    transparent: true,
    opacity: 0.76,
    depthWrite: true,
    side: FrontSide,
    toneMapped: false,
  })
  material.name = 'Meta Dark v6'
  ;(material as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = { handFade: [1] }
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float handFade; varying float vHandFade;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHandFade = handFade;')
    shader.fragmentShader = 'varying float vHandFade;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
   float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
   float softShade = smoothstep(0.0, 0.001, facing);
   outgoingLight = mix(vec3(0.020,0.023,0.027), vec3(0.045,0.050,0.057), softShade);
   diffuseColor.a = opacity * vHandFade;
   #include <opaque_fragment>
  `,
    )
  }
  material.customProgramCacheKey = () => 'meta-dark-v6-ed9b27af1f'
  return material
}

/**
 * The white edge is a skinned inverted hull, not a fresnel term. It shares the
 * body's skeleton so it never lags behind the tracked joints.
 */
export function createOutlineMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: { uWidth: { value: 0.0026 } },
    vertexShader: `attribute float handFade; varying float vHandFade;
   uniform float uWidth;
   #include <common>
   #include <skinning_pars_vertex>
   void main(){
    #include <beginnormal_vertex>
    #include <begin_vertex>
    vHandFade=handFade;
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>
    vec4 mvPosition=modelViewMatrix*vec4(transformed,1.0);
    mvPosition.xyz+=normalize(normalMatrix*objectNormal)*uWidth;
    gl_Position=projectionMatrix*mvPosition;
   }`,
    fragmentShader: `varying float vHandFade;
   void main(){if(vHandFade<.004)discard;gl_FragColor=vec4(vec3(1.0),vHandFade);}`,
    side: BackSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  })
  material.name = 'Meta Dark v6 solid white hull outline'
  ;(material as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = { handFade: [1] }
  return material
}

function attachOutline(mesh: SkinnedMesh, material: ShaderMaterial) {
  if (!mesh.parent) return
  const hull = new SkinnedMesh(mesh.geometry, material)
  hull.name = 'Meta Dark v6 outline'
  hull.userData.handOutline = true
  hull.bind(mesh.skeleton, mesh.bindMatrix)
  hull.bindMode = mesh.bindMode
  hull.frustumCulled = false
  hull.renderOrder = (mesh.renderOrder || 0) + 1
  hull.raycast = () => {}
  mesh.parent.add(hull)
}

/**
 * Restyle a loaded generic-hand GLB. Must run while the joints are still in
 * their bind pose (before tracked poses are written), because the wrist fade is
 * baked along the wrist → middle-metacarpal axis in bind space.
 */
export function styleHandModel(object: Object3D, material: MeshToonMaterial = createHandMaterial(), outline: ShaderMaterial = createOutlineMaterial()): Object3D {
  object.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  object.traverse((child) => {
    if ((child as Mesh).isMesh && !child.userData.handOutline) meshes.push(child as Mesh)
  })
  const wrist = object.getObjectByName('wrist')
  const middle = object.getObjectByName('middle-finger-metacarpal')
  for (const mesh of meshes) {
    if (wrist && middle) {
      const origin = mesh.worldToLocal(wrist.getWorldPosition(new Vector3()))
      const axis = mesh.worldToLocal(middle.getWorldPosition(new Vector3())).sub(origin).normalize()
      mesh.geometry = mesh.geometry.clone()
      const positions = mesh.geometry.attributes.position
      const fade = new Float32Array(positions.count)
      const point = new Vector3()
      for (let i = 0; i < positions.count; i++) {
        const distance = point.fromBufferAttribute(positions, i).sub(origin).dot(axis)
        fade[i] = MathUtils.smoothstep(distance, 0, 0.045)
      }
      mesh.geometry.setAttribute('handFade', new BufferAttribute(fade, 1))
    }
    mesh.material = material
    mesh.castShadow = false
    mesh.receiveShadow = false
    // The hand is a visual only; it must never block pointers aimed at the board.
    mesh.raycast = () => {}
    if ((mesh as SkinnedMesh).isSkinnedMesh) attachOutline(mesh as SkinnedMesh, outline)
  }
  return object
}
