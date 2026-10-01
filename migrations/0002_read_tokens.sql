-- Existing v2 links remain readable until their original expiration.
-- New messages require a SHA-256 digest of an independent 256-bit read token.
ALTER TABLE pastes ADD COLUMN read_token_hash TEXT;
