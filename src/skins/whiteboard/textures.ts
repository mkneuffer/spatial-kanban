import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import { hash01 } from '../../board/space'

/**
 * Procedural textures that make the whiteboard read as a real object: a soft
 * shadow it casts on the wall, and a melamine sheen with faint ghosting left
 * by years of erased writing. Generated once on a canvas, no downloads.
 */

let shadow: CanvasTexture | null = null

/** A blurred rounded rectangle, darker toward the bottom (light comes from above). */
export function boardShadowTexture(): CanvasTexture {
  if (shadow) return shadow
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')!
  g.filter = 'blur(18px)'
  const grad = g.createLinearGradient(0, 40, 0, 230)
  grad.addColorStop(0, 'rgba(0,0,0,0.35)')
  grad.addColorStop(1, 'rgba(0,0,0,0.75)')
  g.fillStyle = grad
  g.beginPath()
  g.roundRect(44, 44, 168, 172, 10)
  g.fill()
  shadow = new CanvasTexture(c)
  shadow.minFilter = LinearFilter
  return shadow
}

const sheens = new Map<string, CanvasTexture>()

/**
 * Sheen + ghosting for a board of the given aspect. Ghosts are seeded so the
 * same board always shows the same faint history.
 */
export function boardSheenTexture(aspect: number, seed = 'board'): CanvasTexture {
  const key = `${aspect.toFixed(2)}:${seed}`
  const hit = sheens.get(key)
  if (hit) return hit
  const w = 1024
  const h = Math.max(256, Math.round(w / aspect))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!

  // Melamine is never perfectly even: a cool falloff toward the frame...
  const vig = g.createRadialGradient(w * 0.45, h * 0.42, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.62)
  vig.addColorStop(0, 'rgba(70,78,92,0)')
  vig.addColorStop(1, 'rgba(70,78,92,0.08)')
  g.fillStyle = vig
  g.fillRect(0, 0, w, h)
  // ...and a broad, soft window reflection across the upper left, a fainter band lower right.
  const glare = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1)
    gr.addColorStop(0, 'rgba(255,255,255,0)')
    gr.addColorStop(0.45, `rgba(255,255,255,${a})`)
    gr.addColorStop(0.55, `rgba(255,255,255,${a})`)
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, w, h)
  }
  glare(w * 0.05, h * 0.0, w * 0.45, h * 0.7, 0.22)
  glare(w * 0.55, h * 0.4, w * 0.95, h * 1.1, 0.1)

  // Ghosting: old erased scribbles, arrows, boxes and words, barely visible.
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const n = 34
  for (let i = 0; i < n; i++) {
    const r = (k: number) => hash01(`${seed}:${i}`, k)
    const hue = r(1) < 0.55 ? '40,44,52' : r(1) < 0.8 ? '30,80,190' : '190,40,45'
    g.strokeStyle = `rgba(${hue},${0.012 + r(2) * 0.014})`
    g.lineWidth = 2 + r(3) * 3
    const x = r(4) * w
    const y = r(5) * h
    const s = (0.04 + r(6) * 0.12) * w
    g.beginPath()
    const kind = Math.floor(r(7) * 4)
    if (kind === 0) {
      // Cursive-ish word.
      g.moveTo(x, y)
      for (let t = 0; t < 1; t += 0.04) g.lineTo(x + t * s * 1.6, y + Math.sin(t * 38 + r(8) * 6) * s * 0.08 - t * s * 0.05)
    } else if (kind === 1) {
      // Box.
      g.rect(x, y, s, s * (0.4 + r(8) * 0.5))
    } else if (kind === 2) {
      // Arrow.
      g.moveTo(x, y)
      g.quadraticCurveTo(x + s * 0.6, y - s * 0.4, x + s, y + s * 0.1)
      g.lineTo(x + s * 0.88, y + s * 0.02)
      g.moveTo(x + s, y + s * 0.1)
      g.lineTo(x + s * 0.9, y + s * 0.2)
    } else {
      // Circle.
      g.ellipse(x, y, s * 0.4, s * 0.28, r(8), 0, Math.PI * 2)
    }
    g.stroke()
  }
  // Eraser swipes: broad, slightly cleaner arcs.
  for (let i = 0; i < 6; i++) {
    const r = (k: number) => hash01(`${seed}:swipe:${i}`, k)
    g.strokeStyle = `rgba(255,255,255,${0.05 + r(1) * 0.05})`
    g.lineWidth = 40 + r(2) * 30
    g.beginPath()
    const x = r(3) * w
    const y = r(4) * h
    g.moveTo(x, y)
    g.quadraticCurveTo(x + 80, y - 60 * r(5), x + 160 + r(6) * 120, y + 20)
    g.stroke()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  sheens.set(key, t)
  return t
}
