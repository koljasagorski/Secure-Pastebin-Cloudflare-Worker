export const MAX_PLAINTEXT = 65536;
export const ITERATIONS = 600000;

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

async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(text, password = null) {
  const bytes = new TextEncoder().encode(text);
  if (!text.trim()) throw new Error('Please enter content to encrypt');
  if (bytes.length > MAX_PLAINTEXT) throw new Error('Message exceeds the 64 KiB limit');
  if (password !== null && password.length < 12) throw new Error('Use a password with at least 12 characters');
  const secret = crypto.getRandomValues(new Uint8Array(password === null ? 32 : 16));
  const key = password === null
    ? await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt'])
    : await derive(password, secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { encryptedData: { version: 2, iv: encode(iv), data: encode(data) }, secret: encode(secret), hasPassword: password !== null };
}

export function parseFragment(fragment) {
  const parts = fragment.replace(/^#/, '').split(':');
  const [id, secret, mode] = parts;
  if (!/^[a-f0-9]{32}$/.test(id) || (parts.length !== 2 && parts.length !== 3) || (parts.length === 3 && mode !== 'pwd2')) {
    throw new Error('Invalid or unsupported share link');
  }
  const hasPassword = mode === 'pwd2';
  if (decode(secret).length !== (hasPassword ? 16 : 32)) throw new Error('Invalid share link');
  return { id, secret, hasPassword };
}

export async function decrypt(envelope, secret, password = null) {
  if (envelope.version !== 2) throw new Error('Unsupported message format');
  const bytes = decode(secret);
  const key = password === null
    ? await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt'])
    : await derive(password, bytes);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv) }, key, decode(envelope.data));
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}
