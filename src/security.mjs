const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function getWebCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  const mod = await import('node:' + 'crypto');
  globalThis.crypto = mod.webcrypto;
  return globalThis.crypto;
}

export const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const timestamp = () => new Date().toISOString();

const toHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array((hex.match(/../g) || []).map(h => parseInt(h, 16)));

export async function sha256(value) {
  const wc = await getWebCrypto();
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  return toHex(await wc.subtle.digest('SHA-256', data));
}

export async function hmacSha256(secret, message) {
  const wc = await getWebCrypto();
  const key = await wc.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await wc.subtle.sign('HMAC', key, encoder.encode(String(message))));
}

export async function passwordHash(password, salt) {
  const wc = await getWebCrypto();
  const key = await wc.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return toHex(
    await wc.subtle.deriveBits(
      { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
      key,
      256
    )
  );
}

export function safeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa.length !== sb.length) return false;
  let mismatch = 0;
  for (let i = 0; i < sa.length; i++) mismatch |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return mismatch === 0;
}

const DEFAULT_AUDIT_KEY = 'bc-hmac-audit-anchor-secret-v2';

export async function appendAudit(state, user, action, target, detail = '', signingKey = DEFAULT_AUDIT_KEY) {
  const last = state.audit.at(-1);
  const previous = last?.hash || 'GENESIS';
  const prevAnchor = last?.anchor || 'ANCHOR_GENESIS';
  const event = {
    id: uuid(),
    at: timestamp(),
    actor: user.name,
    actor_id: user.id,
    role: user.role,
    action,
    target,
    detail,
    previous
  };
  event.hash = await sha256(JSON.stringify(event));
  event.signature = await hmacSha256(signingKey, `${previous}:${event.hash}:${event.at}:${event.actor_id}:${event.action}`);
  event.anchor = await hmacSha256(signingKey, `${prevAnchor}:${event.signature}`);
  state.audit.push(event);
  return event;
}

export async function verifyAudit(events, signingKey = DEFAULT_AUDIT_KEY) {
  let previous = 'GENESIS';
  let prevAnchor = 'ANCHOR_GENESIS';
  for (const e of events) {
    const { hash, signature, anchor, ...record } = e;
    if (e.previous !== previous) return false;
    const expectedHash = await sha256(JSON.stringify(record));
    if (!safeEqual(expectedHash, hash)) return false;
    if (signature || anchor) {
      const expectedSig = await hmacSha256(
        signingKey,
        `${previous}:${hash}:${e.at}:${e.actor_id}:${e.action}`
      );
      if (!safeEqual(expectedSig, signature)) return false;
      const expectedAnchor = await hmacSha256(signingKey, `${prevAnchor}:${signature}`);
      if (!safeEqual(expectedAnchor, anchor)) return false;
      prevAnchor = anchor;
    }
    previous = hash;
  }
  return true;
}

export async function encryptAtRest(plaintextJson, secretKey = 'bc-at-rest-storage-key-v2') {
  const wc = await getWebCrypto();
  const rawKey = await wc.subtle.digest('SHA-256', encoder.encode(secretKey));
  const cryptoKey = await wc.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = wc.getRandomValues(new Uint8Array(12));
  const ciphertext = await wc.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoder.encode(plaintextJson));
  return JSON.stringify({
    __encrypted: true,
    alg: 'AES-256-GCM',
    iv: toHex(iv),
    ciphertext: toHex(ciphertext)
  });
}

export async function decryptAtRest(storedValue, secretKey = 'bc-at-rest-storage-key-v2') {
  if (!storedValue) return {};
  const parsed = typeof storedValue === 'string' ? JSON.parse(storedValue) : storedValue;
  if (!parsed || !parsed.__encrypted) return parsed;
  const wc = await getWebCrypto();
  const rawKey = await wc.subtle.digest('SHA-256', encoder.encode(secretKey));
  const cryptoKey = await wc.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = fromHex(parsed.iv);
  const cipherBytes = fromHex(parsed.ciphertext);
  const plainBuf = await wc.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipherBytes);
  return JSON.parse(decoder.decode(plainBuf));
}

export async function signToken(payload, secret = DEFAULT_AUDIT_KEY) {
  const bodyB64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const sig = await hmacSha256(secret, bodyB64);
  return `${bodyB64}.${sig}`;
}

export async function verifyToken(token, expectedPurpose, secret = DEFAULT_AUDIT_KEY, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [bodyB64, sig] = token.split('.');
  const expectedSig = await hmacSha256(secret, bodyB64);
  if (!safeEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(bodyB64))));
    if (expectedPurpose && payload.purpose !== expectedPurpose) return null;
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function generateMfaSecret() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function computeTotp(secret, timeStep = Math.floor(Date.now() / 30000)) {
  const digest = await hmacSha256(secret, `totp:${timeStep}`);
  const num = parseInt(digest.slice(-8), 16) % 1000000;
  return String(num).padStart(6, '0');
}

export async function verifyTotp(secret, code, now = Date.now()) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const currentStep = Math.floor(now / 30000);
  for (const offset of [-1, 0, 1]) {
    const candidate = await computeTotp(secret, currentStep + offset);
    if (safeEqual(candidate, String(code))) return true;
  }
  return false;
}

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
