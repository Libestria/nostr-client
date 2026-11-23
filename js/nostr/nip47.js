// Nostr Wallet Connect (NIP-47) : fonctions pures. Le chiffrement et le réseau sont ailleurs.
import { normalizeRelayUrl } from './relayurl.js';

const HEX64 = /^[0-9a-f]{64}$/;
export class NwcError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
  // INVALID_URI | NO_RELAY | NO_SECRET | NWC_ENCRYPTION | NWC_UNSUPPORTED | NWC_TIMEOUT | NWC_RELAY | NWC_REFUSED | NWC_ERROR | AMOUNT_LIMIT | LOCKED | BAD_PASSWORD
}

// nostr+walletconnect://<pubkey>?relay=wss://…&secret=<hex>[&lud16=…]
export function parseConnection(input) {
  const raw = String(input ?? '').trim();
  const m = /^nostr\+walletconnect:(?:\/\/)?([0-9a-f]{64})\?(.+)$/i.exec(raw);
  if (!m) throw new NwcError('INVALID_URI');
  const params = new URLSearchParams(m[2]);
  const relays = params.getAll('relay').map(normalizeRelayUrl).filter(Boolean);
  if (!relays.length) throw new NwcError('NO_RELAY');
  const secret = (params.get('secret') ?? '').toLowerCase();
  if (!HEX64.test(secret)) throw new NwcError('NO_SECRET');
  const lud16 = (params.get('lud16') ?? '').slice(0, 120);
  return { walletPubkey: m[1].toLowerCase(), relays: relays.slice(0, 3), secret, lud16 };
}

// Requête pay_invoice (kind 23194) ; le contenu clair est { method, params }, à chiffrer en NIP-44.
export function payRequestPlain(invoice) { return JSON.stringify({ method: 'pay_invoice', params: { invoice } }); }
export function payRequestTemplate(walletPubkey, ciphertext, created_at = Math.floor(Date.now() / 1000)) {
  return { kind: 23194, created_at, content: ciphertext, tags: [['p', walletPubkey], ['encryption', 'nip44_v2'], ['expiration', String(created_at + 120)]] };
}

// Événement d'information du portefeuille (kind 13194) : contenu = méthodes (séparées par des espaces),
// balise « encryption » = schémas pris en charge (absente ⇒ NIP-04 seul, ancien comportement).
export function parseInfo(event) {
  if (event?.kind !== 13194 || typeof event.content !== 'string') return null;
  const methods = event.content.trim().split(/\s+/).filter(Boolean);
  const enc = event.tags?.find((t) => t[0] === 'encryption')?.[1];
  return { methods, encryption: enc ? enc.split(/\s+/) : ['nip04'] };
}
export function checkInfo(info) {
  if (!info) return;
  if (!info.encryption.includes('nip44_v2')) throw new NwcError('NWC_ENCRYPTION');
  if (info.methods.length && !info.methods.includes('pay_invoice')) throw new NwcError('NWC_UNSUPPORTED');
}

// Réponse (kind 23195) déchiffrée → { preimage } ou NwcError.
export function parseResponse(plain) {
  let r;
  try { r = JSON.parse(plain); } catch { throw new NwcError('NWC_ERROR'); }
  if (!r || typeof r !== 'object') throw new NwcError('NWC_ERROR');
  if (r.error) throw new NwcError('NWC_REFUSED', `${String(r.error.code ?? '').slice(0, 40)} ${String(r.error.message ?? '').slice(0, 160)}`.trim());
  if (r.result_type !== 'pay_invoice' || !r.result || typeof r.result.preimage !== 'string') throw new NwcError('NWC_ERROR');
  return { preimage: r.result.preimage };
}

// Une réponse valable : bon type, signée par le portefeuille, adressée à ce client, liée à la requête.
export function responseMatches(ev, { walletPubkey, clientPubkey, requestId }) {
  return ev?.kind === 23195 && ev.pubkey === walletPubkey && Array.isArray(ev.tags)
    && ev.tags.some((t) => t[0] === 'e' && t[1] === requestId) && ev.tags.some((t) => t[0] === 'p' && t[1] === clientPubkey);
}
