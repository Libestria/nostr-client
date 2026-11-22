import { state } from './state.js';
import { saveSession, loadNip46, saveNip46 } from './storage/session.js';
import { matchesTemplate } from './nostr/events.js';
import { restoreBunker } from './nostr/nip46.js';

const HEX64 = /^[0-9a-f]{64}$/;
export const hasExtension = () => typeof window.nostr?.getPublicKey === 'function';

let remote = null; // signeur NIP-46 actif (en mémoire uniquement)

export function setSession(session) {
  remote?.close?.();
  remote = null;
  saveNip46(null);
  saveSession(session);
  state.set('session', session);
}

export const logout = () => setSession(null);

export async function connectExtension() {
  if (!hasExtension()) throw new Error('no-extension');
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000));
  const pubkey = await Promise.race([window.nostr.getPublicKey(), timeout]);
  if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) throw new Error('bad-pubkey');
  return { method: 'nip07', pubkey };
}

export const readOnlySession = (pubkey) => ({ method: 'readonly', pubkey });

// `info` vient de nostr/nip46.js (connectBunker / startNostrConnect)
export function setRemoteSession(info) {
  setSession(null);
  remote = info;
  saveNip46(info.saved);
  state.set('session', { method: 'nip46', pubkey: info.pubkey });
}

// Au démarrage : reprise silencieuse de la session NIP-46 de l'onglet.
export async function restoreRemoteSession() {
  const saved = loadNip46();
  if (!saved || state.get('session')?.method !== 'nip46') return;
  try { remote = await restoreBunker(saved); } catch { saveNip46(null); state.set('session', null); }
}

async function verified(ev, tpl, pubkey) {
  if (!matchesTemplate(ev, tpl, pubkey)) throw new Error('signer-mismatch'); // autre clé ou contenu modifié
  const lib = await import('./nostr/lib.js');
  if (lib.verifyEvent(ev) !== true) throw new Error('bad-signature');
  return ev;
}

// Signeur utilisé pour publier (suivre, notes…). null en lecture seule ou sans signeur.
export function getSigner() {
  const s = state.get('session');
  if (!s || state.get('settings')?.readOnly) return null;
  if (s.method === 'nip07') {
    return {
      pubkey: s.pubkey,
      async signEvent(tpl) {
        if (!hasExtension()) throw new Error('no-extension');
        return verified(await window.nostr.signEvent(tpl), tpl, s.pubkey);
      },
    };
  }
  if (s.method === 'nip46' && remote) {
    return { pubkey: s.pubkey, signEvent: async (tpl) => verified(await remote.signEvent(tpl), tpl, s.pubkey) };
  }
  return null;
}
