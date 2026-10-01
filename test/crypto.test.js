import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, parseFragment, createReadToken, encode, decode, MAX_PLAINTEXT } from '../web/crypto.browser.js';

test('AES-GCM roundtrip preserves whitespace, Unicode, and code literally', async () => {
  const text = '  <script>alert("x")</script>\nمرحبا 👋\n\t  ';
  const encrypted = await encrypt(text);
  assert.equal(await decrypt(encrypted.encryptedData, encrypted.secret), text);
  assert.ok(!JSON.stringify(encrypted.encryptedData).includes(text));
  assert.deepEqual(parseFragment('#' + 'a'.repeat(32) + ':' + encrypted.secret), {
    id: 'a'.repeat(32), secret: encrypted.secret, hasPassword: false,
  });
});

test('password-derived encryption rejects wrong password and allows retry', async () => {
  const encrypted = await encrypt('password test', 'long test password');
  await assert.rejects(decrypt(encrypted.encryptedData, encrypted.secret, 'incorrect password'));
  assert.equal(await decrypt(encrypted.encryptedData, encrypted.secret, 'long test password'), 'password test');
  assert.equal(parseFragment('a'.repeat(32) + ':' + encrypted.secret + ':pwd2').hasPassword, true);
});

test('tampered ciphertext fails authentication', async () => {
  const encrypted = await encrypt('integrity');
  const bytes = decode(encrypted.encryptedData.data);
  bytes[0] ^= 1;
  await assert.rejects(decrypt({ ...encrypted.encryptedData, data: encode(bytes) }, encrypted.secret));
});

test('encryption uses independent random keys and IVs', async () => {
  const a = await encrypt('same');
  const b = await encrypt('same');
  assert.notEqual(a.secret, b.secret);
  assert.notEqual(a.encryptedData.iv, b.encryptedData.iv);
  assert.notEqual(a.encryptedData.data, b.encryptedData.data);
});

test('size limits are based on UTF-8 bytes and boundary can be decrypted', async () => {
  const text = 'x'.repeat(MAX_PLAINTEXT);
  const encrypted = await encrypt(text);
  assert.equal(await decrypt(encrypted.encryptedData, encrypted.secret), text);
  await assert.rejects(encrypt(text + 'x'), /64 KiB/);
  await assert.rejects(encrypt('🦊'.repeat(17000)), /64 KiB/);
  await assert.rejects(encrypt('  '), /enter content/);
  await assert.rejects(encrypt('x', 'short'), /12 characters/);
});

test('malformed and legacy fragment formats fail before fetching', () => {
  for (const fragment of ['invalid', 'x:abc', 'a'.repeat(32) + ':AA', 'a'.repeat(32) + ':' + 'A'.repeat(22) + ':pwd', 'a'.repeat(32) + ':' + 'A'.repeat(43) + ':unknown']) {
    assert.throws(() => parseFragment(fragment));
  }
});

test('v3 links carry an independent read token and only its SHA-256 digest is stored', async () => {
  const access = await createReadToken();
  const other = await createReadToken();
  assert.equal(decode(access.readToken).length, 32);
  assert.notEqual(access.readToken, other.readToken);
  assert.equal(access.readTokenHash, encode(await crypto.subtle.digest('SHA-256', decode(access.readToken))));
  assert.notEqual(access.readTokenHash, access.readToken);
  for (const password of [null, 'long test password']) {
    const encrypted = await encrypt('v3 message', password);
    assert.notEqual(access.readToken, encrypted.secret);
    const fragment = `#v3:${'a'.repeat(32)}:${encrypted.secret}:${access.readToken}${password ? ':pwd2' : ''}`;
    assert.deepEqual(parseFragment(fragment), {
      id: 'a'.repeat(32), secret: encrypted.secret, readToken: access.readToken, hasPassword: password !== null,
    });
    assert.throws(() => parseFragment(fragment.replace(access.readToken, 'AA')));
    assert.throws(() => parseFragment(fragment.replace(access.readToken, '')));
    assert.throws(() => parseFragment(fragment + ':extra'));
  }
  assert.throws(() => parseFragment('x'.repeat(257)));
});
