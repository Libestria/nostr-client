// Publication d'un événement sur une liste de relais via des connexions TEMPORAIRES
// (relais d'amorçage et relais de la liste : on ne les garde pas ouverts pour autant).
import { normalizeRelayUrl } from '../nostr/relayurl.js';

const DEFAULTS = { concurrency: 8, connectTimeout: 6000, okTimeout: 8000 };

function publishOne(url, event, { WS, connectTimeout, okTimeout }) {
  return new Promise((resolve) => {
    let ws, done = false, t1, t2;
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
      try { ws.send(JSON.stringify(['EVENT', event])); } catch { finish(false, 'send-failed'); }
    };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (Array.isArray(msg) && msg[0] === 'OK' && msg[1] === event.id) finish(msg[2] === true, String(msg[3] ?? '').slice(0, 200));
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
