// Session : méthode + clé PUBLIQUE (localStorage). Aucune clé d'identité n'est jamais stockée.
// NIP-46 : la clé de TRANSPORT éphémère reste dans sessionStorage (limitée à l'onglet).
import { keptMeta } from './kept.js';

const KEY = 'nostr-client:session';
const KEY46 = 'nostr-client:nip46';
const METHODS = ['nip07'];
const HEX64 = /^[0-9a-f]{64}$/;

export function loadNip46() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY46));
    if (s && HEX64.test(s.pubkey) && HEX64.test(s.clientKey) && HEX64.test(s.bunker?.pubkey) && Array.isArray(s.bunker.relays)) {
      return { pubkey: s.pubkey, clientKey: s.clientKey, bunker: { pubkey: s.bunker.pubkey, relays: s.bunker.relays.filter((r) => typeof r === 'string').slice(0, 4) } };
    }
  } catch { /* absente ou illisible */ }
  return null;
}

export function saveNip46(data) {
  try { if (data) sessionStorage.setItem(KEY46, JSON.stringify(data)); else sessionStorage.removeItem(KEY46); } catch { /* indisponible */ }
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && METHODS.includes(s.method) && HEX64.test(s.pubkey)) return { method: s.method, pubkey: s.pubkey };
  } catch { /* absente ou illisible */ }
  const n = loadNip46() ?? keptMeta();   // session d'onglet, ou connexion conservée sur cet appareil
  return n ? { method: 'nip46', pubkey: n.pubkey } : null;
}

export function saveSession(session) {
  try {
    if (session && METHODS.includes(session.method)) localStorage.setItem(KEY, JSON.stringify({ method: session.method, pubkey: session.pubkey }));
    else localStorage.removeItem(KEY);
  } catch { /* stockage indisponible */ }
}
