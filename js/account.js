// Listes de relais du compte connecté : cache, découverte, application au pool.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getReplaceable, putEvent } from './storage/db.js';
import { discoverAccount } from './relays/discovery.js';
import { acceptProfileEvent } from './profiles.js';
import { publishToMany } from './relays/oneshot.js';
import { LISTS, LIST_KEYS, relaysFromEvent, latestEvent, listTemplate, creationTemplate, tagUrls } from './nostr/relaylists.js';

const KINDS = [0, 10002, 10007, 10050];
let token = 0;
let appliedKey = '[]';

export async function suggestedRelays() {
  try {
    const res = await fetch(new URL('../data/suggested-relays.json', import.meta.url));
    const j = res.ok ? await res.json() : {};
    const out = {};
    for (const key of LIST_KEYS) out[key] = Array.isArray(j[key]) ? j[key].filter((u) => typeof u === 'string') : [];
    return out;
  } catch { return { pub: [], search: [], dm: [] }; }
}

export async function bootRelays() {
  const res = await fetch(new URL('../data/boot-relays.json', import.meta.url));
  if (!res.ok) throw new Error('boot-relays');
  const list = await res.json();
  return Array.isArray(list) ? list.filter((u) => typeof u === 'string') : [];
}

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

// Vérification à CHAQUE ouverture : le cache s'affiche tout de suite, la recherche tourne en arrière-plan.
export async function loadAccountLists(pubkey, {
  discover = async (pk, o) => discoverAccount(pk, { boot: await bootRelays(), ...o }),
  cache = { get: getReplaceable, put: putEvent },
  apply = (r) => pool.setRelays(r),
} = {}) {
  const my = ++token;
  const cached = {};
  for (const kind of KINDS) cached[kind] = await cache.get(kind, pubkey);
  if (my !== token) return;
  cached[0] && acceptProfileEvent(cached[0]);
  let lists = buildLists(cached, cached[10002] ? 'ready' : 'loading');
  state.set('lists', lists);
  applyRelays(lists.pub?.relays ?? [], apply);

  state.set('listsProgress', { running: true, done: 0, total: 0 });
  try {
    const found = await discover(pubkey, { onProgress: (p) => { if (my === token) state.set('listsProgress', { running: true, ...p }); } });
    if (my !== token) return;
    const merged = {};
    for (const kind of KINDS) {
      const mine = state.get('lists')[LIST_KEYS.find((k) => LISTS[k].kind === kind)]?.event; // version publiée entre-temps
      const ev = latestEvent([cached[kind], found.events[kind], mine].filter(Boolean), kind);
      merged[kind] = ev;
      if (found.events[kind]) cache.put(found.events[kind]);
    }
    merged[0] && acceptProfileEvent(merged[0]);
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

// ---- Modification des listes ----

function currentEvents() {
  const lists = state.get('lists');
  const byKind = {};
  for (const key of LIST_KEYS) if (lists[key]?.event) byKind[LISTS[key].kind] = lists[key].event;
  return byKind;
}

// Applique une version signée : état, cache, pool.
export function applyListEvent(event, { cache = { put: putEvent }, apply = (r) => pool.setRelays(r) } = {}) {
  const byKind = currentEvents();
  byKind[event.kind] = event;
  const lists = buildLists(byKind, byKind[10002] ? 'ready' : state.get('lists').status);
  state.set('lists', lists);
  cache.put(event);
  if (event.kind === 10002) applyRelays(lists.pub?.relays ?? [], apply);
}

// Cibles de publication : relais d'amorçage + relais de la liste (nouvelle et ancienne version,
// pour que les relais retirés reçoivent aussi la mise à jour) + relais d'écriture du compte.
export async function listTargets(key, event, previous, { boot = bootRelays } = {}) {
  let boots = [];
  try { boots = await boot(); } catch { /* amorçage indisponible : on publie sur le reste */ }
  const pubWrite = (state.get('lists').pub?.relays ?? []).filter((r) => r.write).map((r) => r.url);
  return [...new Set([...boots, ...tagUrls(event, key), ...tagUrls(previous, key), ...pubWrite])];
}

export async function publishListEvent(key, event, previous, { publish = publishToMany, boot, onProgress } = {}) {
  const targets = await listTargets(key, event, previous, { boot });
  const results = await publish(targets, event, { onProgress });
  return { event, results, ok: results.filter((r) => r.ok).length, total: results.length };
}

let queue = Promise.resolve();

// Une modification = une nouvelle version signée, appliquée tout de suite puis publiée partout.
// Les modifications sont traitées une par une (chaque version part de la précédente).
// → { event, results, ok, total } ; lève les erreurs de listTemplate ou NO_SIGNER / SIGN_FAILED.
export function editList(key, op, { signer, publish, boot, onProgress, cache, apply, now } = {}) {
  const run = async () => {
    if (!signer) throw new Error('NO_SIGNER');
    const previous = state.get('lists')[key]?.event ?? null;
    const tpl = listTemplate(key, previous, op, now);
    let signed;
    try { signed = await signer.signEvent(tpl); } catch { throw new Error('SIGN_FAILED'); }
    applyListEvent(signed, { cache, apply });
    const res = await publishListEvent(key, signed, previous, { publish, boot, onProgress });
    return res;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// Création des premières listes : { pub: [urls], search: [urls], dm: [urls] } (clés vides ignorées).
// Chaque liste est signée puis publiée ; elles ne sont appliquées à l'état qu'avec applyCreated(),
// pour que l'écran de résultat ne disparaisse pas avant d'avoir été lu.
// → { [key]: { event, results, ok, total } } ; lève NO_SIGNER / SIGN_FAILED / EMPTY (liste générale vide).
export function createLists(selection, { signer, publish, boot, onProgress, now } = {}) {
  const run = async () => {
    if (!signer) throw new Error('NO_SIGNER');
    if (!selection?.pub?.length) throw new Error('EMPTY');
    const out = {};
    for (const key of LIST_KEYS) {
      if (!selection[key]?.length) continue;
      const tpl = creationTemplate(key, selection[key], now);
      let signed;
      try { signed = await signer.signEvent(tpl); } catch { throw new Error('SIGN_FAILED'); }
      out[key] = await publishListEvent(key, signed, null, { publish, boot, onProgress });
    }
    return out;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

export function applyCreated(created, opts) {
  for (const key of LIST_KEYS) if (created[key]) applyListEvent(created[key].event, opts);
}
