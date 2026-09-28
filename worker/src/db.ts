import type { ExternalRef, ProviderId } from '../../src/integrations/protocol'
import { randomToken, sha256Hex } from './crypto'

export const SESSION_TTL_MS = 180 * 86_400_000
export const STATE_TTL_MS = 10 * 60_000
const CREATED_TTL_MS = 30 * 86_400_000

export interface ConnectionRow {
  user_id: string
  provider: ProviderId
  account_id: string
  account_name: string
  access_token: string
  refresh_token: string | null
  expires_at: number | null
  meta: string
  connected_at: number
  updated_at: number
}

export class Store {
  constructor(private db: D1Database) {}

  // ——— users & sessions ———

  async createUser(now = Date.now()): Promise<string> {
    const id = randomToken(16)
    await this.db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').bind(id, now).run()
    return id
  }

  /** Returns the raw session token for the cookie. */
  async createSession(userId: string, now = Date.now()): Promise<string> {
    const token = randomToken(32)
    await this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), userId, now, now + SESSION_TTL_MS)
      .run()
    return token
  }

  async sessionUser(token: string | undefined, now = Date.now()): Promise<string | null> {
    if (!token) return null
    const row = await this.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha256Hex(token), now).first<{ user_id: string }>()
    return row?.user_id ?? null
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
  }

  // ——— OAuth state ———

  async createState(provider: ProviderId, returnTo: string, now = Date.now()): Promise<string> {
    const state = randomToken(24)
    await this.db.batch([
      this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
      this.db.prepare('INSERT INTO oauth_states (state, provider, return_to, expires_at) VALUES (?, ?, ?, ?)').bind(state, provider, returnTo, now + STATE_TTL_MS),
    ])
    return state
  }

  /** Looks up and deletes a state (single use). */
  async consumeState(state: string, provider: ProviderId, now = Date.now()): Promise<{ returnTo: string } | null> {
    const row = await this.db.prepare('SELECT return_to, expires_at FROM oauth_states WHERE state = ? AND provider = ?').bind(state, provider).first<{ return_to: string; expires_at: number }>()
    if (!row) return null
    await this.db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run()
    return row.expires_at > now ? { returnTo: row.return_to } : null
  }

  // ——— connections ———

  async connections(userId: string): Promise<ConnectionRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM connections WHERE user_id = ? ORDER BY connected_at').bind(userId).all<ConnectionRow>()
    return results
  }

  async connection(userId: string, provider: ProviderId): Promise<ConnectionRow | null> {
    return this.db.prepare('SELECT * FROM connections WHERE user_id = ? AND provider = ?').bind(userId, provider).first<ConnectionRow>()
  }

  /** The user who already connected this account (to sign in on another device). */
  async userForAccount(provider: ProviderId, accountId: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT user_id FROM connections WHERE provider = ? AND account_id = ? ORDER BY updated_at DESC LIMIT 1').bind(provider, accountId).first<{ user_id: string }>()
    return row?.user_id ?? null
  }

  async saveConnection(row: Omit<ConnectionRow, 'connected_at' | 'updated_at'>, now = Date.now()): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO connections (user_id, provider, account_id, account_name, access_token, refresh_token, expires_at, meta, connected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           account_id = excluded.account_id, account_name = excluded.account_name, access_token = excluded.access_token,
           refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, meta = excluded.meta, updated_at = excluded.updated_at`,
      )
      .bind(row.user_id, row.provider, row.account_id, row.account_name, row.access_token, row.refresh_token, row.expires_at, row.meta, now, now)
      .run()
  }

  async updateTokens(userId: string, provider: ProviderId, tokens: { access_token: string; refresh_token: string | null; expires_at: number | null }, now = Date.now()) {
    await this.db
      .prepare('UPDATE connections SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE user_id = ? AND provider = ?')
      .bind(tokens.access_token, tokens.refresh_token, tokens.expires_at, now, userId, provider)
      .run()
  }

  // ——— idempotent creates ———

  async createdItem(userId: string, provider: ProviderId, localId: string): Promise<ExternalRef | null> {
    const row = await this.db.prepare('SELECT ref FROM created_items WHERE user_id = ? AND provider = ? AND local_id = ?').bind(userId, provider, localId).first<{ ref: string }>()
    return row ? (JSON.parse(row.ref) as ExternalRef) : null
  }

  async saveCreatedItem(userId: string, provider: ProviderId, localId: string, ref: ExternalRef, now = Date.now()): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM created_items WHERE created_at < ?').bind(now - CREATED_TTL_MS),
      this.db.prepare('INSERT OR REPLACE INTO created_items (user_id, provider, local_id, ref, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, provider, localId, JSON.stringify(ref), now),
    ])
  }

  async deleteConnection(userId: string, provider: ProviderId): Promise<void> {
    await this.db.prepare('DELETE FROM connections WHERE user_id = ? AND provider = ?').bind(userId, provider).run()
  }
}
