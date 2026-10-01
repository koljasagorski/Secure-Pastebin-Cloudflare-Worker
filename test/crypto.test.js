import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, parseFragment, encode, decode, MAX_PLAINTEXT } from '../web/crypto.browser.js';

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
