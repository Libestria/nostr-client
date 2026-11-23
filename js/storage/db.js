// Cache IndexedDB. N'y entrent que des événements dont la signature a été vérifiée.
import { replaceKey, isReplaceable, isAddressable } from '../nostr/events.js';

let dbPromise = null;
function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('nostr-client', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('events')) {
        const ev = db.createObjectStore('events', { keyPath: 'id' });
        ev.createIndex('kind', 'kind');
        ev.createIndex('pubkey', 'pubkey');
        ev.createIndex('created_at', 'created_at');
      }
      if (!db.objectStoreNames.contains('replaceable')) db.createObjectStore('replaceable', { keyPath: 'key' });
      // v2 : messages privés déchiffrés (par compte) et enveloppes déjà traitées
      if (!db.objectStoreNames.contains('dms')) {
        const dm = db.createObjectStore('dms', { keyPath: 'id' });
        dm.createIndex('me', 'me');
        dm.createIndex('conv', 'conv');
      }
      if (!db.objectStoreNames.contains('dmseen')) db.createObjectStore('dmseen', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

// Événements remplaçables : on ne garde que le plus récent (à égalité, l'id le plus bas, NIP-01).
export function putEvent(ev) {
  return open().then((db) => new Promise((resolve) => {
    const tx = db.transaction(['events', 'replaceable'], 'readwrite');
    const events = tx.objectStore('events');
    const rep = tx.objectStore('replaceable');
    const key = replaceKey(ev);
    if (!key) events.put(ev);
    else {
      const get = rep.get(key);
      get.onsuccess = () => {
        const cur = get.result;
        if (cur && (cur.created_at > ev.created_at || (cur.created_at === ev.created_at && cur.id <= ev.id))) return;
        if (cur) events.delete(cur.id);
        rep.put({ key, id: ev.id, created_at: ev.created_at });
        events.put(ev);
      };
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => resolve(false);
  })).catch(() => false);
}

// Dernier événement remplaçable connu (profil, contacts…) : null si absent.
export function getReplaceable(kind, pubkey, d = '') {
  return open().then((db) => new Promise((resolve) => {
    const tx = db.transaction(['events', 'replaceable']);
    const g = tx.objectStore('replaceable').get(`${kind}:${pubkey}:${d}`);
    g.onerror = () => resolve(null);
    g.onsuccess = () => {
      if (!g.result) return resolve(null);
      const e = tx.objectStore('events').get(g.result.id);
      e.onsuccess = () => resolve(e.result ?? null);
      e.onerror = () => resolve(null);
    };
  })).catch(() => null);
}

// Derniers événements du cache (plus récents d'abord), filtrés par kinds.
export function latest({ kinds, limit = 30, until } = {}) {
  return open().then((db) => new Promise((resolve) => {
    const out = [];
    const range = until === undefined ? null : IDBKeyRange.upperBound(until);
    const req = db.transaction('events').objectStore('events').index('created_at').openCursor(range, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (!c || out.length >= limit) return resolve(out);
      if (!kinds || kinds.includes(c.value.kind)) out.push(c.value);
      c.continue();
    };
    req.onerror = () => resolve(out);
  })).catch(() => []);
}

// Garde au plus `max` événements ordinaires (les plus récents) ; les remplaçables sont conservés.
export function prune(max = 3000) {
  return open().then((db) => new Promise((resolve) => {
    const store = db.transaction('events', 'readwrite').objectStore('events');
    const count = store.count();
    count.onsuccess = () => {
      let excess = count.result - max;
      if (excess <= 0) return resolve(0);
      const cur = store.index('created_at').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || excess <= 0) return resolve(0);
        if (!isReplaceable(c.value.kind) && !isAddressable(c.value.kind)) { c.delete(); excess--; }
        c.continue();
      };
    };
    count.onerror = () => resolve(0);
  })).catch(() => 0);
}

// Retire un événement ordinaire du cache (suppression NIP-09 de ses propres notes).
export function deleteEvent(id) {
  return open().then((db) => new Promise((resolve) => {
    const tx = db.transaction('events', 'readwrite');
    tx.objectStore('events').delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  })).catch(() => false);
}

// Un événement du cache par identifiant (ou null).
export function getEvent(id) {
  return open().then((db) => new Promise((resolve) => {
    const req = db.transaction('events').objectStore('events').get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  })).catch(() => null);
}

// ---- Messages privés (déchiffrés localement ; effacés à la déconnexion)
const idb = (store, mode, fn) => open().then((db) => new Promise((resolve) => {
  const tx = db.transaction(store, mode);
  let out;
  try { out = fn(tx.objectStore(store)); } catch { resolve(null); return; }
  tx.oncomplete = () => resolve(typeof IDBRequest !== 'undefined' && out instanceof IDBRequest ? out.result : true);
  tx.onerror = () => resolve(null);
})).catch(() => null);

export const putDm = (rec) => idb('dms', 'readwrite', (s) => s.put(rec));
export const markDmSeen = (id) => idb('dmseen', 'readwrite', (s) => s.put({ id }));
export const isDmSeen = (id) => idb('dmseen', 'readonly', (s) => s.get(id)).then((r) => !!r);

// Tous les messages d'un compte (le plus récent d'abord)
export function listDms(me) {
  return open().then((db) => new Promise((resolve) => {
    const req = db.transaction('dms').objectStore('dms').index('me').getAll(me);
    req.onsuccess = () => resolve((req.result ?? []).sort((a, b) => b.created_at - a.created_at));
    req.onerror = () => resolve([]);
  })).catch(() => []);
}

export function clearDms() {
  return open().then((db) => new Promise((resolve) => {
    const tx = db.transaction(['dms', 'dmseen'], 'readwrite');
    tx.objectStore('dms').clear(); tx.objectStore('dmseen').clear();
    tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false);
  })).catch(() => false);
}
