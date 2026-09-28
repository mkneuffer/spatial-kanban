/**
 * Procedural UI sounds (PLAN §6.4, §7). Synthesized with WebAudio so there are
 * no audio assets to load: soft clicks for Projects, paper for the whiteboard.
 */
export type SoundName =
  | 'click'
  | 'clickSoft'
  | 'tick'
  | 'drop'
  | 'peel'
  | 'slap'
  | 'tear'
  | 'stick'
  | 'whoosh'
  | 'key'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
let enabled = true

export function setSoundEnabled(on: boolean) {
  enabled = on
}

function audio(): AudioContext | null {
  if (!enabled) return null
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.6
      master.connect(ctx.destination)
      const len = Math.floor(ctx.sampleRate * 0.5)
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Call from a user gesture so later sounds are allowed to play. */
export function unlockAudio() {
  audio()
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
}

function tone(freq: number, freqEnd: number, peak: number, attack: number, decay: number, type: OscillatorType = 'sine', delay = 0) {
  const a = audio()
  if (!a || !master) return
  const t = a.currentTime + delay
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay)
  env(g, t, peak, attack, decay)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + attack + decay + 0.02)
}

function noise(filter: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number, delay = 0) {
  const a = audio()
  if (!a || !master || !noiseBuffer) return
  const t = a.currentTime + delay
  const src = a.createBufferSource()
  src.buffer = noiseBuffer
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const bq = a.createBiquadFilter()
  bq.type = filter
  bq.Q.value = q
  bq.frequency.setValueAtTime(f0, t)
  bq.frequency.exponentialRampToValueAtTime(f1, t + attack + decay)
  const g = a.createGain()
  env(g, t, peak, attack, decay)
  src.connect(bq).connect(g).connect(master)
  src.start(t, Math.random() * 0.2)
  src.stop(t + attack + decay + 0.05)
}

export function playSound(name: SoundName) {
  switch (name) {
    case 'click':
      tone(1800, 1100, 0.12, 0.002, 0.035, 'triangle')
      break
    case 'clickSoft':
      tone(1200, 900, 0.07, 0.002, 0.03, 'sine')
      break
    case 'tick':
      tone(2600, 2400, 0.035, 0.001, 0.012, 'sine')
      break
    case 'drop':
      tone(900, 600, 0.1, 0.002, 0.05, 'triangle')
      tone(600, 420, 0.08, 0.002, 0.06, 'sine', 0.035)
      break
    case 'peel':
      noise('bandpass', 1800, 5200, 1.4, 0.18, 0.02, 0.14)
      break
    case 'slap':
      noise('lowpass', 2400, 500, 0.7, 0.35, 0.002, 0.07)
      tone(150, 80, 0.18, 0.002, 0.06, 'sine')
      break
    case 'tear':
      noise('bandpass', 900, 3800, 2.5, 0.22, 0.01, 0.22)
      break
    case 'stick':
      noise('lowpass', 1600, 400, 0.8, 0.2, 0.002, 0.05)
      break
    case 'whoosh':
      noise('bandpass', 3000, 400, 0.9, 0.18, 0.04, 0.25)
      break
    case 'key':
      tone(1400, 1300, 0.05, 0.001, 0.02, 'square')
      break
  }
}
