// Zaps (NIP-57) : fonctions pures (aucun réseau, aucun DOM). Le réseau est dans js/zap.js.
import { lnurlEncode } from './nip19.js';

const HEX64 = /^[0-9a-f]{64}$/;
const LUD16 = /^([a-z0-9._+-]{1,64})@([a-z0-9.-]{1,200}\.[a-z]{2,})$/i;
export const MAX_SATS = 10_000_000;

export class ZapError extends Error {
  constructor(code) { super(code); this.code = code; }
  // NO_LNURL | LNURL_INVALID | NO_NOSTR | AMOUNT_RANGE | COMMENT_TOO_LONG | CALLBACK_INVALID | INVOICE_INVALID | INVOICE_AMOUNT | INVALID
}

// lud16 « nom@domaine » → URL LNURL-pay (https uniquement) ; null si invalide.
export function lnurlpUrl(lud16) {
  const m = LUD16.exec(String(lud16 ?? '').trim());
  if (!m) return null;
  return `https://${m[2].toLowerCase()}/.well-known/lnurlp/${encodeURIComponent(m[1])}`;
}

const httpsUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; } };

// Valide la réponse LNURL-pay. → { callback, min, max (msats), nostrPubkey, commentAllowed, lnurl }
export function parseLnurlPay(json, lud16) {
  const url = lnurlpUrl(lud16);
  if (!url) throw new ZapError('NO_LNURL');
  if (!json || typeof json !== 'object' || json.tag !== 'payRequest') throw new ZapError('LNURL_INVALID');
  const cb = httpsUrl(json.callback);
  const min = Number(json.minSendable), max = Number(json.maxSendable);
  if (!cb || !Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) throw new ZapError('LNURL_INVALID');
  if (json.allowsNostr !== true || !HEX64.test(json.nostrPubkey ?? '')) throw new ZapError('NO_NOSTR');
  const commentAllowed = Number.isInteger(json.commentAllowed) && json.commentAllowed > 0 ? Math.min(json.commentAllowed, 500) : 0;
  return { callback: cb.href, min, max, nostrPubkey: json.nostrPubkey, commentAllowed, lnurl: lnurlEncode(url) };
}

// Demande de zap (kind 9734), à signer par l'utilisateur. Le contenu est le commentaire.
export function buildZapRequest({ recipient, eventId, amountSats, comment = '', relays, lnurl, kind }, created_at = Math.floor(Date.now() / 1000)) {
  if (!HEX64.test(recipient ?? '') || (eventId && !HEX64.test(eventId))) throw new ZapError('INVALID');
  if (!Number.isInteger(amountSats) || amountSats < 1 || amountSats > MAX_SATS) throw new ZapError('AMOUNT_RANGE');
  const urls = [...new Set(relays ?? [])].filter((u) => /^wss:\/\//.test(u)).slice(0, 10);
  const tags = [['relays', ...urls], ['amount', String(amountSats * 1000)], ['p', recipient]];
  if (lnurl) tags.push(['lnurl', lnurl]);
  if (eventId) { tags.push(['e', eventId]); if (Number.isInteger(kind)) tags.push(['k', String(kind)]); }
  return { kind: 9734, created_at, content: String(comment ?? ''), tags };
}

// URL de rappel (callback) avec montant, demande de zap et lnurl. Vérifie les limites du fournisseur.
export function callbackUrl(lnurlInfo, amountSats, zapRequest, comment = '') {
  const msats = amountSats * 1000;
  if (msats < lnurlInfo.min || msats > lnurlInfo.max) throw new ZapError('AMOUNT_RANGE');
  const text = String(comment ?? '');
  if (text.length > lnurlInfo.commentAllowed) throw new ZapError('COMMENT_TOO_LONG');
  const u = new URL(lnurlInfo.callback);
  u.searchParams.set('amount', String(msats));
  u.searchParams.set('nostr', JSON.stringify(zapRequest));
  u.searchParams.set('lnurl', lnurlInfo.lnurl);
  if (text && lnurlInfo.commentAllowed) u.searchParams.set('comment', text);
  return u.href;
}

const MULT = { m: 1e8, u: 1e5, n: 1e2, p: 0.1 };   // msats par unité de multiplicateur (1 BTC = 1e11 msats)
// Montant d'une facture BOLT11, en millisatoshis ; null si la facture n'a pas de montant ou est invalide.
export function bolt11Msats(pr) {
  const m = /^ln(?:bc|tbs|tb|bcrt)(\d+)([munp])?1[02-9ac-hj-np-z]{20,}$/i.exec(String(pr ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const msats = m[2] ? n * MULT[m[2].toLowerCase()] : n * 1e11;
  return Number.isSafeInteger(msats) && msats > 0 ? msats : null;
}

// Vérifie la facture reçue : une chaîne BOLT11 dont le montant est exactement celui demandé.
export function checkInvoice(pr, amountSats) {
  const msats = bolt11Msats(pr);
  if (typeof pr !== 'string' || msats == null) throw new ZapError('INVOICE_INVALID');
  if (msats !== amountSats * 1000) throw new ZapError('INVOICE_AMOUNT');
  return pr.trim();
}

// Reçu de zap (kind 9735) : valide s'il est signé par le fournisseur LNURL du destinataire
// (nostrPubkey), si la demande incluse (description) correspond à la note/au profil visé et si la facture a un montant.
// → { sats, from, comment, eventId } ou null.
export function checkReceipt(receipt, { recipient, nostrPubkey }) {
  if (receipt?.kind !== 9735 || receipt.pubkey !== nostrPubkey || !Array.isArray(receipt.tags)) return null;
  const tag = (n) => receipt.tags.find((t) => t[0] === n)?.[1];
  let req;
  try { req = JSON.parse(tag('description')); } catch { return null; }
  if (!req || req.kind !== 9734 || !Array.isArray(req.tags) || !HEX64.test(req.pubkey ?? '')) return null;
  const p = req.tags.find((t) => t[0] === 'p')?.[1];
  if (p !== recipient || tag('p') !== recipient) return null;
  const msats = bolt11Msats(tag('bolt11'));
  if (!msats) return null;
  const asked = Number(req.tags.find((t) => t[0] === 'amount')?.[1]);
  if (Number.isFinite(asked) && asked !== msats) return null;
  return { sats: Math.floor(msats / 1000), from: req.pubkey, comment: String(req.content ?? '').slice(0, 500), eventId: tag('e') ?? null };
}

export const formatSats = (n) => new Intl.NumberFormat('fr-FR').format(n);
