import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/caveat/500.css'
import '@fontsource/caveat/700.css'
import '@fontsource/permanent-marker/400.css'
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url'
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff?url'
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url'
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url'
import caveat500 from '@fontsource/caveat/files/caveat-latin-500-normal.woff?url'
import caveat700 from '@fontsource/caveat/files/caveat-latin-700-normal.woff?url'
import marker from '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff?url'
import { preloadFont } from 'troika-three-text'

/** Font files for SDF text (troika). The same families are registered for DOM/canvas via Fontsource CSS. */
export const FONTS = {
  inter400,
  inter500,
  inter600,
  inter700,
  caveat500,
  caveat700,
  marker,
}

/** Characters we pre-bake into the SDF atlas so the first render doesn't stutter. */
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?\'"()[]{}#&@%+-–—/…·×✓•<>=_*'

export function preloadSdfFonts(): Promise<void> {
  const list = [FONTS.inter400, FONTS.inter500, FONTS.inter600, FONTS.inter700, FONTS.caveat700, FONTS.marker]
  return Promise.all(
    list.map((font) => new Promise<void>((resolve) => preloadFont({ font, characters: CHARSET }, () => resolve()))),
  ).then(() => undefined)
}

/** Resolve once the DOM/canvas fonts are available for measurement. */
export async function loadMeasureFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all([
    document.fonts.load('500 16px "Inter"'),
    document.fonts.load('400 16px "Inter"'),
    document.fonts.load('600 16px "Inter"'),
    document.fonts.load('500 16px "Caveat"'),
    document.fonts.load('700 16px "Caveat"'),
    document.fonts.load('400 16px "Permanent Marker"'),
  ]).catch(() => undefined)
}
