import { state } from './state.js';
import { saveSession, loadNip46, saveNip46 } from './storage/session.js';
import { matchesTemplate } from './nostr/events.js';
import { restoreBunker } from './nostr/nip46.js';
import { keepNip46, loadKept, forgetNip46, keptMeta } from './storage/kept.js';

const HEX64 = /^[0-9a-f]{64}$/;
export const hasExtension = () => typeof window.nostr?.getPublicKey === 'function';

// Chiffrement NIP-44 / NIP-04 d'une extension NIP-07 : facultatif dans la spécification, donc détecté à l'usage.
const ext = (kind) => {
  const api = window.nostr?.[kind];
  return typeof api?.encrypt === 'function' && typeof api?.decrypt === 'function'
    ? { encrypt: (pk, text) => api.encrypt(pk, text), decrypt: (pk, text) => api.decrypt(pk, text) } : null;
};

// → { nip44: 'yes' | 'no' | 'unknown', nip04: … } selon le type de signeur ('unknown' = à vérifier à la première utilisation)
export function signerCapabilities(session = state.get('session')) {
  if (!session) return { nip44: 'no', nip04: 'no' };
  if (session.method === 'nip07') return { nip44: ext('nip44') ? 'yes' : 'no', nip04: ext('nip04') ? 'yes' : 'no' };
  const s = getSigner();
  return { nip44: s?.nip44 ? 'unknown' : 'no', nip04: s?.nip04 ? 'unknown' : 'no' };
}

let remote = null; // signeur NIP-46 actif (en mémoire uniquement)

export function setSession(session) {
  remote?.close?.();
  remote = null;
  saveNip46(null);
  forgetNip46();   // un changement de session efface aussi la connexion conservée
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

// `info` vient de nostr/nip46.js (connectBunker / startNostrConnect)
export function setRemoteSession(info) {
  setSession(null);
  remote = info;
  saveNip46(info.saved);
  state.set('session', { method: 'nip46', pubkey: info.pubkey });
}

// Au démarrage : reprise silencieuse de la session NIP-46 (onglet, ou connexion conservée sur cet appareil).
async function notice(key) {
  try { const { toast } = await import('./ui/toast.js'); const { t } = await import('./i18n.js'); toast(t(key), { error: true }); } catch { /* sans interface */ }
}

export async function restoreRemoteSession() {
  if (state.get('session')?.method !== 'nip46') return;
  let saved = loadNip46(), fromKept = false;
  if (!saved) {
    const k = await loadKept();
    if (k.error === 'storage') { notice('restore.storage'); return; }   // passager : on garde tout, un rechargement réessaiera
    if (k.error) { forgetNip46(); state.set('session', null); notice(k.error === 'missing' ? 'restore.missing' : 'restore.key'); return; }
    saved = k.saved; fromKept = true;
  }
  try {
    remote = await restoreBunker(saved);
    if (fromKept) saveNip46(saved);
  } catch { saveNip46(null); forgetNip46(); state.set('session', null); notice('restore.invalid'); }
}

// Case « Rester connecté sur cet appareil » (signeur distant uniquement)
export const isRemoteKept = () => !!keptMeta();
export async function setRemoteKept(on) {
  if (!on) { await forgetNip46(); return; }
  if (!remote?.saved) throw new Error('no-remote');
  await keepNip46(remote.saved);
}

async function verified(ev, tpl, pubkey) {
  if (!matchesTemplate(ev, tpl, pubkey)) throw new Error('signer-mismatch'); // autre clé ou contenu modifié
  const lib = await import('./nostr/lib.js');
  if (lib.verifyEvent(ev) !== true) throw new Error('bad-signature');
  return ev;
}

// Signeur utilisé pour publier (suivre, notes…). null sans signeur.
export function getSigner() {
  const s = state.get('session');
  if (!s) return null;
  if (s.method === 'nip07') {
    return {
      pubkey: s.pubkey,
      async signEvent(tpl) {
        if (!hasExtension()) throw new Error('no-extension');
        return verified(await window.nostr.signEvent(tpl), tpl, s.pubkey);
      },
      get nip44() { return ext('nip44'); },   // évalués à l'usage : une extension peut s'injecter après le chargement
      get nip04() { return ext('nip04'); },
    };
  }
  if (s.method === 'nip46' && remote) {
    return { pubkey: s.pubkey, signEvent: async (tpl) => verified(await remote.signEvent(tpl), tpl, s.pubkey), nip44: remote.nip44, nip04: remote.nip04 };
  }
  return null;
}

// Retour à la page demandée après connexion (liens partagés, rechargement…)
const RETURN_KEY = 'nostr-client:return';
export function rememberReturnTo(hash) {
  if (typeof hash !== 'string' || !/^#\/[^\s]{0,500}$/.test(hash) || /^#\/login/.test(hash)) return;
  try { sessionStorage.setItem(RETURN_KEY, hash); } catch { /* indisponible */ }
}
export function takeReturnTo() {
  let h = null;
  try { h = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); } catch { /* indisponible */ }
  return typeof h === 'string' && /^#\/[^\s]{0,500}$/.test(h) && !/^#\/login/.test(h) ? h : '#/feed';
}
