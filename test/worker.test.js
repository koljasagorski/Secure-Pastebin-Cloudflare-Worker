import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { encrypt, decrypt, createReadToken, encryptFile, decryptFile, authProof, encode } from '../web/crypto.browser.js';

let mf, db, encrypted, access;
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
          .map(name => [name, { type: name === 'worker.js' ? 'esm' : /\.(woff2|png)$/.test(name) ? 'data' : 'text', contents: readFileSync(resolve('dist', name), /\.(woff2|png)$/.test(name) ? undefined : 'utf8') }])),
      },
      env: {
        DB: { type: 'd1', id: 'local-test' },
        FILES: { type: 'r2', name: 'files' },
        ...Object.fromEntries(config.ratelimits.map(({ name, namespace_id, simple }) => [name, { type: 'rate-limit', namespace: namespace_id, simple }])),
      },
    },
    dev: { stripCfConnectingIp: false },
  }] });
  db = await mf.getD1Database('DB');
  for (const file of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of readFileSync('migrations/' + file, 'utf8').split(';').filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  encrypted = await encrypt('local integration test\n  unchanged whitespace');
  access = await createReadToken();
});
after(async () => { await mf?.dispose(); });

function post(path, body, headers = {}) {
  return mf.dispatchFetch('https://paste.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${++ip}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function payload(options = {}) {
  return { encryptedData: encrypted.encryptedData, expiresIn: 86400, burnAfterRead: false, hasPassword: false, readTokenHash: access.readTokenHash, ...options };
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
      const response = await post(`/api/read/${id}`, { readToken: access.readToken });
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
  const responses = await Promise.all(Array.from({ length: 20 }, () => post(`/api/read/${id}`, { readToken: access.readToken })));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(responses.filter(r => r.status === 404).length, 19);
  assert.equal(await db.prepare('SELECT id FROM pastes WHERE id = ?').bind(id).first(), null);
});

test('ID alone, wrong tokens, and the stored hash cannot retrieve or burn a protected paste', async () => {
  const wrong = await createReadToken();
  for (const burnAfterRead of [false, true]) {
    const { id } = await create({ burnAfterRead });
    const stored = await db.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first();
    assert.equal(stored.read_token_hash, access.readTokenHash);
    assert.ok(!JSON.stringify(stored).includes(access.readToken));
    assert.ok(!JSON.stringify(stored).includes(encrypted.secret));
    for (const body of [{}, { readToken: wrong.readToken }, { readToken: access.readTokenHash }]) {
      const denied = await post(`/api/read/${id}`, body);
      assert.equal(denied.status, 404);
      assert.ok(!JSON.stringify(await denied.json()).includes(encrypted.encryptedData.data));
    }
    assert.equal((await post(`/api/read/${id}`, { readToken: 'invalid' })).status, 400);
    assert.equal((await post(`/api/read/${id}`, { readToken: access.readToken, extra: 'x'.repeat(1024) })).status, 413);
    assert.equal((await post(`/api/read/${id}`, { readToken: access.readToken })).status, 200);
  }
});

test('existing v2 messages still work after the nullable token migration', async () => {
  for (const burnAfterRead of [false, true]) {
    const id = crypto.randomUUID().replaceAll('-', '');
    await db.prepare('INSERT INTO pastes (id, encrypted_data, created, expires_at, burn_after_read, has_password) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, JSON.stringify(encrypted.encryptedData), Date.now(), Date.now() + 3600000, Number(burnAfterRead), 0).run();
    const response = await post(`/api/read/${id}`, {});
    assert.equal(response.status, 200);
    assert.equal(await decrypt((await response.json()).data, encrypted.secret), 'local integration test\n  unchanged whitespace');
    assert.equal((await post(`/api/read/${id}`, {})).status, burnAfterRead ? 404 : 200);
  }
});

test('GET, HEAD, and cross-origin requests cannot consume a one-time paste', async () => {
  const { id } = await create({ burnAfterRead: true });
  for (const method of ['GET', 'HEAD']) {
    const r = await mf.dispatchFetch(`https://paste.test/api/read/${id}`, { method });
    assert.equal(r.status, 405);
  }
  assert.equal((await post(`/api/read/${id}`, { readToken: access.readToken }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post(`/api/read/${id}`, { readToken: access.readToken }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(`/api/read/${id}`, { readToken: access.readToken })).status, 200);
});

test('expired pastes are unreadable before cleanup runs', async () => {
  for (const burnAfterRead of [false, true]) {
    const { id } = await create({ burnAfterRead });
    await db.prepare('UPDATE pastes SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, id).run();
    assert.equal((await post(`/api/read/${id}`, { readToken: access.readToken })).status, 404);
  }
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: '*/15 * * * *' });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pastes WHERE expires_at <= ?').bind(Date.now()).first()).n, 0);
});

test('invalid JSON, TTLs, flags, IVs, and ciphertext are rejected', async () => {
  assert.equal((await post('/api/create', '{')).status, 400);
  assert.equal((await post('/api/create', null)).status, 400);
  for (const options of [{ readTokenHash: undefined }, { readTokenHash: 'invalid' }, { readTokenHash: 'AA' }, { expiresIn: -1 }, { expiresIn: 59 }, { expiresIn: '86400' }, { expiresIn: 999999999 }, { burnAfterRead: 'false' }, { hasPassword: 1 }, { encryptedData: { version: 2, iv: 'AA', data: 'AA' } }]) {
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
  assert.equal((await post(`/api/read/${first.id}`, { readToken: access.readToken })).status, 200);
});

test('security headers cover HTML, assets, errors, and API responses', async () => {
  for (const path of ['/', '/app.js', '/crypto.js', '/font.woff2', '/missing', '/api/read/invalid']) {
    const r = await mf.dispatchFetch('https://paste.test' + path);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self';/);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(r.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.match(r.headers.get('content-security-policy'), /require-trusted-types-for 'script'/);
    assert.ok(!r.headers.get('content-security-policy').includes('unsafe-inline'));
  }
  assert.equal((await mf.dispatchFetch('https://paste.test/', { method: 'HEAD' })).status, 200);
});

test('public HTTP requests redirect to HTTPS before serving content or touching messages', async () => {
  const { id } = await create({ burnAfterRead: true });
  const response = await mf.dispatchFetch(`http://paste.test/api/read/${id}`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readToken: access.readToken }),
  });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), `https://paste.test/api/read/${id}`);
  assert.equal(await response.text(), '');
  assert.equal((await post(`/api/read/${id}`, { readToken: access.readToken })).status, 200);
  assert.equal((await mf.dispatchFetch('http://localhost/')).status, 200);
});

test('creation rate limit returns 429 and Retry-After', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push(await post('/api/create', payload(), { 'CF-Connecting-IP': '192.0.2.250' }));
  assert.equal(statuses.at(-1).status, 429);
  assert.equal(statuses.at(-1).headers.get('retry-after'), '60');
});

const PASSWORD = 'correct horse battery';
async function upload(options = {}, file = new File(['file bytes \u00fc'], 'note \u00fc.txt', { type: 'text/plain' }), password = null) {
  const sealed = await encryptFile(file, password);
  const meta = { iv: sealed.iv, expiresIn: 86400, burnAfterRead: false, hasPassword: sealed.hasPassword, readTokenHash: access.readTokenHash, ...options };
  const response = await mf.dispatchFetch('https://paste.test/api/upload', {
    method: 'POST', body: sealed.ciphertext,
    headers: { 'Content-Type': 'application/octet-stream', 'CF-Connecting-IP': `192.0.2.${++ip}`,
      'X-Paste-Meta': encode(new TextEncoder().encode(JSON.stringify(meta))), ...options.headers },
  });
  return { response, sealed };
}
async function download(id) {
  const response = await post(`/api/read/${id}`, { readToken: access.readToken });
  if (response.status !== 200) return { response };
  const meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(response.headers.get('x-paste-meta').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
  return { response, meta, bytes: await response.arrayBuffer() };
}

test('file round trip: ciphertext in R2, name and type encrypted, plaintext never stored', async () => {
  const { response, sealed } = await upload();
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const row = await db.prepare('SELECT * FROM pastes WHERE id = ?').bind(id).first();
  assert.equal(row.kind, 'file');
  assert.ok(!JSON.stringify(row).includes('note'));
  const stored = await (await mf.getR2Bucket('FILES')).get(id);
  assert.ok(stored);
  const { response: read, meta, bytes } = await download(id);
  assert.equal(read.headers.get('content-type'), 'application/octet-stream');
  assert.equal(meta.iv, sealed.iv);
  const file = await decryptFile(meta.iv, bytes, sealed.secret);
  assert.equal(file.name, 'note \u00fc.txt');
  assert.equal(new TextDecoder().decode(file.data), 'file bytes \u00fc');
  assert.equal((await download(id)).response.status, 200);
});

test('burn-after-read file: one retrieval, then row and R2 object are gone', async () => {
  const { id } = await (await upload({ burnAfterRead: true })).response.json();
  const results = await Promise.all(Array.from({ length: 10 }, () => download(id)));
  assert.equal(results.filter(r => r.response.status === 200).length, 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await (await mf.getR2Bucket('FILES')).get(id), null);
});

test('file uploads accept only 1 hour, 1 day, and 48 hours and reject bad requests', async () => {
  assert.equal((await upload({ expiresIn: 172800 })).response.status, 201);
  for (const expiresIn of [604800, 2592000, 60]) assert.equal((await upload({ expiresIn })).response.status, 400);
  assert.equal((await upload({ readTokenHash: 'x' })).response.status, 400);
  assert.equal((await upload({ short: true })).response.status, 400);
  assert.equal((await upload({ headers: { 'X-Paste-Meta': '!' } })).response.status, 400);
  const oversize = await mf.dispatchFetch('https://paste.test/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Paste-Meta': 'e30', 'CF-Connecting-IP': '192.0.2.211' }, body: new Uint8Array(100_000_001),
  });
  assert.equal(oversize.status, 413);
  const json = await mf.dispatchFetch('https://paste.test/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.212' }, body: '{}' });
  assert.equal(json.status, 415);
});

test('cleanup removes expired files from R2 and D1', async () => {
  const { id } = await (await upload()).response.json();
  await db.prepare('UPDATE pastes SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, id).run();
  assert.equal((await download(id)).response.status, 404);
  await (await mf.getWorker()).scheduled({ cron: '*/15 * * * *' });
  assert.equal(await (await mf.getR2Bucket('FILES')).get(id), null);
  assert.equal(await db.prepare('SELECT id FROM pastes WHERE id = ?').bind(id).first(), null);
});

function metaOf(response) {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(response.headers.get('x-paste-meta').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
}

test('short links: a code alone releases or burns nothing, the password proof does', async () => {
  const text = await encrypt('short link text', PASSWORD);
  const auth = await authProof(PASSWORD, text.secret);
  const created = await (await post('/api/create', payload({ encryptedData: text.encryptedData, hasPassword: true, burnAfterRead: true, short: true, salt: text.secret, authHash: auth.hash }))).json();
  assert.match(created.shortCode, /^[2-9a-hj-km-np-z]{6}$/);
  // Step 1 returns only the public salt, no ciphertext, and burns nothing.
  const salt = await (await post(`/api/short/${created.shortCode}`, {})).json();
  assert.deepEqual(Object.keys(salt), ['salt']);
  assert.equal(salt.salt, text.secret);
  // Wrong or malformed proofs fail without burning the one-time paste.
  const wrong = await authProof('another password!!', text.secret);
  assert.equal((await post(`/api/short/${created.shortCode}`, { proof: wrong.proof })).status, 404);
  assert.equal((await post(`/api/short/${created.shortCode}`, { proof: auth.hash })).status, 404);
  assert.equal((await post(`/api/short/${created.shortCode}`, { proof: 'bad' })).status, 400);
  const response = await post(`/api/short/${created.shortCode}`, { proof: auth.proof });
  assert.equal(response.status, 200);
  const paste = await response.json();
  assert.equal(await decrypt(paste.data, paste.salt, PASSWORD), 'short link text');
  assert.equal((await post(`/api/short/${created.shortCode}`, { proof: auth.proof })).status, 404);
});

test('short-link salt lookups do not reveal which codes exist', async () => {
  const unknown = await (await post('/api/short/abcdef', {})).json();
  assert.match(unknown.salt, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(await (await post('/api/short/abcdef', {})).json(), unknown);
});

test('short links work for files too', async () => {
  const sealed = await encryptFile(new File(['abc'], 'a.bin'), PASSWORD);
  const auth = await authProof(PASSWORD, sealed.secret);
  const meta = { iv: sealed.iv, expiresIn: 3600, burnAfterRead: true, hasPassword: true, readTokenHash: access.readTokenHash, short: true, salt: sealed.secret, authHash: auth.hash };
  const up = await mf.dispatchFetch('https://paste.test/api/upload', { method: 'POST', body: sealed.ciphertext,
    headers: { 'Content-Type': 'application/octet-stream', 'CF-Connecting-IP': '192.0.2.213', 'X-Paste-Meta': encode(new TextEncoder().encode(JSON.stringify(meta))) } });
  const { shortCode } = await up.json();
  const wrong = await authProof('another password!!', sealed.secret);
  assert.equal((await post(`/api/short/${shortCode}`, { proof: wrong.proof })).status, 404);
  const first = await post(`/api/short/${shortCode}`, { proof: auth.proof });
  assert.equal(first.status, 200);
  const info = metaOf(first);
  assert.equal((await decryptFile(info.iv, await first.arrayBuffer(), info.salt, PASSWORD)).name, 'a.bin');
  assert.equal((await post(`/api/short/${shortCode}`, { proof: auth.proof })).status, 404);
});

test('short links need a password, a salt, and a proof hash; malformed codes are rejected', async () => {
  const auth = await authProof(PASSWORD, encrypted.secret);
  assert.equal((await post('/api/create', payload({ short: true, salt: encrypted.secret, authHash: auth.hash }))).status, 400);
  assert.equal((await post('/api/create', payload({ hasPassword: true, short: true, authHash: auth.hash }))).status, 400);
  assert.equal((await post('/api/create', payload({ hasPassword: true, short: true, salt: encrypted.secret }))).status, 400);
  assert.equal((await post('/api/short/ab0def', {})).status, 404);
  assert.equal((await mf.dispatchFetch('https://paste.test/abcdef')).status, 200);
  assert.equal((await mf.dispatchFetch('https://paste.test/ABCDEF')).status, 200);
  assert.equal((await mf.dispatchFetch('https://paste.test/abcde')).status, 404);
});
