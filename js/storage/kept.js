// Conservation facultative de la connexion NIP-46 entre deux ouvertures du navigateur (case « Rester connecté sur cet appareil »).
// Seule la clé de TRANSPORT du signeur est concernée (jamais la clé d'identité, qui reste dans le signeur). Elle est chiffrée en
// AES-GCM avec une clé NON EXPORTABLE (WebCrypto) gardée dans IndexedDB : le code peut s'en servir mais ne peut pas la lire, donc
// une copie des données stockées reste illisible. Ne protège pas contre du code exécuté dans cette page (XSS) : d'où l'option facultative.
const META = 'nostr-client:nip46-kept';   // localStorage : { pubkey, iv, ct }
const DB = 'nostr-client-vault', STORE = 'keys', KEY_ID = 'nip46';
const HEX64 = /^[0-9a-f]{64}$/;

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const run = async (mode, fn) => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
};

async function getKey(create) {
  let key = await run('readonly', (s) => s.get(KEY_ID));
  if (!key && create) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);   // extractable = false
    await run('readwrite', (s) => s.put(key, KEY_ID));
  }
  return key ?? null;
}

// Synchrone : une connexion conservée existe-t-elle ? → { pubkey } ou null
export function keptMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META));
    if (m && HEX64.test(m.pubkey) && typeof m.iv === 'string' && typeof m.ct === 'string') return { pubkey: m.pubkey };
  } catch { /* absente ou illisible */ }
  return null;
}

// saved : { pubkey, clientKey, bunker: { pubkey, relays } } (voir nostr/nip46.js)
export async function keepNip46(saved) {
  if (!crypto?.subtle || !globalThis.indexedDB) throw new Error('unsupported');
  const key = await getKey(true);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(saved))));
  localStorage.setItem(META, JSON.stringify({ pubkey: saved.pubkey, iv: b64(iv), ct: b64(ct) }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// → { saved } ou { error } : 'missing' (rien de conservé), 'key' (clé de chiffrement absente), 'data' (données altérées),
// 'storage' (IndexedDB indisponible, souvent passager au démarrage d'iOS : 3 essais avant d'abandonner).
export async function loadKept() {
  let m;
  try { m = JSON.parse(localStorage.getItem(META)); } catch { m = null; }
  if (!m) return { error: 'missing' };
  let key = null;
  for (let i = 0; i < 3; i++) {
    try { key = await getKey(false); break; } catch { if (i < 2) await wait(400); else return { error: 'storage' }; }
  }
  if (!key) return { error: 'key' };
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, key, unb64(m.ct));
    const saved = JSON.parse(new TextDecoder().decode(plain));
    return saved?.pubkey === m.pubkey ? { saved } : { error: 'data' };
  } catch { return { error: 'data' }; }
}

export async function forgetNip46() {
  try { localStorage.removeItem(META); } catch { /* indisponible */ }
  try { await run('readwrite', (s) => s.delete(KEY_ID)); } catch { /* indisponible */ }
}
