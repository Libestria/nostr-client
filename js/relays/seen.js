// Mémoire des relais qui ont livré chaque événement (« reçue de… »). Module sans DOM, plafonné.
const seen = new Map();   // id -> Set(url)
const MAX = 3000;

export function noteSeen(id, url) {
  if (typeof id !== 'string' || typeof url !== 'string') return;
  let set = seen.get(id);
  if (!set) {
    if (seen.size >= MAX) seen.delete(seen.keys().next().value);
    set = new Set();
    seen.set(id, set);
  }
  set.add(url);
}

export const seenOn = (id) => [...(seen.get(id) ?? [])];
