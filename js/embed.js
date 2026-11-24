// Récupération d'une note ou d'un article cité : cache mémoire, cache local, puis relais (événements déjà vérifiés par le pool).
import { pool } from './relays/pool.js';
import { getEvent, getReplaceable, putEvent } from './storage/db.js';

const memory = new Map();
const pending = new Map();

export function fetchRef(ref, timeout = 6000) {
  const key = ref.id ?? `${ref.kind}:${ref.pubkey}:${ref.identifier}`;
  if (memory.has(key)) return Promise.resolve(memory.get(key));
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const cached = ref.id ? await getEvent(ref.id) : await getReplaceable(ref.kind, ref.pubkey, ref.identifier);
    if (cached) return cached;
    return new Promise((resolve) => {
      let best = null, sub = null;
      const finish = () => { clearTimeout(timer); sub?.close(); resolve(best); };
      const timer = setTimeout(finish, timeout);
      const filter = ref.id ? { ids: [ref.id], limit: 1 } : { kinds: [ref.kind], authors: [ref.pubkey], '#d': [ref.identifier], limit: 1 };
      sub = pool.subscribe([filter], { closeOnEose: true, oneose: finish, onevent: (ev) => {
        if (ref.id ? ev.id !== ref.id : (ev.kind !== ref.kind || ev.pubkey !== ref.pubkey)) return;
        if (!best || ev.created_at > best.created_at) best = ev;
      } });
    });
  })().then((ev) => { if (ev) { memory.set(key, ev); putEvent(ev); } pending.delete(key); return ev; });
  pending.set(key, p);
  return p;
}
