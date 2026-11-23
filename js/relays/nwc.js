// Échange NIP-47 sur le relais du portefeuille (WebSocket dédié, fermé après usage).
import { NwcError, parseInfo, checkInfo } from '../nostr/nip47.js';

// signRequest() est appelé APRÈS la vérification du portefeuille ; il renvoie l'événement de requête signé.
// onResponse(ev) → résultat ou lève ; resolu avec la valeur retournée.
export function nwcExchange({ relay, walletPubkey, clientPubkey, signRequest, onResponse, WS = globalThis.WebSocket, timeout = 60000, infoWait = 4000 }) {
  return new Promise((resolve, reject) => {
    let ws, done = false, request = null, phase = 'info';
    const timers = [];
    const finish = (err, value) => {
      if (done) return;
      done = true; timers.forEach(clearTimeout);
      try { ws?.close(); } catch { /* déjà fermé */ }
      err ? reject(err) : resolve(value);
    };
    const send = (m) => { try { ws.send(JSON.stringify(m)); } catch { finish(new NwcError('NWC_RELAY')); } };
    const go = async () => {
      if (phase !== 'info') return;
      phase = 'sent';
      try { request = await signRequest(); } catch (e) { return finish(e instanceof NwcError ? e : new NwcError('NWC_ERROR')); }
      send(['REQ', 'resp', { kinds: [23195], authors: [walletPubkey], '#e': [request.id], since: Math.floor(Date.now() / 1000) - 5 }]);
      send(['EVENT', request]);
      timers.push(setTimeout(() => finish(new NwcError('NWC_TIMEOUT')), timeout));
    };
    try { ws = new WS(relay); } catch { return finish(new NwcError('NWC_RELAY')); }
    timers.push(setTimeout(() => { if (phase === 'info' && !ws.readyState) finish(new NwcError('NWC_RELAY')); }, 10000));
    ws.onopen = () => {
      send(['REQ', 'info', { kinds: [13194], authors: [walletPubkey], limit: 1 }]);
      timers.push(setTimeout(go, infoWait));   // sans information du portefeuille : on tente quand même
    };
    ws.onerror = () => finish(new NwcError('NWC_RELAY'));
    ws.onclose = () => finish(new NwcError('NWC_RELAY'));
    ws.onmessage = async (msg) => {
      let m; try { m = JSON.parse(msg.data); } catch { return; }
      if (!Array.isArray(m)) return;
      if (m[0] === 'EVENT' && m[1] === 'info' && phase === 'info') {
        try { checkInfo(parseInfo(m[2])); } catch (e) { return finish(e); }
      } else if (m[0] === 'EOSE' && m[1] === 'info') go();
      else if (m[0] === 'OK' && request && m[1] === request.id && m[2] === false) finish(new NwcError('NWC_REFUSED', String(m[3] ?? '').slice(0, 160)));
      else if (m[0] === 'EVENT' && m[1] === 'resp' && request) {
        try { finish(null, await onResponse(m[2], request)); } catch (e) { if (e instanceof NwcError) finish(e); }
      }
    };
  });
}
