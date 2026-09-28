/** The slice of the Web Speech API the app uses (typed here; lib.dom doesn't ship it everywhere). */
export interface SpeechAlternative {
  transcript: string
  confidence?: number
}

export interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort?(): void
  onresult: ((e: { resultIndex?: number; results: ArrayLike<ArrayLike<SpeechAlternative> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
}

export function createRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = navigator.language || 'en-US'
  r.interimResults = true
  r.continuous = false
  r.maxAlternatives = 1
  return r
}
