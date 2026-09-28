// troika-three-text ships typings that its package.json doesn't expose; declare the surface we use.
declare module 'troika-three-text' {
  import type { Mesh } from 'three'

  export class Text extends Mesh {
    text: string
    font: string | null
    fontSize: number
    color: string | number | null
    sync(callback?: () => void): void
    dispose(): void
  }

  /** Experimental in 0.52: renders any number of Text members in one draw call. */
  export class BatchedText extends Text {
    addText(text: Text): void
    removeText(text: Text): void
  }

  export function preloadFont(options: { font?: string; characters?: string | string[]; sdfGlyphSize?: number }, callback: () => void): void
  export function configureTextBuilder(config: Record<string, unknown>): void
}
