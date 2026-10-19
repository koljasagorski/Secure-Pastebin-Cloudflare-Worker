-- SHA-256 of a password-derived proof. A short code alone no longer releases or burns anything.
-- Rows created by the first short-link release have no proof and become unreachable.
ALTER TABLE pastes ADD COLUMN auth_hash TEXT;
