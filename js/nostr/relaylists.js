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

// Toutes les adresses d'une liste (sans plafond d'affichage), normalisées.
export function tagUrls(event, key) {
  const def = LISTS[key];
  if (!def || !event || event.kind !== def.kind || !Array.isArray(event.tags)) return [];
  const out = new Set();
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== def.tag) continue;
    const url = normalizeRelayUrl(tag[1]);
    if (url) out.add(url);
  }
  return [...out];
}

const makeTag = (key, url, read, write) => {
  const def = LISTS[key];
  if (!def.rw || (read && write)) return [def.tag, url];
  return [def.tag, url, read ? 'read' : 'write'];
};

// Modèle d'événement après une modification, construit à partir de la version la plus récente :
// les étiquettes qui ne sont pas des relais, les adresses non reconnues et le contenu sont conservés.
// op : { type: 'add', url, read, write } | { type: 'remove', url } | { type: 'role', url, read, write }
// Erreurs (message) : INVALID_URL, DUPLICATE, MAX, LAST, NOT_FOUND, INVALID_ROLE
export function listTemplate(key, event, op, now = Math.floor(Date.now() / 1000)) {
  const def = LISTS[key];
  const url = normalizeRelayUrl(op?.url);
  if (!def) throw new Error('INVALID_LIST');
  if (!url) throw new Error('INVALID_URL');
  const base = event && event.kind === def.kind && Array.isArray(event.tags) ? event : null;
  const current = relaysFromEvent(base, key);
  const has = tagUrls(base, key).includes(url);
  const read = def.rw ? op.read !== false : true;
  const write = def.rw ? op.write !== false : true;
  if (op.type !== 'remove' && !read && !write) throw new Error('INVALID_ROLE');
  let tags = (base?.tags ?? []).map((tg) => (Array.isArray(tg) ? [...tg] : tg));
  const isMine = (tg) => Array.isArray(tg) && tg[0] === def.tag && normalizeRelayUrl(tg[1]) === url;

  if (op.type === 'add') {
    if (has) throw new Error('DUPLICATE');
    if (current.length >= MAX_LIST_RELAYS) throw new Error('MAX');
    tags.push(makeTag(key, url, read, write));
  } else if (op.type === 'remove') {
    if (!has) throw new Error('NOT_FOUND');
    if (key === 'pub' && tagUrls(base, key).length <= 1) throw new Error('LAST');
    tags = tags.filter((tg) => !isMine(tg));
  } else if (op.type === 'role') {
    if (!has || !def.rw) throw new Error('NOT_FOUND');
    let done = false;
    tags = tags.flatMap((tg) => {
      if (!isMine(tg)) return [tg];
      if (done) return [];
      done = true;
      return [makeTag(key, url, read, write)];
    });
  } else throw new Error('INVALID_OP');

  return {
    kind: def.kind,
    created_at: Math.max(now, (base?.created_at ?? 0) + 1),
    tags,
    content: typeof base?.content === 'string' ? base.content : '',
  };
}
