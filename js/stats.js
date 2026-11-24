// Compteurs de réponses, reposts, réactions et citations par note (requêtes regroupées, fermées à la fin).
import { pool } from './relays/pool.js';
import { getSigner } from './auth.js';
import { emptyStats, addInteraction, targetsOf, snapshot } from './nostr/stats.js';

const BATCH = 40;
const stats = new Map();      // id de note → compteurs
const watchers = new Map();   // id → Set(callbacks)
const pending = new Set();
let timer = null;

const emit = (id) => { const s = stats.get(id); if (s) for (const cb of watchers.get(id) ?? []) cb(snapshot(s)); };
const get = (id) => { if (!stats.has(id)) stats.set(id, emptyStats()); return stats.get(id); };

async function flush() {
  timer = null;
  const batch = [...pending].slice(0, BATCH);
  batch.forEach((id) => pending.delete(id));
  if (batch.length) {
    const me = getSigner()?.pubkey ?? null;
    const apply = (ev) => {
      for (const id of targetsOf(ev)) if (batch.includes(id) && addInteraction(get(id), ev, id, me)) emit(id);
    };
    await new Promise((resolve) => {
      const sub = pool.subscribe([{ kinds: [1, 6, 7, 16], '#e': batch, limit: 500 }, { kinds: [1], '#q': batch, limit: 100 }], {
        closeOnEose: true, maxEvents: 600, onevent: apply, oneose: resolve });
      setTimeout(() => { sub?.close?.(); resolve(); }, 8000);
    });
    batch.forEach((id) => { get(id).loaded = true; emit(id); });
  }
  if (pending.size) timer ||= setTimeout(flush, 100);
}

// Suit les compteurs d'une note : cb({ replies, reposts, reactions, quotes, reacted, reposted }).
export function watchStats(eventId, cb) {
  if (!eventId) return;
  if (!watchers.has(eventId)) watchers.set(eventId, new Set());
  watchers.get(eventId).add(cb);
  if (stats.get(eventId)?.loaded) { emit(eventId); return; }
  pending.add(eventId);
  timer ||= setTimeout(flush, 400);
}

// Après une action de l'utilisateur : met à jour tout de suite le compteur (sans attendre le relais).
export function bumpStat(eventId, field) {
  const s = get(eventId);
  const me = getSigner()?.pubkey;
  const at = Math.floor(Date.now() / 1000);
  if (field === 'reactions') { s.reactions++; s.reacted = true; if (me) s.reactors.unshift({ from: me, emoji: '+', at }); }
  if (field === 'reposts') { s.reposts++; s.reposted = true; if (me) s.reposters.unshift({ from: me, at }); }
  if (field === 'replies') s.replies++;
  emit(eventId);
}
