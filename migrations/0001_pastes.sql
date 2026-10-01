CREATE TABLE IF NOT EXISTS pastes (
  id TEXT PRIMARY KEY NOT NULL,
  encrypted_data TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  burn_after_read INTEGER NOT NULL CHECK (burn_after_read IN (0, 1)),
  has_password INTEGER NOT NULL CHECK (has_password IN (0, 1))
);
CREATE INDEX IF NOT EXISTS pastes_expiry ON pastes (expires_at);
