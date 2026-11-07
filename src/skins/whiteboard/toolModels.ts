import { useEffect, useState } from 'react'
import { BufferGeometry, Mesh, type Material } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import toolsUrl from './assets/whiteboard-tools.glb?url'

/**
 * The dry-erase markers and eraser from ProtoGen's Alyx-Physics room
 * (projects/Alyx-Physics, `parts.glb` with its baked color/normal/ORM maps),
 * cut down to just these four props (~190 KB).
 *
 * Geometry is re-based into frames the board can use directly:
 * - marker: nib tip at the origin, barrel along +Y (0.1465 m long);
 * - eraser: felt pad face at z = 0 facing −Z (toward the board), block up +Z.
 */
export interface ToolModel {
  geometry: BufferGeometry
  material: Material
}

export interface ToolModels {
  markers: Record<'black' | 'blue' | 'red', ToolModel>
  eraser: ToolModel
}

/** Real sizes (meters) of the models, for layout and the eraser's footprint. */
export const MARKER_LENGTH = 0.1465
export const MARKER_RADIUS = 0.0105
export const ERASER_SIZE = { w: 0.13, h: 0.05, height: 0.0415 }

const SOURCES = {
  black: 'Alyx_Marker_Black_Mesh',
  blue: 'Alyx_Marker_Blue_Mesh',
  red: 'Alyx_Marker_Red_Mesh',
  eraser: 'Eraser_Mesh',
} as const

let pending: Promise<ToolModels | null> | null = null
let loaded: ToolModels | null = null

export function loadToolModels(): Promise<ToolModels | null> {
  pending ??= new GLTFLoader()
    .loadAsync(toolsUrl)
    .then((gltf) => {
      const find = (name: string): ToolModel => {
        let mesh: Mesh | undefined
        gltf.scene.traverse((o) => {
          if (!mesh && o instanceof Mesh && (o.name === name || o.parent?.name === name)) mesh = o
        })
        if (!mesh) throw new Error(`whiteboard-tools.glb has no ${name}`)
        return { geometry: mesh.geometry as BufferGeometry, material: mesh.material as Material }
      }
      const marker = (name: string) => {
        const m = find(name)
        // The source barrel runs along Z with the nib at −Z (z = −0.0745): put the tip at the origin, barrel up +Y.
        const g = m.geometry.clone()
        g.translate(0, 0, 0.0745)
        g.rotateX(-Math.PI / 2)
        g.computeBoundingSphere()
        return { geometry: g, material: m.material }
      }
      const e = find(SOURCES.eraser)
      // The source pad faces −Y (y = −0.019): turn it to face −Z and sit the felt on z = 0.
      const eg = e.geometry.clone()
      eg.rotateX(Math.PI / 2)
      eg.translate(0, 0, 0.019)
      eg.computeBoundingSphere()
      loaded = {
        markers: { black: marker(SOURCES.black), blue: marker(SOURCES.blue), red: marker(SOURCES.red) },
        eraser: { geometry: eg, material: e.material },
      }
      return loaded
    })
    .catch((err) => {
      // The board still works with the simple stand-ins.
      console.warn('Whiteboard tool models failed to load', err)
      return null
    })
  return pending
}

/** The tool models once loaded (null until then, or if they failed to load). */
export function useToolModels(): ToolModels | null {
  const [models, setModels] = useState(loaded)
  useEffect(() => {
    let live = true
    if (!loaded) void loadToolModels().then((m) => live && setModels(m))
    return () => {
      live = false
    }
  }, [])
  return models
}
