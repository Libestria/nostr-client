// Plan « outbox » pour une liste de comptes : leurs relais d'écriture (NIP-65), cache d'abord, puis relais du compte.
import { pool } from './pool.js';
import { getReplaceable } from '../storage/db.js';
import { planOutbox, writeRelaysOf, chunkAuthors } from '../nostr/outbox.js';

const FETCH_CHUNK = 100;
const MAX_FETCH = 1000;
const FETCH_TIMEOUT_MS = 6000;   // la recherche des listes de relais ne doit jamais bloquer l'affichage

// → { byRelay: Map(url → [pubkey]), fallback: [pubkey] }
export async function planFor(authors, { mine = [] } = {}) {
  const writes = new Map();
  const missing = [];
  await Promise.all(authors.map(async (pk) => {
    const ev = await getReplaceable(10002, pk);
    if (ev) writes.set(pk, writeRelaysOf(ev)); else missing.push(pk);
  }));
  if (missing.length) {
    const best = new Map();
    const chunks = chunkAuthors(missing.slice(0, MAX_FETCH), FETCH_CHUNK);
    const subs = [];
    const timeout = new Promise((resolve) => setTimeout(resolve, FETCH_TIMEOUT_MS));
    await Promise.race([timeout, Promise.all(chunks.map((authorsChunk) => new Promise((resolve) => {
      subs.push(pool.subscribe([{ kinds: [10002], authors: authorsChunk, limit: authorsChunk.length * 2 }], {
        closeOnEose: true, maxEvents: 600, oneose: resolve,
        onevent: (ev) => { const cur = best.get(ev.pubkey); if (!cur || ev.created_at > cur.created_at) best.set(ev.pubkey, ev); },
      }));
    })))]);
    subs.forEach((sub) => sub.close());
    for (const [pk, ev] of best) writes.set(pk, writeRelaysOf(ev));
  }
  return planOutbox(authors, writes, { mine });
}
