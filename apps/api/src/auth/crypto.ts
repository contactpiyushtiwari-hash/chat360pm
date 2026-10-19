const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256B64url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function aesKey(secretB64: string, purpose: string): Promise<CryptoKey> {
  const id = `aes:${purpose}:${secretB64}`;
  let k = keyCache.get(id);
  if (!k) {
    // Derive a purpose-specific key so one secret never encrypts two kinds of data with the same key.
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', fromB64(secretB64), 'HKDF', false, [
        'deriveKey',
      ]);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: enc.encode(purpose) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    keyCache.set(id, k);
  }
  return k;
}

function hmacKey(secretB64: string, purpose: string): Promise<CryptoKey> {
  const id = `hmac:${purpose}:${secretB64}`;
  let k = keyCache.get(id);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', fromB64(secretB64), 'HKDF', false, [
        'deriveKey',
      ]);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: enc.encode(purpose) },
        base,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign', 'verify'],
      );
    })();
    keyCache.set(id, k);
  }
  return k;
}

/** AES-256-GCM with a random 96-bit IV. Output: base64url(iv || ciphertext). */
export async function encryptJson(
  secretB64: string,
  purpose: string,
  value: unknown,
): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await aesKey(secretB64, purpose);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

/** Returns null for any tampered, truncated or wrongly keyed input. */
export async function decryptJson<T>(
  secretB64: string,
  purpose: string,
  token: string,
): Promise<T | null> {
  try {
    const raw = fromB64url(token);
    const key = await aesKey(secretB64, purpose);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      key,
      raw.slice(12),
    );
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}

export async function hmac(secretB64: string, purpose: string, data: string): Promise<string> {
  const key = await hmacKey(secretB64, purpose);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

export async function hmacVerify(
  secretB64: string,
  purpose: string,
  data: string,
  sig: string,
): Promise<boolean> {
  try {
    const key = await hmacKey(secretB64, purpose);
    return await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(data));
  } catch {
    return false;
  }
}
