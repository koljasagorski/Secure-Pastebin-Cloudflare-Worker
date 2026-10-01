import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { encrypt, decrypt } from '../web/crypto.browser.js';

let mf, db, encrypted;
let ip = 0;
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
before(async () => {
  mf = new Miniflare({ workers: [{
    config: {
      name: 'paste',
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      manifest: {
        mainModule: 'worker.js',
        modulesRoot: resolve('dist'),
        modules: Object.fromEntries(readdirSync('dist')
          .filter(name => name === 'worker.js' || /^[a-f0-9]{40}-/.test(name))
          .map(name => [name, { type: name === 'worker.js' ? 'esm' : 'text', contents: readFileSync(resolve('dist', name), 'utf8') }])),
      },
      env: {
        DB: { type: 'd1', id: 'local-test' },
        ...Object.fromEntries(config.ratelimits.map(({ name, namespace_id, simple }) => [name, { type: 'rate-limit', namespace: namespace_id, simple }])),
      },
    },
    dev: { stripCfConnectingIp: false },
  }] });
  db = await mf.getD1Database('DB');
  for (const sql of readFileSync('migrations/0001_pastes.sql', 'utf8').split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  encrypted = await encrypt('local integration test\n  unchanged whitespace');
});
after(async () => { await mf?.dispose(); });

function post(path, body, headers = {}) {
  return mf.dispatchFetch('https://paste.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${++ip}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function payload(options = {}) {
  return { encryptedData: encrypted.encryptedData, expiresIn: 86400, burnAfterRead: false, hasPassword: false, ...options };
}
async function create(options = {}) {
  const response = await post('/api/create', payload(options));
  assert.equal(response.status, 201);
  return response.json();
}

test('repeated reads preserve the chosen expiration and return decryptable ciphertext', async () => {
  for (const ttl of [3600, 86400, 604800, 2592000]) {
    const { id, expiresAt } = await create({ expiresIn: ttl });
    for (let i = 0; i < 2; i++) {
      const response = await post(`/api/read/${id}`, {});
      assert.equal(response.status, 200);
      const paste = await response.json();
      assert.equal(paste.expiresAt, expiresAt);
      assert.equal(paste.expiresAt - paste.created, ttl * 1000);
      assert.equal(await decrypt(paste.data, encrypted.secret), 'local integration test\n  unchanged whitespace');
    }
    assert.equal((await db.prepare('SELECT expires_at FROM pastes WHERE id = ?').bind(id).first()).expires_at, expiresAt);
  }
});

test('exactly one of 20 concurrent reads receives a one-time paste', async () => {
  const { id } = await create({ burnAfterRead: true });
  const responses = await Promise.all(Array.from({ length: 20 }, () => post(`/api/read/${id}`, {})));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(responses.filter(r => r.status === 404).length, 19);
  assert.equal(await db.prepare('SELECT id FROM pastes WHERE id = ?').bind(id).first(), null);
});

test('GET, HEAD, and cross-origin requests cannot consume a one-time paste', async () => {
  const { id } = await create({ burnAfterRead: true });
  for (const method of ['GET', 'HEAD']) {
    const r = await mf.dispatchFetch(`https://paste.test/api/read/${id}`, { method });
    assert.equal(r.status, 405);
  }
  assert.equal((await post(`/api/read/${id}`, {}, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post(`/api/read/${id}`, {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(`/api/read/${id}`, {})).status, 200);
});

test('expired pastes are unreadable before cleanup runs', async () => {
  for (const burnAfterRead of [false, true]) {
    const { id } = await create({ burnAfterRead });
    await db.prepare('UPDATE pastes SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, id).run();
    assert.equal((await post(`/api/read/${id}`, {})).status, 404);
  }
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: '*/15 * * * *' });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pastes WHERE expires_at <= ?').bind(Date.now()).first()).n, 0);
});

test('invalid JSON, TTLs, flags, IVs, and ciphertext are rejected', async () => {
  assert.equal((await post('/api/create', '{')).status, 400);
  assert.equal((await post('/api/create', null)).status, 400);
  for (const options of [{ expiresIn: -1 }, { expiresIn: 59 }, { expiresIn: '86400' }, { expiresIn: 999999999 }, { burnAfterRead: 'false' }, { hasPassword: 1 }, { encryptedData: { version: 2, iv: 'AA', data: 'AA' } }]) {
    assert.equal((await post('/api/create', payload(options))).status, 400);
  }
  assert.equal((await post('/api/create', payload(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/create', 'x'.repeat(100000))).status, 413);
});

test('streaming request limits work without Content-Length', async () => {
  const response = await mf.dispatchFetch('https://paste.test/api/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.210' },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100000)); controller.close(); } }),
    duplex: 'half',
  });
  assert.equal(response.status, 413);
});

test('client-supplied IDs cannot overwrite an existing message', async () => {
  const first = await create();
  const second = await create({ id: first.id });
  assert.notEqual(first.id, second.id);
  assert.equal((await post(`/api/read/${first.id}`, {})).status, 200);
});

test('security headers cover HTML, assets, errors, and API responses', async () => {
  for (const path of ['/', '/app.js', '/crypto.js', '/missing', '/api/read/invalid']) {
    const r = await mf.dispatchFetch('https://paste.test' + path);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self';/);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await mf.dispatchFetch('https://paste.test/', { method: 'HEAD' })).status, 200);
});

test('creation rate limit returns 429 and Retry-After', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push(await post('/api/create', payload(), { 'CF-Connecting-IP': '192.0.2.250' }));
  assert.equal(statuses.at(-1).status, 429);
  assert.equal(statuses.at(-1).headers.get('retry-after'), '60');
});
