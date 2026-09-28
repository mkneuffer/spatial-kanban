/** Minimal ULID: 48-bit millisecond timestamp + 80 bits of randomness, Crockford base32. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let lastTime = -1
let lastRandom: number[] = []

function randomChars(count: number): number[] {
  const bytes = new Uint8Array(count)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b % 32)
}

export function ulid(now: number = Date.now()): string {
  let random: number[]
  if (now === lastTime) {
    // Monotonic within the same millisecond: increment the previous random part.
    random = lastRandom.slice()
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i] < 31) {
        random[i]++
        break
      }
      random[i] = 0
    }
  } else {
    random = randomChars(16)
  }
  lastTime = now
  lastRandom = random

  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time
    t = Math.floor(t / 32)
  }
  return time + random.map((r) => ENCODING[r]).join('')
}

const DEVICE_KEY = 'spatial-kanban:device-id'

/** A stable id for this browser profile. Placements are keyed by it. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = ulid()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'ephemeral-device'
  }
}
