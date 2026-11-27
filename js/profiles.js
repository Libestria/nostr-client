// Cache mémoire des profils (kind 0) + chargement groupé. Le cache IndexedDB est lu d'abord.
import { pool } from './relays/pool.js';
import { getReplaceable } from './storage/db.js';
import { parseProfile } from './nostr/profile.js';

const cache = new Map();   // pubkey → { profile, created_at }
const asked = new Set();
const queue = new Set();
const listeners = new Set();
let flushTimer = null;
let notifyTimer = null;

export const getCached = (pk) => cache.get(pk)?.profile ?? null;

export function onProfiles(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function notify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => { notifyTimer = null; listeners.forEach((fn) => fn()); }, 120);
}

export function acceptProfileEvent(ev) {
  if (ev?.kind !== 0) return;
  const cur = cache.get(ev.pubkey);
  if (cur && cur.created_at >= ev.created_at) return;
  const profile = parseProfile(ev);
  if (!profile) return;
  cache.set(ev.pubkey, { profile, created_at: ev.created_at });
  notify();
}

// Une demande peut échouer sans erreur (relais pas encore connecté, lent, demande refusée) : les profils toujours
// absents après la fin de la demande sont redemandés, au plus 3 fois, avec un délai croissant.
const attempts = new Map();   // pubkey → nombre de tentatives réseau
const RETRY_MS = [4000, 12000, 30000];

function retryMissing(authors) {
  for (const pk of authors) {
    if (cache.has(pk)) { attempts.delete(pk); continue; }
    const n = attempts.get(pk) ?? 0;
    if (n >= RETRY_MS.length) continue;
    attempts.set(pk, n + 1);
    setTimeout(() => { if (!cache.has(pk)) { queue.add(pk); flushTimer ||= setTimeout(flush, 150); } }, RETRY_MS[n]);
  }
}

async function flush() {
  flushTimer = null;
  const list = [...queue];
  queue.clear();
  await Promise.all(list.map((pk) => getReplaceable(0, pk).then((ev) => ev && acceptProfileEvent(ev))));
  for (let i = 0; i < list.length; i += 50) {
    const authors = list.slice(i, i + 50);
    pool.subscribe([{ kinds: [0], authors, limit: authors.length * 2 }], { closeOnEose: true, onevent: acceptProfileEvent, maxEvents: 300, oneose: () => retryMissing(authors) });
  }
}

export function requestProfile(pk, { force = false } = {}) {
  if (!/^[0-9a-f]{64}$/.test(pk) || (asked.has(pk) && !force)) return;
  asked.add(pk);
  queue.add(pk);
  flushTimer ||= setTimeout(flush, 150);
}
