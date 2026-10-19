-- Files live in R2 under the paste ID, the row holds the IV and expiry.
-- Short codes exist only for password-protected pastes. The salt is public by design (PBKDF2).
ALTER TABLE pastes ADD COLUMN kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'file'));
ALTER TABLE pastes ADD COLUMN salt TEXT;
ALTER TABLE pastes ADD COLUMN short_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pastes_short_code ON pastes (short_code) WHERE short_code IS NOT NULL;
