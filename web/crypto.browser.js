export const MAX_PLAINTEXT = 65536;
export const ITERATIONS = 600000;
// Cloudflare Workers accept at most 100 MB per request on Free/Pro, so a file goes up in one request.
export const MAX_REQUEST = 100_000_000;
const META_RESERVE = 2048;
export const MAX_FILE = MAX_REQUEST - 4 - META_RESERVE - 16;

export function encode(bytes) {
  let raw = '';
  for (const byte of new Uint8Array(bytes)) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid share link');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error('Invalid share link');
  return bytes;
}

export async function createReadToken() {
  const token = crypto.getRandomValues(new Uint8Array(32));
  return { readToken: encode(token), readTokenHash: encode(await crypto.subtle.digest('SHA-256', token)) };
}

async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function newKey(password) {
  if (password !== null && password.length < 12) throw new Error('Use a password with at least 12 characters');
  const secret = crypto.getRandomValues(new Uint8Array(password === null ? 32 : 16));
  const key = password === null
    ? await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt'])
    : await derive(password, secret);
  return { secret, key };
}

async function openKey(secret, password) {
  const bytes = decode(secret);
  return password === null
    ? crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt'])
    : derive(password, bytes);
}

export async function encrypt(text, password = null) {
  const bytes = new TextEncoder().encode(text);
  if (!text.trim()) throw new Error('Please enter content to encrypt');
  if (bytes.length > MAX_PLAINTEXT) throw new Error('Message exceeds the 64 KiB limit');
  const { secret, key } = await newKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { encryptedData: { version: 2, iv: encode(iv), data: encode(data) }, secret: encode(secret), hasPassword: password !== null };
}

// File layout before encryption: 4-byte big-endian metadata length, metadata JSON, file bytes.
// The name and type are therefore encrypted together with the content.
export async function encryptFile(file, password = null) {
  if (!file.size) throw new Error('The file is empty');
  if (file.size > MAX_FILE) throw new Error('File exceeds the 100 MB limit');
  const meta = new TextEncoder().encode(JSON.stringify({
    name: file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'file',
    type: file.type.slice(0, 127), size: file.size,
  }));
  if (meta.length > META_RESERVE) throw new Error('The file name is too long');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, meta.length);
  const { secret, key } = await newKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await new Blob([length, meta, file]).arrayBuffer());
  return { iv: encode(iv), ciphertext, secret: encode(secret), hasPassword: password !== null };
}

export async function decryptFile(iv, ciphertext, secret, password = null) {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await openKey(secret, password), ciphertext));
  const length = new DataView(plain.buffer).getUint32(0);
  if (length > META_RESERVE || 4 + length > plain.length) throw new Error('Invalid file');
  const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain.subarray(4, 4 + length)));
  return { name: String(meta.name), type: String(meta.type), data: plain.subarray(4 + length) };
}

export function parseFragment(fragment) {
  if (fragment.length > 256) throw new Error('Invalid share link');
  const parts = fragment.replace(/^#/, '').split(':');
  const protectedLink = parts[0] === 'v3';
  if (protectedLink) parts.shift();
  const readToken = protectedLink ? parts.splice(2, 1)[0] : undefined;
  if (protectedLink && (!readToken || decode(readToken).length !== 32)) throw new Error('Invalid read token');
  const [id, secret, mode] = parts;
  if (!/^[a-f0-9]{32}$/.test(id) || (parts.length !== 2 && parts.length !== 3) || (parts.length === 3 && mode !== 'pwd2')) {
    throw new Error('Invalid or unsupported share link');
  }
  const hasPassword = mode === 'pwd2';
  if (decode(secret).length !== (hasPassword ? 16 : 32)) throw new Error('Invalid share link');
  return { id, secret, hasPassword, ...(protectedLink ? { readToken } : {}) };
}

export async function decrypt(envelope, secret, password = null) {
  if (envelope.version !== 2) throw new Error('Unsupported message format');
  const key = await openKey(secret, password);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv) }, key, decode(envelope.data));
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}
