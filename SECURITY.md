# Security model

This is a small, unaudited browser-encrypted paste service. Security fixes and tests reduce specific risks; they do not establish that the application is safe for every threat model.

## What the design protects

- Message plaintext and passwords are encrypted/processed with Web Crypto on the client. The server receives an authenticated AES-256-GCM envelope, never the decryption key or password through application requests.
- A database-only disclosure exposes ciphertext, metadata, and read-token hashes. It does not disclose the random decryption key or password salt from the fragment. Ciphertext length still reveals approximate message length.
- Each new message requires an independent 256-bit read token. Only its SHA-256 digest is stored. Retrieval authorization and one-time deletion occur in the same atomic database statement.
- An ID copied from a request URL cannot by itself read or consume a newly created message. Missing/wrong tokens and nonexistent IDs get the same generic 404 response. The server does receive the read token on authorized retrieval; it is not an encryption secret.
- Expiration is enforced before returning any message. One-time retrieval, including concurrent requests, returns the ciphertext at most once.
- Strict CSP, Trusted Types where supported, origin checks, cross-origin isolation, literal text rendering, HTTPS, size limits, and rate limits provide additional protection against injection, browser isolation failures, and casual abuse. The application does not execute pasted HTML or JavaScript.

## What it does not protect

- A malicious or compromised operator, deployment credential, GitHub account, hosting platform, or dependency used during a build could replace the browser code and capture secrets. For that threat model, use an independently verified encryption client and share only its ciphertext here.
- A compromised browser/device or privileged extension can read secrets. Clearing fields/history is best effort, not guaranteed memory erasure.
- Anyone who obtains a complete non-password link can decrypt it. With a password-protected link and ciphertext, attackers can attempt offline guessing. Use a long unique passphrase and a separate channel to share it.
- Anyone with the ID and read token can consume a one-time message before its intended recipient, even without the password. Burn happens before decryption, so interrupted delivery may make the message unrecoverable.
- Recipients can copy plaintext. Expiration/deletion cannot recall previously downloaded data. Cloudflare D1 Time Travel and other provider backups may retain encrypted copies.
- Old v2 messages do not have a read token. They remain compatible and retain their original ID-only retrieval behavior until expiration. Newly created messages always require a token.
- The provider can see network metadata. Local rate limiting is approximate and per Cloudflare location, so distributed abuse and resource exhaustion remain possible.

## Implementation references

- AES-GCM: 256-bit key, fresh 96-bit IV, 128-bit authentication tag. Random-key messages use a new key per message.
- Password mode: PBKDF2-HMAC-SHA-256, 600,000 iterations, fresh 128-bit salt; minimum 12 characters. A minimum length alone does not guarantee a strong password.
- Read authorization: independent random 256-bit token, SHA-256 digest at rest, new versioned fragments. No custom encryption algorithm or cipher layering.
- Automatic deployment runs type checks and regression tests before migrations and publication. Changes to build credentials or the GitHub integration are managed in Cloudflare, outside this repository.

## Reporting

Private vulnerability reporting is enabled on this repository. Use **[Security → Report a vulnerability](https://github.com/koljasagorski/Secure-Pastebin-Cloudflare-Worker/security)**. Avoid publishing active share links, passwords, credentials, or a working exploit against production in public issues. For forks without private reporting, open an issue requesting a private contact without disclosing the vulnerability details. Maintainers should reproduce reports using synthetic messages and add a regression test with each fix.
