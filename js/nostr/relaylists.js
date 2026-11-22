// Listes de relais d'un compte : 10002 (NIP-65), 10007 (recherche, NIP-51), 10050 (messagerie, NIP-17).
// Module sans DOM. Le contenu des listes est NON FIABLE : chaque adresse est normalisée et filtrée.
import { normalizeRelayUrl } from './relayurl.js';

export const LISTS = Object.freeze({
  pub: Object.freeze({ kind: 10002, tag: 'r', rw: true }),
  search: Object.freeze({ kind: 10007, tag: 'relay', rw: false }),
  dm: Object.freeze({ kind: 10050, tag: 'relay', rw: false }),
});
export const LIST_KEYS = Object.keys(LISTS);
export const MAX_LIST_RELAYS = 12;

// → [{ url, read, write }] (dans l'ordre de la liste, doublons fusionnés, plafonné)
export function relaysFromEvent(event, key) {
  const def = LISTS[key];
  if (!def || !event || event.kind !== def.kind || !Array.isArray(event.tags)) return [];
  const byUrl = new Map();
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== def.tag) continue;
    const url = normalizeRelayUrl(tag[1]);
    if (!url) continue;
    let read = true, write = true;
    if (def.rw && tag[2] === 'read') write = false;
    else if (def.rw && tag[2] === 'write') read = false;
    const cur = byUrl.get(url);
    if (cur) { cur.read ||= read; cur.write ||= write; }
    else if (byUrl.size < MAX_LIST_RELAYS) byUrl.set(url, { url, read, write });
  }
  return [...byUrl.values()];
}

// Version la plus récente ; à égalité, l'identifiant le plus bas (NIP-01).
export function latestEvent(events, kind) {
  let best = null;
  for (const ev of events) {
    if (ev?.kind !== kind) continue;
    if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev;
  }
  return best;
}
