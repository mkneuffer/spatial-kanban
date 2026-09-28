const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

const keys = new Map<string, Promise<CryptoKey>>()

/** AES-256-GCM key derived from the secret (any length; SHA-256 stretches it to 32 bytes). */
function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret)
  if (!key) {
    key = crypto.subtle.digest('SHA-256', enc.encode(secret)).then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
    keys.set(secret, key)
  }
  return key
}

export async function encrypt(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), enc.encode(plaintext)))
  return `v1.${b64url(iv)}.${b64url(data)}`
}

export async function decrypt(secret: string, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !data) throw new Error('Unrecognized token format')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await keyFor(secret), fromB64url(data))
  return dec.decode(plain)
}
