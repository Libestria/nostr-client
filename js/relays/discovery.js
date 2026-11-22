// Découverte des listes d'un compte sur les relais d'amorçage.
// Connexions TEMPORAIRES (fermées dès la réponse) : on n'ouvre pas 16 connexions permanentes.
// Deux vagues : relais d'amorçage, puis relais de la liste 10002 trouvée qui n'ont pas encore été interrogés.
import { isValidShape } from '../nostr/events.js';
import { normalizeRelayUrl } from '../nostr/relayurl.js';
import { relaysFromEvent, latestEvent } from '../nostr/relaylists.js';

export const DISCOVERY_KINDS = [0, 10002, 10007, 10050];
const DEFAULTS = { concurrency: 8, connectTimeout: 6000, fetchTimeout: 6000 };

function fetchFromRelay(url, pubkey, { WS, connectTimeout, fetchTimeout }) {
  return new Promise((resolve) => {
    const subId = `d${Math.random().toString(36).slice(2, 8)}`;
    const events = [];
    let ws, opened = false, done = false, t1, t2;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(t1); clearTimeout(t2);
      try { ws?.close(); } catch { /* déjà fermé */ }
      resolve(value);
    };
    t1 = setTimeout(() => finish(null), connectTimeout);
    try { ws = new WS(url); } catch { return finish(null); }
    ws.onopen = () => {
      opened = true;
      clearTimeout(t1);
      t2 = setTimeout(() => finish(events), fetchTimeout); // connecté : une réponse partielle compte
      try { ws.send(JSON.stringify(['REQ', subId, { kinds: DISCOVERY_KINDS, authors: [pubkey], limit: 20 }])); } catch { finish(null); }
    };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (!Array.isArray(msg) || msg[1] !== subId) return;
      if (msg[0] === 'EVENT') {
        const ev = msg[2];
        if (events.length < 50 && isValidShape(ev) && ev.pubkey === pubkey && DISCOVERY_KINDS.includes(ev.kind)) events.push(ev);
      } else if (msg[0] === 'EOSE') finish(events);
      else if (msg[0] === 'CLOSED') finish(null); // relais qui refuse (authentification…)
    };
    ws.onerror = () => {};
    ws.onclose = () => finish(opened ? events : null);
  });
}

async function fetchMany(urls, pubkey, opts, onDone) {
  const events = [];
  let responded = 0, next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const res = await fetchFromRelay(urls[next++], pubkey, opts);
      if (res) { responded++; events.push(...res); }
      onDone();
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, urls.length) }, worker));
  return { events, responded };
}

// Meilleur candidat dont la signature est valide (on ne vérifie que les gagnants, pas tous les doublons).
async function pickBest(all, kind, verify) {
  const candidates = [...all.values()].filter((e) => e.kind === kind)
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)).slice(0, 5);
  for (const ev of candidates) { try { if (await verify(ev)) return ev; } catch { /* suivant */ } }
  return null;
}

const defaultVerify = (ev) => import('../nostr/verifier.js').then((m) => m.verifyEvent(ev));

// → { events: { 0, 10002, 10007, 10050 → événement vérifié ou null }, responded, total }
export async function discoverAccount(pubkey, { boot, verify = defaultVerify, onProgress, WS = globalThis.WebSocket, ...rest } = {}) {
  const opts = { ...DEFAULTS, ...rest, WS };
  const urls = [...new Set((boot ?? []).map(normalizeRelayUrl).filter(Boolean))];
  const all = new Map();
  let responded = 0, total = urls.length, done = 0;
  const tick = () => onProgress?.({ done: ++done, total });
  const wave = async (list) => {
    const r = await fetchMany(list, pubkey, opts, tick);
    responded += r.responded;
    for (const ev of r.events) all.set(ev.id, ev);
  };
  onProgress?.({ done: 0, total });
  await wave(urls);
  const first = await pickBest(all, 10002, verify);
  const known = new Set(urls);
  const extra = relaysFromEvent(first, 'pub').map((r) => r.url).filter((u) => !known.has(u));
  if (extra.length) { total += extra.length; await wave(extra); }
  if (!responded) throw new Error('RELAY_LOAD_FAILED');
  const events = {};
  for (const kind of DISCOVERY_KINDS) events[kind] = await pickBest(all, kind, verify);
  return { events, responded, total };
}
