// Publication d'un événement sur une liste de relais via des connexions TEMPORAIRES
// (relais d'amorçage et relais de la liste : on ne les garde pas ouverts pour autant).
import { normalizeRelayUrl } from '../nostr/relayurl.js';

const DEFAULTS = { concurrency: 8, connectTimeout: 6000, okTimeout: 8000 };

function publishOne(url, event, { WS, connectTimeout, okTimeout, sign }) {
  return new Promise((resolve) => {
    let ws, done = false, t1, t2, challenge = null, authed = false, authId = null;
    const finish = (ok, message) => {
      if (done) return;
      done = true;
      clearTimeout(t1); clearTimeout(t2);
      try { ws?.close(); } catch { /* déjà fermé */ }
      resolve({ url, ok, message });
    };
    t1 = setTimeout(() => finish(false, 'not-connected'), connectTimeout);
    try { ws = new WS(url); } catch { return finish(false, 'not-connected'); }
    ws.onopen = () => {
      clearTimeout(t1);
      t2 = setTimeout(() => finish(false, 'timeout'), okTimeout);
      send(['EVENT', event]);
    };
    const send = (msg) => { try { ws.send(JSON.stringify(msg)); } catch { finish(false, 'send-failed'); } };
    // NIP-42 à la demande : le relais a répondu « auth-required » → on s'authentifie puis on renvoie une fois
    const authenticate = async () => {
      if (authed || authId || !sign || !challenge) return finish(false, 'auth-required');
      let signed;
      try { signed = await sign({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', url], ['challenge', challenge]], content: '' }); } catch { return finish(false, 'auth-required'); }
      if (!signed?.id || done) return finish(false, 'auth-required');
      authId = signed.id;
      send(['AUTH', signed]);
    };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === 'AUTH' && typeof msg[1] === 'string') challenge = msg[1];
      else if (msg[0] === 'OK' && msg[1] === authId) { if (msg[2] === true) { authed = true; send(['EVENT', event]); } else finish(false, 'auth-failed'); }
      else if (msg[0] === 'OK' && msg[1] === event.id) {
        const message = String(msg[3] ?? '').slice(0, 200);
        if (msg[2] !== true && /^auth-required/i.test(message) && !authed) authenticate();
        else finish(msg[2] === true, message);
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => finish(false, 'closed');
  });
}

// → [{ url, ok, message }] (une entrée par relais, dans l'ordre)
export async function publishToMany(urls, event, { WS = globalThis.WebSocket, onProgress, ...rest } = {}) {
  const opts = { ...DEFAULTS, ...rest, WS };
  const list = [...new Set((urls ?? []).map(normalizeRelayUrl).filter(Boolean))];
  const out = new Array(list.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await publishOne(list[i], event, opts);
      onProgress?.({ done: ++done, total: list.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, list.length) }, worker));
  return out;
}
