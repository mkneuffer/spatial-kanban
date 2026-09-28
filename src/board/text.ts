/**
 * Text measurement and wrapping. Layout is a pure function, so measurement is
 * injected: the app measures with canvas metrics of the real fonts, and tests
 * use the deterministic approximation below.
 */
export type FontFamily = 'Inter' | 'Caveat' | 'Permanent Marker'

export interface TextMeasure {
  /** Width in meters of `text` set in `family` at `size` meters. */
  (text: string, family: FontFamily, size: number, weight?: number): number
}

const NARROW = new Set('iljtfrI.,:;!|\'"()[] ')
const WIDE = new Set('mwMW@')

/** Rough per-glyph advance, in em. Good enough for tests and first paint. */
export const approximateMeasure: TextMeasure = (text, family, size) => {
  const scale = family === 'Caveat' ? 0.78 : family === 'Permanent Marker' ? 1.05 : 1
  let em = 0
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.3
    else if (WIDE.has(ch)) em += 0.82
    else if (ch >= 'A' && ch <= 'Z') em += 0.66
    else if (ch >= '0' && ch <= '9') em += 0.58
    else em += 0.53
  }
  return em * size * scale
}

let canvasCtx: CanvasRenderingContext2D | null = null
const cache = new Map<string, number>()

/** Canvas-based measurement using the same font files the SDF text renders. */
export const canvasMeasure: TextMeasure = (text, family, size, weight = 400) => {
  if (!canvasCtx) {
    const canvas = document.createElement('canvas')
    canvasCtx = canvas.getContext('2d')
    if (!canvasCtx) return approximateMeasure(text, family, size, weight)
  }
  const key = `${family}|${weight}|${text}`
  let w = cache.get(key)
  if (w === undefined) {
    canvasCtx.font = `${weight} 100px "${family}"`
    w = canvasCtx.measureText(text).width / 100
    if (cache.size > 20000) cache.clear()
    cache.set(key, w)
  }
  return w * size
}

export function clearMeasureCache() {
  cache.clear()
}

/**
 * Greedy word wrap to `maxWidth`, clamped to `maxLines` with an ellipsis.
 * Words longer than a line are broken by character.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: TextMeasure,
  family: FontFamily,
  size: number,
  maxLines = Infinity,
  weight = 400,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let line = ''
  const fits = (s: string) => measure(s, family, size, weight) <= maxWidth

  const pushWord = (word: string) => {
    const candidate = line ? `${line} ${word}` : word
    if (fits(candidate)) {
      line = candidate
      return
    }
    if (line) lines.push(line)
    line = ''
    if (fits(word)) {
      line = word
      return
    }
    // Break an overlong word.
    let chunk = ''
    for (const ch of word) {
      if (fits(chunk + ch)) chunk += ch
      else {
        lines.push(chunk)
        chunk = ch
      }
    }
    line = chunk
  }

  for (const w of words) pushWord(w)
  if (line) lines.push(line)

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    let last = kept[maxLines - 1]
    while (last.length > 0 && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd()
    kept[maxLines - 1] = `${last}…`
    return kept
  }
  return lines
}

/** Truncate a single line with an ellipsis. */
export function ellipsize(text: string, maxWidth: number, measure: TextMeasure, family: FontFamily, size: number, weight = 400) {
  if (measure(text, family, size, weight) <= maxWidth) return text
  let t = text
  while (t.length > 0 && measure(`${t}…`, family, size, weight) > maxWidth) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}
