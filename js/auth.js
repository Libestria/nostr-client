import { state } from './state.js';
import { saveSession } from './storage/session.js';

const HEX64 = /^[0-9a-f]{64}$/;
export const hasExtension = () => typeof window.nostr?.getPublicKey === 'function';

export function setSession(session) {
  saveSession(session);
  state.set('session', session);
}

export async function connectExtension() {
  if (!hasExtension()) throw new Error('no-extension');
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000));
  const pubkey = await Promise.race([window.nostr.getPublicKey(), timeout]);
  if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) throw new Error('bad-pubkey');
  return { method: 'nip07', pubkey };
}

export const readOnlySession = (pubkey) => ({ method: 'readonly', pubkey });

// Signeur utilisé par les jalons d'écriture (M4+). null en lecture seule.
export function getSigner() {
  const s = state.get('session');
  if (!s || s.method !== 'nip07' || state.get('settings')?.readOnly) return null;
  return {
    pubkey: s.pubkey,
    async signEvent(template) {
      if (!hasExtension()) throw new Error('no-extension');
      const ev = await window.nostr.signEvent(template);
      if (ev?.pubkey !== s.pubkey) throw new Error('pubkey-mismatch'); // l'extension utilise une autre clé
      return ev;
    },
  };
}
