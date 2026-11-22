// Listes de relais du compte connecté : cache, découverte, application au pool.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getReplaceable, putEvent } from './storage/db.js';
import { discoverAccount } from './relays/discovery.js';
import { acceptProfileEvent } from './profiles.js';
import { LISTS, LIST_KEYS, relaysFromEvent, latestEvent } from './nostr/relaylists.js';

const REFRESH_MS = 6 * 3600 * 1000;   // pas de nouvelle découverte avant 6 h, sauf demande ou nouvelle connexion
const KINDS = [0, 10002, 10007, 10050];
const checkedKey = (pk) => `nostr-client:lists-checked:${pk}`;
let token = 0;
let appliedKey = '[]';

async function bootRelays() {
  const res = await fetch(new URL('../data/boot-relays.json', import.meta.url));
  if (!res.ok) throw new Error('boot-relays');
  const list = await res.json();
  return Array.isArray(list) ? list.filter((u) => typeof u === 'string') : [];
}

const lsGet = (k) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* indisponible */ } };

// { status, pub, search, dm } à partir des événements (kind → événement)
export function buildLists(byKind, status) {
  const out = { status, pub: null, search: null, dm: null };
  for (const key of LIST_KEYS) {
    const ev = byKind[LISTS[key].kind];
    if (ev) out[key] = { event: ev, created_at: ev.created_at, relays: relaysFromEvent(ev, key) };
  }
  return out;
}

function applyRelays(relays, apply) {
  const key = JSON.stringify(relays);
  if (key === appliedKey) return;
  appliedKey = key;
  apply(relays);
}

export function resetAccount({ apply = (r) => pool.setRelays(r) } = {}) {
  token++;
  appliedKey = '[]';
  apply([]);
  state.set('lists', { status: 'idle', pub: null, search: null, dm: null });
  state.set('listsProgress', { running: false, done: 0, total: 0 });
}

export async function loadAccountLists(pubkey, {
  force = false,
  discover = async (pk, o) => discoverAccount(pk, { boot: await bootRelays(), ...o }),
  cache = { get: getReplaceable, put: putEvent },
  apply = (r) => pool.setRelays(r),
  now = () => Date.now(),
} = {}) {
  const my = ++token;
  const cached = {};
  for (const kind of KINDS) cached[kind] = await cache.get(kind, pubkey);
  if (my !== token) return;
  cached[0] && acceptProfileEvent(cached[0]);
  let lists = buildLists(cached, cached[10002] ? 'ready' : 'loading');
  state.set('lists', lists);
  applyRelays(lists.pub?.relays ?? [], apply);

  if (!force && lists.pub && now() - lsGet(checkedKey(pubkey)) < REFRESH_MS) return;

  state.set('listsProgress', { running: true, done: 0, total: 0 });
  try {
    const found = await discover(pubkey, { onProgress: (p) => { if (my === token) state.set('listsProgress', { running: true, ...p }); } });
    if (my !== token) return;
    const merged = {};
    for (const kind of KINDS) {
      const ev = latestEvent([cached[kind], found.events[kind]].filter(Boolean), kind);
      merged[kind] = ev;
      if (found.events[kind]) cache.put(found.events[kind]);
    }
    merged[0] && acceptProfileEvent(merged[0]);
    lsSet(checkedKey(pubkey), now());
    lists = buildLists(merged, merged[10002] ? 'ready' : 'empty');
    state.set('lists', lists);
    applyRelays(lists.pub?.relays ?? [], apply);
  } catch {
    if (my !== token) return;
    if (!lists.pub) state.set('lists', { ...lists, status: 'error' });
  } finally {
    if (my === token) state.set('listsProgress', { running: false, done: 0, total: 0 });
  }
}
