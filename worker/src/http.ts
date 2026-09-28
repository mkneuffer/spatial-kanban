import type { ApiError } from '../../src/integrations/protocol'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ApiError['code'],
  ) {
    super(message)
  }
}

export const notConnected = (name: string) => new HttpError(401, `${name} isn’t connected.`, 'not_connected')
export const badRequest = (message: string) => new HttpError(400, message, 'bad_request')

const NO_STORE = { 'cache-control': 'no-store' }

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v)
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message, code: err.code } satisfies ApiError, { status: err.status })
  console.error(err)
  return json({ error: 'Something went wrong on the sync server.' } satisfies ApiError, { status: 500 })
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, ...NO_STORE })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(null, { status: 302, headers })
}

export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export interface CookieOptions {
  maxAge: number
  path: string
  secure: boolean
}

export function cookie(name: string, value: string, { maxAge, path, secure }: CookieOptions): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

export async function readJson<T>(req: Request, maxBytes = 512_000): Promise<T> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw badRequest('Expected a JSON body.')
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, 'Request too large.', 'bad_request')
  try {
    return JSON.parse(text) as T
  } catch {
    throw badRequest('Invalid JSON.')
  }
}

/** Only relative, same-origin paths are allowed as post-sign-in destinations. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  return value
}
