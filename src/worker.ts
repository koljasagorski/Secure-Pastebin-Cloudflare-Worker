import HTML from '../web/index.html';
import CSS from '../web/style.css';
import APP from '../web/app.browser.js';
import CRYPTO from '../web/crypto.browser.js';
import ICON from '../web/favicon.svg';
import FONT from '../web/fonts/dm-sans.woff2';
import CLOUDFLARE_BADGE from '../web/cloudflare-badge.png';

const MAX_BODY = 96 * 1024;
const MAX_CIPHERTEXT = 65536 + 16;
const MAX_UPLOAD = 100_000_000; // Workers request body limit on Free/Pro; files are sent in one request.
const MAX_META = 2048;
const ID = /^[a-f0-9]{32}$/;
const SHORT = /^[2-9a-hj-km-np-z]{6}$/;
const SHORT_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const TTL = new Set([3600, 86400, 172800, 604800, 2592000]);
const FILE_TTL = new Set([3600, 86400, 172800]);
const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=(), browsing-topics=(), clipboard-read=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'X-Robots-Tag': 'noindex, nofollow',
};

type Envelope = { version: 2; iv: string; data: string };
type Paste = {
  id: string;
  kind: 'text' | 'file';
  salt: string | null;
  encrypted_data: string;
  created: number;
  expires_at: number;
  burn_after_read: number;
  has_password: number;
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function response(body: BodyInit | null, status = 200, headers: HeadersInit = {}) {
  return new Response(body, { status, headers: { ...HEADERS, ...headers } });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return response(JSON.stringify(body), status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64Bytes(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return raw.length >= min && raw.length <= max && btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value;
  } catch { return false; }
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

// Six characters without look-alikes (no 0/1/i/l/o), drawn without modulo bias.
function shortCode() {
  let code = '';
  while (code.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 248 && code.length < 6) code += SHORT_ALPHABET[byte % 31];
    }
  }
  return code;
}

async function readBody(request: Request, maxBytes = MAX_BODY): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Use application/json');
  }
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'Request too large');
  if (!request.body) throw new HttpError(400, 'Missing JSON body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'Request too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
}

type Options = { expiresIn: number; burnAfterRead: boolean; hasPassword: boolean; readTokenHash: string; short: boolean; salt: string | null };

function options(body: Record<string, unknown>, ttl: Set<number>): Options {
  const { expiresIn, burnAfterRead, hasPassword, readTokenHash, short, salt } = body;
  if (typeof expiresIn !== 'number' || !ttl.has(expiresIn)) throw new HttpError(400, 'Invalid expiration');
  if (typeof burnAfterRead !== 'boolean' || typeof hasPassword !== 'boolean') throw new HttpError(400, 'Invalid options');
  if (!base64Bytes(readTokenHash, 32, 32)) throw new HttpError(400, 'A read token is required. Refresh the page and try again.');
  if (short !== undefined && typeof short !== 'boolean') throw new HttpError(400, 'Invalid options');
  // A short link has no key in it, so it is only offered together with a password.
  // The PBKDF2 salt is public and must be stored for short-link retrieval.
  if (short && (!hasPassword || !base64Bytes(salt, 16, 16))) throw new HttpError(400, 'Short links require a password');
  return { expiresIn, burnAfterRead, hasPassword, readTokenHash, short: short === true, salt: short ? salt as string : null };
}

async function insert(env: Env, id: string, kind: Paste['kind'], envelope: object, o: Options) {
  const created = Date.now();
  const expiresAt = created + o.expiresIn * 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = o.short ? shortCode() : null;
    try {
      await env.DB.prepare('INSERT INTO pastes (id, kind, encrypted_data, created, expires_at, burn_after_read, has_password, read_token_hash, salt, short_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, kind, JSON.stringify(envelope), created, expiresAt, Number(o.burnAfterRead), Number(o.hasPassword), o.readTokenHash, o.salt, code).run();
      return { id, expiresAt, ...(code ? { shortCode: code } : {}) };
    } catch (error) {
      if (!o.short || !/UNIQUE/i.test(String(error))) throw error;
    }
  }
  throw new HttpError(503, 'Please try again');
}

async function create(request: Request, env: Env) {
  const body = await readBody(request);
  if (!object(body)) throw new HttpError(400, 'Invalid request');
  const { encryptedData } = body;
  if (!object(encryptedData) || encryptedData.version !== 2 ||
      !base64Bytes(encryptedData.iv, 12, 12) || !base64Bytes(encryptedData.data, 17, MAX_CIPHERTEXT)) {
    throw new HttpError(400, 'Invalid encrypted data');
  }
  const o = options(body, TTL);
  // IDs are generated by the server: a caller can never overwrite an existing paste.
  const id = crypto.randomUUID().replaceAll('-', '');
  const envelope: Envelope = { version: 2, iv: encryptedData.iv, data: encryptedData.data };
  return json(await insert(env, id, 'text', envelope, o), 201);
}

// The body is raw ciphertext (one request, up to MAX_UPLOAD bytes); options travel in a header.
async function upload(request: Request, env: Env) {
  const length = Number(request.headers.get('content-length'));
  if (!Number.isInteger(length) || length < 21) throw new HttpError(400, 'Missing or invalid Content-Length');
  if (length > MAX_UPLOAD) throw new HttpError(413, 'File exceeds the 100 MB limit');
  const header = request.headers.get('x-paste-meta') ?? '';
  let meta: unknown;
  try {
    if (header.length > MAX_META) throw new Error();
    meta = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(fromBase64Url(header)));
  } catch { throw new HttpError(400, 'Invalid upload options'); }
  if (!object(meta) || !base64Bytes(meta.iv, 12, 12)) throw new HttpError(400, 'Invalid upload options');
  const o = options(meta, FILE_TTL);
  if (!request.body) throw new HttpError(400, 'Missing file');
  const id = crypto.randomUUID().replaceAll('-', '');
  const stored = await env.FILES.put(id, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
  try {
    if (stored.size !== length) throw new HttpError(400, 'Incomplete upload');
    return json(await insert(env, id, 'file', { version: 2, iv: meta.iv }, o), 201);
  } catch (error) {
    await env.FILES.delete(id).catch(() => undefined);
    throw error;
  }
}

const COLUMNS = 'id, kind, salt, encrypted_data, created, expires_at, burn_after_read, has_password';

// DELETE ... RETURNING is one atomic statement. Concurrent requests cannot both
// receive a one-time paste. Authorization is part of that same statement.
// `condition` is always a constant from this file, never request input.
async function take(env: Env, condition: string, params: unknown[]) {
  const now = Date.now();
  const burned = await env.DB.prepare(`DELETE FROM pastes WHERE ${condition} AND burn_after_read = 1 AND expires_at > ? RETURNING ${COLUMNS}`)
    .bind(...params, now).first<Paste>();
  return burned ?? await env.DB.prepare(`SELECT ${COLUMNS} FROM pastes WHERE ${condition} AND burn_after_read = 0 AND expires_at > ?`)
    .bind(...params, now).first<Paste>();
}

async function read(request: Request, env: Env, ctx: ExecutionContext, short: boolean, key: string) {
  const body = await readBody(request, 1024);
  if (!object(body)) throw new HttpError(400, 'Invalid request');
  let paste: Paste | null;
  if (short) {
    // The short code is the only credential here; the password protects the content.
    paste = await take(env, 'short_code = ?', [key]);
  } else {
    let tokenHash: string | null = null;
    if (body.readToken !== undefined) {
      if (!base64Bytes(body.readToken, 32, 32)) throw new HttpError(400, 'Invalid read token');
      tokenHash = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(body.readToken))));
    }
    // NULL hashes belong only to existing v2 rows; new creates require a hash.
    paste = await take(env, 'id = ? AND read_token_hash IS ?', [key, tokenHash]);
  }
  if (!paste) return json({ error: 'Message not found, expired, or already opened' }, 404);
  const meta = { created: paste.created, expiresAt: paste.expires_at, burnAfterRead: Boolean(paste.burn_after_read),
    hasPassword: Boolean(paste.has_password), ...(short && paste.salt ? { salt: paste.salt } : {}) };
  if (paste.kind === 'file') {
    const file = await env.FILES.get(paste.id);
    if (!file) return json({ error: 'Message not found, expired, or already opened' }, 404);
    if (paste.burn_after_read) ctx.waitUntil(env.FILES.delete(paste.id));
    const { iv } = JSON.parse(paste.encrypted_data);
    return response(file.body, 200, { 'Content-Type': 'application/octet-stream',
      'X-Paste-Meta': toBase64Url(new TextEncoder().encode(JSON.stringify({ ...meta, iv }))) });
  }
  return json({ data: JSON.parse(paste.encrypted_data), ...meta });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      url.protocol = 'https:';
      return response(null, 308, { Location: url.href });
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        const match = /^\/api\/(read|short)\/([a-f0-9]{32}|[2-9a-hj-km-np-z]{6})$/.exec(url.pathname);
        const short = match?.[1] === 'short';
        const valid = match && (short ? SHORT : ID).test(match[2]);
        if (url.pathname !== '/api/create' && url.pathname !== '/api/upload' && !valid) return json({ error: 'Not found' }, 404);
        if (request.method !== 'POST') return json({ error: 'Use POST' }, 405, { Allow: 'POST' });
        const origin = request.headers.get('origin');
        if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
          return json({ error: 'Cross-origin requests are not allowed' }, 403);
        }
        const type = url.pathname === '/api/upload' ? 'application/octet-stream' : 'application/json';
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== type) {
          return json({ error: `Use ${type}` }, 415);
        }
        const limiter = valid ? env.READ_LIMITER : env.CREATE_LIMITER;
        const { success } = await limiter.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'local' });
        if (!success) return json({ error: 'Too many requests. Try again in a minute.' }, 429, { 'Retry-After': '60' });
        if (valid) return await read(request, env, ctx, short, match[2]);
        return await (url.pathname === '/api/upload' ? upload : create)(request, env);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return response('Method not allowed', 405, { Allow: 'GET, HEAD' });
      const assets: Record<string, [BodyInit, string]> = {
        '/': [HTML, 'text/html; charset=utf-8'],
        '/index.html': [HTML, 'text/html; charset=utf-8'],
        '/style.css': [CSS, 'text/css; charset=utf-8'],
        '/font.woff2': [FONT, 'font/woff2'],
        '/cloudflare-badge.png': [CLOUDFLARE_BADGE, 'image/png'],
        '/app.js': [APP, 'text/javascript; charset=utf-8'],
        '/crypto.js': [CRYPTO, 'text/javascript; charset=utf-8'],
        '/favicon.svg': [ICON, 'image/svg+xml'],
        '/favicon.ico': [ICON, 'image/svg+xml'],
      };
      // Short links (p.sgr.ski/k7m2xq) open the same page; the code never reaches the server until "Open".
      const asset = /^\/[2-9a-hj-km-np-z]{6}$/i.test(url.pathname) ? assets['/'] : assets[url.pathname];
      return asset ? response(request.method === 'HEAD' ? null : asset[0], 200, { 'Content-Type': asset[1] }) : response('Not found', 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Do not log request URLs, payloads, keys, or raw database exceptions.
      console.error(JSON.stringify({ event: 'request_failed' }));
      return json({ error: 'Service temporarily unavailable' }, 503);
    }
  },
  async scheduled(_event, env) {
    // Expiration is enforced at read time; this removes inaccessible data in batches.
    // Files go first so an R2 failure leaves the row in place for the next run.
    const now = Date.now();
    const files = await env.DB.prepare("SELECT id FROM pastes WHERE kind = 'file' AND expires_at <= ? LIMIT 1000").bind(now).all<{ id: string }>();
    const ids = files.results.map(row => row.id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await env.FILES.delete(batch);
      await env.DB.prepare(`DELETE FROM pastes WHERE id IN (${batch.map(() => '?').join(',')})`).bind(...batch).run();
    }
    await env.DB.prepare("DELETE FROM pastes WHERE id IN (SELECT id FROM pastes WHERE kind = 'text' AND expires_at <= ? LIMIT 1000)")
      .bind(now).run();
  },
} satisfies ExportedHandler<Env>;
