// Portefeuille Nostr Wallet Connect (NIP-47) : la chaîne de connexion contient un secret (clé dédiée à la connexion,
// pas votre clé Nostr). Il est chiffré par mot de passe sur cet appareil et déverrouillé en mémoire pour la session.
import { state } from './state.js';
import { parseConnection, payRequestPlain, payRequestTemplate, parseResponse, responseMatches, NwcError } from './nostr/nip47.js';
import { seal, open } from './storage/vault.js';
import { nwcExchange } from './relays/nwc.js';
import { hexToBytes } from './nostr/nip19.js';

const KEY = 'nostr-client:nwc';
const MIN_PASSWORD = 8;
export const DEFAULT_MAX_SATS = 5000;
let unlocked = null;   // secret (hex) en mémoire seulement

const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.v === 1 && v.blob ? v : null; } catch { return null; } };

// Configuration enregistrée, sans le secret : { walletPubkey, relays, lud16, maxSats } ou null
export function walletInfo() {
  const c = read();
  return c ? { walletPubkey: c.walletPubkey, relays: c.relays, lud16: c.lud16, maxSats: c.maxSats } : null;
}
export const isUnlocked = () => unlocked !== null;
export const lock = () => { unlocked = null; };

export async function saveWallet(uri, password, maxSats = DEFAULT_MAX_SATS) {
  const conn = parseConnection(uri);
  if (String(password ?? '').length < MIN_PASSWORD) throw new NwcError('WEAK_PASSWORD');
  const limit = Number.isInteger(maxSats) && maxSats > 0 ? Math.min(maxSats, 1_000_000) : DEFAULT_MAX_SATS;
  const blob = await seal(password, conn.secret);
  localStorage.setItem(KEY, JSON.stringify({ v: 1, walletPubkey: conn.walletPubkey, relays: conn.relays, lud16: conn.lud16, maxSats: limit, blob }));
  unlocked = conn.secret;
}

export function setMaxSats(n) {
  const c = read();
  if (!c || !Number.isInteger(n) || n < 1) return;
  c.maxSats = Math.min(n, 1_000_000);
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function removeWallet() { unlocked = null; try { localStorage.removeItem(KEY); } catch { /* indisponible */ } }

export async function unlock(password) {
  const c = read();
  if (!c) throw new NwcError('NO_WALLET');
  unlocked = await open(password, c.blob);   // lève BAD_PASSWORD
}

// Paie une facture. → { preimage }. Erreurs : NwcError (LOCKED, AMOUNT_LIMIT, NWC_*)
export async function payWithWallet(pr, amountSats, { lib, WS } = {}) {
  const c = read();
  if (!c) throw new NwcError('NO_WALLET');
  if (!unlocked) throw new NwcError('LOCKED');
  if (!Number.isInteger(amountSats) || amountSats > c.maxSats) throw new NwcError('AMOUNT_LIMIT', String(c.maxSats));
  lib ||= await import('./nostr/lib.js');
  const sk = hexToBytes(unlocked);
  const clientPubkey = lib.getPublicKey(sk);
  const key = lib.nip44.getConversationKey(sk, c.walletPubkey);
  let last = new NwcError('NWC_RELAY');
  for (const relay of c.relays) {
    try {
      return await nwcExchange({
        relay, walletPubkey: c.walletPubkey, clientPubkey, WS,
        signRequest: async () => lib.finalizeEvent(payRequestTemplate(c.walletPubkey, lib.nip44.encrypt(payRequestPlain(pr), key)), sk),
        onResponse: async (ev, request) => {
          if (!responseMatches(ev, { walletPubkey: c.walletPubkey, clientPubkey, requestId: request.id }) || !lib.verifyEvent(ev)) throw new Error('ignore');
          return parseResponse(lib.nip44.decrypt(ev.content, key));
        },
      });
    } catch (e) {
      last = e instanceof NwcError ? e : new NwcError('NWC_ERROR');
      if (last.code !== 'NWC_RELAY' && last.code !== 'NWC_TIMEOUT') throw last;
    }
  }
  throw last;
}

// Le secret ne survit pas à la déconnexion du compte.
export function initWallet() {
  state.on('session', (s) => { if (!s) removeWallet(); });
}
