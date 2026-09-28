import { Color } from 'three'

export interface ProjectsPalette {
  board: string
  boardAlpha: number
  lane: string
  laneBorder: string
  card: string
  cardBorder: string
  text: string
  muted: string
  accent: string
  warn: string
  danger: string
  pad: string
  shadow: number
  avatarText: string
}

export function projectsPalette(dark: boolean, highContrast: boolean): ProjectsPalette {
  if (dark) {
    return {
      board: '#0d1117',
      boardAlpha: 0.94,
      lane: highContrast ? '#010409' : '#151b23',
      laneBorder: highContrast ? '#9198a1' : '#262c36',
      card: highContrast ? '#0d1117' : '#1f2630',
      cardBorder: highContrast ? '#f0f6fc' : '#3d444d',
      text: highContrast ? '#ffffff' : '#e6edf3',
      muted: highContrast ? '#d1d7e0' : '#9198a1',
      accent: '#4493f8',
      warn: '#d29922',
      danger: '#f85149',
      pad: '#262c36',
      shadow: 0.55,
      avatarText: '#ffffff',
    }
  }
  return {
    board: '#f6f8fa',
    boardAlpha: 0.96,
    lane: highContrast ? '#ffffff' : '#eaeef2',
    laneBorder: highContrast ? '#1f2328' : '#d1d9e0',
    card: '#ffffff',
    cardBorder: highContrast ? '#1f2328' : '#d1d9e0',
    text: highContrast ? '#000000' : '#1f2328',
    muted: highContrast ? '#1f2328' : '#59636e',
    accent: '#0969da',
    warn: '#9a6700',
    danger: '#cf222e',
    pad: '#dde3ea',
    shadow: 0.22,
    avatarText: '#ffffff',
  }
}

/** Label pill fill: a tint of the label color that keeps text contrast. */
export function pillBg(color: string, dark: boolean): string {
  const c = new Color(color)
  const base = new Color(dark ? '#1f2630' : '#ffffff')
  return '#' + base.lerp(c, dark ? 0.35 : 0.2).getHexString()
}

export function pillText(color: string, dark: boolean): string {
  const c = new Color(color)
  return '#' + (dark ? c.lerp(new Color('#ffffff'), 0.45) : c.lerp(new Color('#000000'), 0.35)).getHexString()
}
