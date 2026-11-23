// Modèle « outbox » (NIP-65) : lire les notes d'un compte sur SES relais d'écriture. Module sans DOM ni réseau.
import { relaysFromEvent } from './relaylists.js';

export const OUTBOX_DEFAULTS = Object.freeze({ perAuthor: 2, maxRelays: 20, maxAuthorsPerFilter: 100 });

// writeRelays : Map(pubkey → [url]) (relais d'écriture annoncés par chaque compte).
// Choix glouton : on prend d'abord les relais qui couvrent le plus de comptes, jusqu'à `perAuthor` relais par compte
// et `maxRelays` relais au total. Les relais du compte connecté (`mine`) sont préférés à égalité (déjà connectés).
// → { byRelay: Map(url → [pubkey]), fallback: [pubkey] } ; fallback = comptes sans relais connus.
export function planOutbox(authors, writeRelays, { mine = [], perAuthor, maxRelays } = {}) {
  const opt = { ...OUTBOX_DEFAULTS, ...(perAuthor ? { perAuthor } : {}), ...(maxRelays ? { maxRelays } : {}) };
  const mineSet = new Set(mine);
  const remaining = new Map();   // pubkey → nombre de relais encore à attribuer
  const candidates = new Map();  // url → Set(pubkey)
  const fallback = [];
  for (const pk of authors) {
    const urls = [...new Set(writeRelays.get(pk) ?? [])];
    if (!urls.length) { fallback.push(pk); continue; }
    remaining.set(pk, opt.perAuthor);
    for (const u of urls) { if (!candidates.has(u)) candidates.set(u, new Set()); candidates.get(u).add(pk); }
  }
  const byRelay = new Map();
  const chosen = new Set();
  while (candidates.size && chosen.size < opt.maxRelays) {
    let best = null, bestScore = 0;
    for (const [url, pks] of candidates) {
      let score = 0;
      for (const pk of pks) if ((remaining.get(pk) ?? 0) > 0) score++;
      if (score > bestScore || (score === bestScore && score > 0 && best && mineSet.has(url) && !mineSet.has(best))) { best = url; bestScore = score; }
    }
    if (!best || bestScore === 0) break;
    const pks = [...candidates.get(best)].filter((pk) => (remaining.get(pk) ?? 0) > 0);
    byRelay.set(best, pks);
    chosen.add(best);
    for (const pk of pks) remaining.set(pk, remaining.get(pk) - 1);
    candidates.delete(best);
  }
  // comptes dont aucun relais n'a pu être retenu (plafond atteint) : relais du compte connecté
  for (const [pk, left] of remaining) if (left === opt.perAuthor) fallback.push(pk);
  return { byRelay, fallback };
}

// Relais d'écriture annoncés par un événement 10002 (ou rien si l'événement est absent).
export function writeRelaysOf(event) {
  return relaysFromEvent(event, 'pub').filter((r) => r.write).map((r) => r.url);
}

// Découpe des comptes en filtres de `size` auteurs au plus.
export function chunkAuthors(authors, size = OUTBOX_DEFAULTS.maxAuthorsPerFilter) {
  const out = [];
  for (let i = 0; i < authors.length; i += size) out.push(authors.slice(i, i + size));
  return out;
}
