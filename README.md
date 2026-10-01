# Secure Pastebin

Share encrypted, expiring text at **[p.sgr.ski](https://p.sgr.ski)**.

[![CI](https://github.com/koljasagorski/Secure-Pastebin-Cloudflare-Worker/actions/workflows/ci.yml/badge.svg)](https://github.com/koljasagorski/Secure-Pastebin-Cloudflare-Worker/actions/workflows/ci.yml)

A small Cloudflare Worker with browser-side encryption, optional password protection, and one-time retrieval. No account, analytics, third-party scripts, or external fonts are required. This maintained fork builds on [TheGreatAzizi's original project](https://github.com/TheGreatAzizi/Secure-Pastebin-Cloudflare-Worker).

## Using it

1. Enter a message (up to **64 KiB of UTF-8 text**) and choose an expiration: 1 hour, 1 day, 1 week, or 30 days.
2. Optionally enable a password (at least 12 characters) and **Burn after reading**.
3. Select **Encrypt & Save** and send the complete link to the recipient. Share any password separately.
4. The recipient selects **Open message**, then enters the password if required.

Whitespace, code, and Unicode text are preserved. Message text is displayed as text, never rendered as HTML. Losing the complete link means losing access.

## Encryption and privacy

- Encryption and decryption use the browser's Web Crypto API: **AES-256-GCM**, a fresh 12-byte IV, and a 256-bit key.
- Without a password, the browser generates a random key. With a password, **PBKDF2-HMAC-SHA-256 with 600,000 iterations** derives the key from a random 16-byte salt.
- The key, or password salt, stays in the URL fragment after `#`. Browsers do not include that fragment in HTTP requests. Passwords and plaintext are never submitted by the application.
- Cloudflare D1 stores ciphertext, a random ID, creation/expiration timestamps, and the password/burn flags. The production database uses Cloudflare's EU jurisdiction.
- API and page responses use `Cache-Control: no-store`, a restrictive script policy, `Referrer-Policy: no-referrer`, and anti-framing headers.
- The application logs only a generic failure event, with invocation logs and tracing disabled. This does **not** mean the hosting provider has no network metadata or operational logs.

### What “burn after reading” means

The first explicit retrieval atomically deletes the ciphertext from the active database and returns it in one SQL statement. Concurrent requests cannot both retrieve it. Loading the page, link previews using GET/HEAD, and opening the password prompt do not cause an additional retrieval.

Deletion happens **before browser decryption**. A failed network response or lost tab can therefore lose a one-time message. A wrong password can be retried in the same tab because the ciphertext remains in memory. Anyone with the message ID can consume a one-time message even without its key; recipients can also save or copy the plaintext.

Expiration is checked on every retrieval and never extended or shortened by reading. A scheduled cleanup removes up to 1,000 expired rows every 15 minutes; a backlog can delay physical cleanup without making expired messages readable. Deletion from active storage is not a promise of immediate erasure from provider backups: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) may retain earlier database states.

### Trust boundaries

This is not an audited cryptographic product. You trust the code served by the operator, your browser, and your device. A compromised host could serve altered JavaScript; a compromised browser or extension could read the fragment or plaintext. Link-sharing services and browser history can retain complete links. Passwords are susceptible to offline guessing if an attacker obtains both the ciphertext and password salt; use a strong passphrase.

## Local development

Use Node.js 22 or newer and npm. The repository pins development tools in `package-lock.json`; the Worker has no third-party runtime dependencies.

```sh
npm ci
npm run db:local
npm run dev
```

Open `http://localhost:8787`. Local D1 state lives under `.wrangler/` and does not affect production.

```sh
npm run types       # regenerate Worker binding/runtime types after config changes
npm run check       # TypeScript, deploy dry run, crypto and local-runtime tests
npm audit           # dependency advisory check
```

Tests exercise real Web Crypto and D1 in Cloudflare's local runtime, including 20 concurrent reads of a one-time message, expiration, request-size limits, malformed input, origin checks, rate limiting, and password retry.

## Deployment and GitHub updates

Production is the `secure-pastebin` Worker on **p.sgr.ski**. Infrastructure and bindings are defined in [`wrangler.jsonc`](wrangler.jsonc); schema migrations live in [`migrations/`](migrations/).

Cloudflare Workers Builds watches the `main` branch of `koljasagorski/Secure-Pastebin-Cloudflare-Worker`:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm ci && npm run check` |
| Deploy command | `npm run deploy` |
| Watched paths | All files |
| Preview branches | Disabled |

A push to `main` runs the checks, applies pending D1 migrations, and deploys the Worker. A failing build leaves the currently deployed Worker running. GitHub Actions independently runs CI for pushes and pull requests; Dependabot opens weekly tool/action update PRs. Updates are reviewed before merging.

Inspect deployments in Cloudflare **Workers & Pages → secure-pastebin → Builds**. The Git integration and its build credential are stored by Cloudflare, outside this repository. A GitHub Actions deployment secret is not required. Keep that build credential valid; revoking it stops automatic deployments.

For a manual deployment, authenticate with `npx wrangler login` (or provide a scoped `CLOUDFLARE_API_TOKEN` through your environment), run `npm run check`, then `npm run deploy`. Deploy requires Worker script and route permissions for this account/zone and D1 access for migrations. Never put credentials in source files.

### Deploying your own fork

1. Fork this repository and install dependencies with `npm ci`.
2. Run `npx wrangler login` and `npx wrangler d1 create secure-pastebin`.
3. Replace `account_id`, the D1 `database_id`/name, Worker name, and custom-domain route in `wrangler.jsonc`. Use a domain in an active Cloudflare zone. Alternatively remove `routes` and enable `workers_dev`.
4. Run `npm run types`, `npm run check`, and `npm run deploy`.
5. Connect your fork through Workers Builds using the settings above and a deployment credential with the required permissions.

Cloudflare provisions DNS and HTTPS for a Workers Custom Domain; do not manually add a CNAME to `workers.dev`. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) and [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).

Creation is limited to 10 requests/minute and retrieval to 60 requests/minute per client IP **per Cloudflare location**. Cloudflare's rate limiter is approximate, not a global quota. Workers, D1, and Builds usage is subject to your Cloudflare plan and limits.

## Changes from version 1

- Fixes the bug that shortened messages to one hour when read.
- Replaces eventually consistent KV get/delete with atomic D1 retrieval and deletion.
- Prevents caller-selected IDs from overwriting messages.
- Bounds request size while streaming, validates encrypted envelopes and expiration, and limits API traffic.
- Uses explicit POST retrieval to avoid accidental consumption by prefetching.
- Updates password derivation, clipboard handling, deployment tooling, and security headers; removes external fonts and inline script handlers.
- Separates server, browser crypto, UI, migrations, and tests; adds CI and dependency updates.

**Version 2 is a storage/API/link-format change.** Existing version 1 KV data and links are not migrated or read by this version. For an existing v1 installation, keep its Worker/domain available until its messages expire before switching. This repository's `p.sgr.ski` deployment starts with a new database.

## Layout

```text
src/worker.ts             HTTP API, security headers, D1 storage, cleanup
web/                     HTML, CSS, browser application and crypto
migrations/              Versioned D1 schema
worker-configuration.d.ts Generated platform/binding types
wrangler.jsonc           Cloudflare deployment configuration
test/                   Crypto and local-runtime regression tests
.github/                 CI and Dependabot configuration
```

## License and attribution

[MIT](LICENSE). Original project by [TheGreatAzizi](https://github.com/TheGreatAzizi); maintained deployment and improvements by [koljasagorski](https://github.com/koljasagorski). Original license attribution is preserved.
