// NIP-46 (signeur distant) : adaptateur mince autour de nostr-tools. Module sans DOM.
// Le client ne manipule QUE une clé de transport éphémère : la clé d'identité reste dans le signeur.
import { normalizeRelayUrl } from './relayurl.js';
import { bytesToHex, hexToBytes } from './nip19.js';
import { matchesTemplate } from './events.js';

const HEX64 = /^[0-9a-f]{64}$/;
export const PERMS = ['sign_event:0', 'sign_event:1', 'sign_event:3', 'sign_event:5', 'sign_event:6', 'sign_event:7',
  'sign_event:13', 'sign_event:9734', 'sign_event:10002', 'sign_event:10050', 'sign_event:22242', 'nip44_encrypt', 'nip44_decrypt'];

export class Nip46Error extends Error {
  constructor(code) { super(code); this.code = code; } // invalid | no-relays | timeout | unsupported | failed
}

let libPromise = null;
const loadLib = () => (libPromise ||= import('./lib.js'));

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Nip46Error('timeout')), ms);
  Promise.resolve(p).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

// Les relais fournis par un lien bunker:// sont non fiables : mêmes règles que pour la liste de l'utilisateur.
export function cleanRelays(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const u = normalizeRelayUrl(r);
    if (u && !out.includes(u)) out.push(u);
  }
  return out.slice(0, 4);
}

function need(lib) {
  const n = lib?.nip46;
  if (!n?.BunkerSigner || typeof lib.generateSecretKey !== 'function') throw new Nip46Error('unsupported');
  return n;
}

async function closeQuietly(signer) {
  try { await signer?.close?.(); } catch { /* déjà fermé */ }
}

// Enveloppe : seule la clé de transport (hex) sort d'ici, pour la session d'onglet.
function wrap(signer, { pubkey, clientKey, bunkerPubkey, relays }) {
  return {
    pubkey,
    saved: { pubkey, clientKey: bytesToHex(clientKey), bunker: { pubkey: bunkerPubkey, relays } },
    async signEvent(tpl) {
      const ev = await withTimeout(signer.signEvent(tpl), 90000);
      if (!matchesTemplate(ev, tpl, pubkey)) throw new Nip46Error('failed');
      return ev;
    },
    close: () => closeQuietly(signer),
  };
}

async function finish(signer, meta, timeout) {
  const pubkey = await withTimeout(signer.getPublicKey(), timeout);
  if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) throw new Nip46Error('failed');
  return wrap(signer, { ...meta, pubkey });
}

// Connexion à partir d'un lien bunker://… ou d'une adresse NIP-05 de signeur.
export async function connectBunker(input, { lib, timeout = 120000 } = {}) {
  lib ||= await loadLib();
  const n = need(lib);
  const text = String(input ?? '').trim();
  if (!text || text.length > 2000 || /^(nsec|ncryptsec)1/i.test(text)) throw new Nip46Error('invalid');
  let bp;
  try { bp = await withTimeout(n.parseBunkerInput(text), 15000); } catch (e) { throw e instanceof Nip46Error ? e : new Nip46Error('invalid'); }
  if (!bp || !HEX64.test(bp.pubkey ?? '')) throw new Nip46Error('invalid');
  const relays = cleanRelays(bp.relays);
  if (!relays.length) throw new Nip46Error('no-relays');
  const clientKey = lib.generateSecretKey();
  const signer = n.BunkerSigner.fromBunker(clientKey, { pubkey: bp.pubkey, relays, secret: bp.secret ?? null }, {});
  try {
    await withTimeout(signer.connect(), timeout);
    return await finish(signer, { clientKey, bunkerPubkey: bp.pubkey, relays }, 60000);
  } catch (e) {
    await closeQuietly(signer);
    throw e instanceof Nip46Error ? e : new Nip46Error('failed');
  }
}

// Connexion initiée par le client : on fabrique un lien nostrconnect:// que le signeur approuve.
export async function startNostrConnect({ relays, name = 'Client Nostr', url, lib, maxWait = 300000 } = {}) {
  lib ||= await loadLib();
  const n = need(lib);
  if (typeof n.createNostrConnectURI !== 'function' || typeof n.BunkerSigner.fromURI !== 'function' || typeof lib.getPublicKey !== 'function') throw new Nip46Error('unsupported');
  const list = cleanRelays(relays).slice(0, 3);
  if (!list.length) throw new Nip46Error('no-relays');
  const clientKey = lib.generateSecretKey();
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const uri = n.createNostrConnectURI({ clientPubkey: lib.getPublicKey(clientKey), relays: list, secret, perms: PERMS, name, url });
  let cancelled = false;
  const promise = (async () => {
    let signer;
    try {
      signer = await n.BunkerSigner.fromURI(clientKey, uri, {}, maxWait);
      if (cancelled) throw new Nip46Error('cancelled');
      const bunkerPubkey = signer.bp?.pubkey;
      return await finish(signer, { clientKey, bunkerPubkey: HEX64.test(bunkerPubkey ?? '') ? bunkerPubkey : '0'.repeat(64), relays: list }, 60000);
    } catch (e) {
      await closeQuietly(signer);
      throw e instanceof Nip46Error ? e : new Nip46Error('failed');
    }
  })();
  promise.catch(() => {});
  return { uri, wait: () => promise, cancel: () => { cancelled = true; } };
}

// Reprise d'une session d'onglet : aucune requête réseau n'est bloquante ici.
export async function restoreBunker(saved, { lib } = {}) {
  lib ||= await loadLib();
  const n = need(lib);
  const relays = cleanRelays(saved?.bunker?.relays);
  if (!HEX64.test(saved?.clientKey ?? '') || !HEX64.test(saved?.bunker?.pubkey ?? '') || !HEX64.test(saved?.pubkey ?? '') || !relays.length) throw new Nip46Error('invalid');
  const clientKey = hexToBytes(saved.clientKey);
  const signer = n.BunkerSigner.fromBunker(clientKey, { pubkey: saved.bunker.pubkey, relays, secret: null }, {});
  return wrap(signer, { pubkey: saved.pubkey, clientKey, bunkerPubkey: saved.bunker.pubkey, relays });
}
