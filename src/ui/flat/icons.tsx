import type { LabelIcon } from '../../data/model'

/** Label icons — every label pairs its color with a shape (PLAN §13). */
const PATHS: Record<LabelIcon, string> = {
  bug: 'M8 3a2 2 0 0 1 2 2h1.5l1-1.5 1 .7L12.6 6H13v2h1.5v1.2H13V10a5 5 0 0 1-.2 1.3l1.5 1-.7 1-1.4-1A5 5 0 0 1 8 14a5 5 0 0 1-4.2-1.7l-1.4 1-.7-1 1.5-1A5 5 0 0 1 3 10v-.8H1.5V8H3V6h.4L2.5 4.2l1-.7 1 1.5H6a2 2 0 0 1 2-2z',
  star: 'M8 1.5l2 4.2 4.6.6-3.4 3.2.9 4.5L8 11.8l-4.1 2.2.9-4.5L1.4 6.3 6 5.7z',
  brush: 'M13.6 1.7a1 1 0 0 1 .7 1.7L9 8.7 7.3 7l5.3-5.3a1 1 0 0 1 1-.1zM6.4 7.9l1.7 1.7c-.3 2.3-2 3.9-5.6 4.4.9-1.1.9-2.3 1.2-3.5.3-1.4 1.3-2.4 2.7-2.6z',
  book: 'M2 2.5h4a2 2 0 0 1 2 1.6 2 2 0 0 1 2-1.6h4v10h-4a1.5 1.5 0 0 0-1.5 1H7.5A1.5 1.5 0 0 0 6 12.5H2z',
  bolt: 'M9.5 1L3 9h4l-1 6 6.5-8h-4z',
  cube: 'M8 1l6 3.2v7.6L8 15l-6-3.2V4.2zm0 1.6L3.8 4.8 8 7l4.2-2.2zM3 5.9v5.3l4.4 2.3V8.2zm10 0L8.6 8.2v5.3L13 11.2z',
  flag: 'M3 1.5h1.3v1h8.2l-1.8 3.2 1.8 3.3H4.3v5.5H3z',
  dot: 'M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
}

export function LabelGlyph({ icon }: { icon?: LabelIcon }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d={PATHS[icon ?? 'dot']} />
    </svg>
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0d1117" />
      <rect x="10" y="12" width="13" height="40" rx="3" fill="#2f81f7" />
      <rect x="26" y="12" width="13" height="28" rx="3" fill="#a371f7" />
      <rect x="42" y="12" width="13" height="18" rx="3" fill="#3fb950" />
      <rect x="41" y="34" width="15" height="15" rx="1.5" fill="#ffd84d" transform="rotate(-6 48 41)" />
    </svg>
  )
}

export function Icon({ name }: { name: 'undo' | 'redo' | 'more' | 'close' | 'plus' | 'cube' | 'board' | 'glasses' | 'phone' | 'archive' | 'trash' | 'help' }) {
  const d: Record<typeof name, string> = {
    undo: 'M5.5 3.5L2 7l3.5 3.5M2.5 7h7a4 4 0 0 1 0 8H8',
    redo: 'M10.5 3.5L14 7l-3.5 3.5M13.5 7h-7a4 4 0 0 0 0 8H8',
    more: 'M3 8h.01M8 8h.01M13 8h.01',
    close: 'M4 4l8 8M12 4l-8 8',
    plus: 'M8 3v10M3 8h10',
    cube: 'M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM8 8l5.5-3.5M8 8L2.5 4.5M8 8v6.5',
    board: 'M2 2.5h3.5v11H2zM6.25 2.5h3.5v7.5h-3.5zM10.5 2.5H14v5h-3.5z',
    glasses: 'M1.5 6.5h13v4a1.5 1.5 0 0 1-1.5 1.5h-2.5L8 10l-2.5 2H3a1.5 1.5 0 0 1-1.5-1.5z',
    phone: 'M4.5 1.5h7v13h-7zM7 12.5h2',
    archive: 'M2 3h12v3H2zM3 6v7.5h10V6M6.5 8.5h3',
    trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4',
    help: 'M6 6a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.5v.3M8 12h.01',
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 2.6 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={d[name]} />
    </svg>
  )
}
