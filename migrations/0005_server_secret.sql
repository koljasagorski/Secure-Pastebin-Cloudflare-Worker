-- Random server-side key for fake short-link salts, so outsiders cannot recompute them.
CREATE TABLE IF NOT EXISTS server_secrets (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
INSERT OR IGNORE INTO server_secrets (name, value) VALUES ('short_salt', lower(hex(randomblob(32))));
