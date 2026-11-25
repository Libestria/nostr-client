// Vérification NIP-05 pour l'affichage des notes : résultat mis en cache, requêtes limitées en nombre.
// Une requête part vers le domaine de l'identifiant (comme sur la page de profil) : désactivée si les médias distants le sont.
import { resolveNip05 } from './nostr/nip05.js';

const down = new Map();      // clé -> date du dernier échec réseau (mémorisé 10 min pour ne pas insister)
const DOWN_TTL = 600000;
const done = new Map();      // "pubkey|nip05" -> 'ok' | 'bad' | 'unreachable'
const pending = new Map();   // "pubkey|nip05" -> Promise
const MAX_PARALLEL = 4;
let running = 0;
const queue = [];

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

const recentlyDown = (key) => Date.now() - (down.get(key) ?? 0) < DOWN_TTL;
export const cachedNip05 = (pubkey, nip05) => { const key = `${pubkey}|${nip05}`; return done.get(key) ?? (recentlyDown(key) ? 'unreachable' : null); };

// Renvoie 'ok' (identifiant → cette clé), 'bad' (autre clé ou inconnu) ou 'unreachable' (réseau, domaine en panne).
export function checkNip05(pubkey, nip05, { resolve = resolveNip05 } = {}) {
  const key = `${pubkey}|${nip05}`;
  if (done.has(key)) return Promise.resolve(done.get(key));
  if (recentlyDown(key)) return Promise.resolve('unreachable');
  if (pending.has(key)) return pending.get(key);
  const p = new Promise((res) => {
    queue.push(async () => {
      let r;
      try { r = (await resolve(nip05)).pubkey === pubkey ? 'ok' : 'bad'; }
      catch (e) { r = e?.message === 'not-found' ? 'bad' : 'unreachable'; }
      if (r === 'unreachable') down.set(key, Date.now()); else done.set(key, r);
      pending.delete(key);
      res(r);
    });
    pump();
  });
  pending.set(key, p);
  return p;
}
