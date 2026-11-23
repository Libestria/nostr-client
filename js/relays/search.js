// Recherche NIP-50 : connexions TEMPORAIRES aux relais de recherche (fermées dès la réponse).
// Chaque événement reçu est contrôlé (forme puis signature) ; authentification NIP-42 si le relais l'exige.
import { isValidShape } from '../nostr/events.js';
import { verifyEvent } from '../nostr/verifier.js';

function queryRelay(url, filters, { WS, timeout, sign, max }) {
  return new Promise((resolve) => {
    const sid = `q${Math.random().toString(36).slice(2, 8)}`;
    const events = [];
    let ws, done = false, challenge = null, authId = null, authTried = false, t1, t2;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(t1); clearTimeout(t2); try { ws?.close(); } catch { /* fermé */ } resolve({ ok, events }); };
    const send = (m) => { try { ws.send(JSON.stringify(m)); } catch { finish(false); } };
    const req = () => send(['REQ', sid, ...filters]);
    t1 = setTimeout(() => finish(false), timeout);
    try { ws = new WS(url); } catch { return finish(false); }
    ws.onopen = () => { clearTimeout(t1); t2 = setTimeout(() => finish(true), timeout); req(); };
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(events.length > 0);
    ws.onmessage = async (msg) => {
      let m; try { m = JSON.parse(msg.data); } catch { return; }
      if (!Array.isArray(m)) return;
      if (m[0] === 'AUTH' && typeof m[1] === 'string') challenge = m[1];
      else if (m[0] === 'EVENT' && m[1] === sid) { if (events.length < max && isValidShape(m[2])) events.push(m[2]); }
      else if (m[0] === 'EOSE' && m[1] === sid) finish(true);
      else if (m[0] === 'OK' && m[1] === authId) { if (m[2] === true) req(); else finish(false); }
      else if (m[0] === 'CLOSED' && m[1] === sid) {
        if (/^auth-required/i.test(String(m[2] ?? '')) && sign && challenge && !authTried) {
          authTried = true;
          try {
            const a = await sign({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', url], ['challenge', challenge]], content: '' });
            if (!a?.id) return finish(false);
            authId = a.id; send(['AUTH', a]);
          } catch { finish(false); }
        } else finish(false);
      }
    };
  });
}

// → { events (dédoublonnés, signatures vérifiées), responded, total }
export async function searchRelays(urls, filters, { WS = globalThis.WebSocket, timeout = 8000, sign = null, max = 100, verify = verifyEvent } = {}) {
  const list = [...new Set(urls)].slice(0, 6);
  const results = await Promise.all(list.map((u) => queryRelay(u, filters, { WS, timeout, sign, max })));
  const byId = new Map();
  for (const r of results) for (const e of r.events) if (!byId.has(e.id)) byId.set(e.id, e);
  const checked = [];
  await Promise.all([...byId.values()].map(async (e) => { try { if (await verify(e)) checked.push(e); } catch { /* rejeté */ } }));
  return { events: checked, responded: results.filter((r) => r.ok).length, total: list.length };
}
