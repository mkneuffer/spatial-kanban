-- Integrations backend schema. Board data stays in each browser (local-first);
-- the server only keeps who is connected to which tool, with encrypted tokens.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- The session cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One connected account per tool per user. Tokens are AES-GCM encrypted with
-- TOKEN_ENCRYPTION_KEY.
CREATE TABLE connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER,
  meta TEXT NOT NULL DEFAULT '{}',
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE INDEX connections_account ON connections(provider, account_id);

-- In-flight OAuth sign-ins (10 minutes).
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Cards created remotely, by the app's local card id, so a retried create
-- (e.g. after a lost response) returns the same item instead of a duplicate.
CREATE TABLE created_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  local_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider, local_id)
);
