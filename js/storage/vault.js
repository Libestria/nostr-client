// Coffre à secret : chiffrement par mot de passe (PBKDF2-SHA256 → AES-256-GCM, WebCrypto).
// Le secret n'est jamais écrit en clair ; le mot de passe n'est jamais stocké.
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(password, plaintext, iter = ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password, salt, iter);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  return { v: 1, iter, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

// Mauvais mot de passe ou données altérées : lève BAD_PASSWORD
export async function open(password, blob) {
  try {
    if (blob?.v !== 1 || !Number.isInteger(blob.iter) || blob.iter < 1000 || blob.iter > 5_000_000) throw new Error('bad');
    const key = await keyFrom(password, unb64(blob.salt), blob.iter);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.data)));
  } catch { throw Object.assign(new Error('BAD_PASSWORD'), { code: 'BAD_PASSWORD' }); }
}
