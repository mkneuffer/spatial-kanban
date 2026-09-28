import { BatchedText, Text } from 'troika-three-text'
import type { Object3D } from 'three'

/**
 * Batched SDF text (PLAN §12): every text member of a layer renders in one
 * draw call through troika's BatchedText. Members are created imperatively and
 * keyed, so content updates are cheap and per-frame transforms don't touch React.
 */

export interface TextProps {
  text: string
  font: string
  fontSize: number
  color: string | number
  anchorX?: 'left' | 'center' | 'right' | number
  anchorY?: 'top' | 'top-baseline' | 'middle' | 'bottom-baseline' | 'bottom' | number
  lineHeight?: number
  letterSpacing?: number
  maxWidth?: number
  textAlign?: 'left' | 'right' | 'center' | 'justify'
}

// troika's Text typings don't extend Object3D; this is the surface we use.
export type TextMember = Omit<Text, 'color'> &
  Object3D & {
    text: string
    font: string
    fontSize: number
    color: string | number
    anchorX: TextProps['anchorX']
    anchorY: TextProps['anchorY']
    lineHeight: number | 'normal'
    letterSpacing: number
    maxWidth: number
    textAlign: string
    whiteSpace: string
    fillOpacity: number
    clipRect: [number, number, number, number] | null
    sdfGlyphSize: number
    sync(cb?: () => void): void
    dispose(): void
  }

export class TextBatch {
  readonly root: BatchedText
  private members = new Map<string, TextMember>()
  private props = new Map<string, TextProps>()
  private seen = new Set<string>()

  constructor(name = 'text') {
    this.root = new BatchedText()
    this.root.name = name
    ;(this.root as unknown as { raycast: () => void }).raycast = () => {}
    this.root.renderOrder = 2
    // Bounds are empty until the first sync; never let that cull the batch before it can sync.
    this.root.frustumCulled = false
  }

  /** Mark the start of a content pass; members not `set` before `sweep()` are removed. */
  mark() {
    this.seen.clear()
  }

  set(key: string, p: TextProps): TextMember {
    this.seen.add(key)
    let m = this.members.get(key)
    const prev = this.props.get(key)
    if (!m) {
      m = new Text() as unknown as TextMember
      m.whiteSpace = 'nowrap'
      m.sdfGlyphSize = 64
      this.members.set(key, m)
      this.root.add(m as unknown as Text)
    }
    if (!prev || prev.text !== p.text) m.text = p.text
    if (!prev || prev.font !== p.font) m.font = p.font
    if (!prev || prev.fontSize !== p.fontSize) m.fontSize = p.fontSize
    if (!prev || prev.color !== p.color) m.color = p.color
    if (!prev || prev.anchorX !== p.anchorX) m.anchorX = p.anchorX ?? 'left'
    if (!prev || prev.anchorY !== p.anchorY) m.anchorY = p.anchorY ?? 'middle'
    if (!prev || prev.lineHeight !== p.lineHeight) m.lineHeight = p.lineHeight ?? 'normal'
    if (!prev || prev.letterSpacing !== p.letterSpacing) m.letterSpacing = p.letterSpacing ?? 0
    if (!prev || prev.maxWidth !== p.maxWidth) {
      m.maxWidth = p.maxWidth ?? Infinity
      m.whiteSpace = p.maxWidth ? 'normal' : 'nowrap'
    }
    if (!prev || prev.textAlign !== p.textAlign) m.textAlign = p.textAlign ?? 'left'
    this.props.set(key, p)
    return m
  }

  get(key: string): TextMember | undefined {
    return this.members.get(key)
  }

  sweep() {
    for (const [key, m] of this.members) {
      if (this.seen.has(key)) continue
      this.root.remove(m as unknown as Text)
      m.dispose()
      this.members.delete(key)
      this.props.delete(key)
    }
    this.root.sync()
  }

  forEach(fn: (m: TextMember, key: string) => void) {
    this.members.forEach(fn)
  }

  dispose() {
    for (const m of this.members.values()) m.dispose()
    this.members.clear()
    this.props.clear()
    ;(this.root as unknown as { dispose(): void }).dispose()
  }
}

/** Place a member in batch-local space. */
export function placeText(m: TextMember, x: number, y: number, z: number, rot = 0, scale = 1, sx = 1, opacity = 1) {
  m.position.set(x, y, z)
  m.rotation.set(0, 0, rot)
  m.scale.set(scale * sx, scale, scale)
  m.fillOpacity = opacity
}
