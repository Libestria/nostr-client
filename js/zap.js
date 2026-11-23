// Zaps (NIP-57) côté réseau : résolution LNURL, demande de zap signée par le signeur, facture, paiement WebLN,
// et totaux de reçus (kind 9735) vérifiés. Aucune clé de portefeuille n'est manipulée ici.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getSigner } from './auth.js';
import { getCached, requestProfile, onProfiles } from './profiles.js';
import { ZapError, lnurlpUrl, parseLnurlPay, buildZapRequest, callbackUrl, checkInvoice, checkReceipt } from './nostr/nip57.js';

const TIMEOUT = 10000;
const MAX_BODY = 50000;
const infoCache = new Map();   // lud16 → { at, info }
const TTL = 10 * 60 * 1000;

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { accept: 'application/json' } });
    if (!res.ok) throw new ZapError('LNURL_UNREACHABLE');
    const text = await res.text();
    if (text.length > MAX_BODY) throw new ZapError('LNURL_INVALID');
    try { return JSON.parse(text); } catch { throw new ZapError('LNURL_INVALID'); }
  } catch (e) {
    throw e instanceof ZapError ? e : new ZapError('LNURL_UNREACHABLE');
  } finally { clearTimeout(timer); }
}

// Informations LNURL-pay d'une adresse Lightning (mises en cache 10 min).
export async function lnurlInfo(lud16) {
  const url = lnurlpUrl(lud16);
  if (!url) throw new ZapError('NO_LNURL');
  const hit = infoCache.get(lud16);
  if (hit && Date.now() - hit.at < TTL) { if (hit.error) throw hit.error; return hit.info; }
  try {
    const info = parseLnurlPay(await getJson(url), lud16);
    infoCache.set(lud16, { at: Date.now(), info });
    return info;
  } catch (e) {
    if (e instanceof ZapError && e.code !== 'LNURL_UNREACHABLE') infoCache.set(lud16, { at: Date.now(), error: e });
    throw e;
  }
}

const readRelays = () => (state.get('lists')?.pub?.relays ?? []).filter((r) => r.read !== false).map((r) => r.url).slice(0, 5);

// Crée la facture. → { pr, request }. Erreurs : NO_SIGNER, SIGN_FAILED, + ZapError.
export async function createInvoice({ recipient, lud16, event, amountSats, comment = '' }) {
  const signer = getSigner();
  if (!signer) throw new Error('NO_SIGNER');
  const info = await lnurlInfo(lud16);
  const tpl = buildZapRequest({ recipient, eventId: event?.id, kind: event?.kind, amountSats, comment: info.commentAllowed ? comment : '', relays: readRelays(), lnurl: info.lnurl });
  callbackUrl(info, amountSats, tpl, tpl.content);   // contrôle précoce : bornes et longueur du commentaire, avant toute signature
  let request;
  try { request = await signer.signEvent(tpl); } catch { throw new Error('SIGN_FAILED'); }
  if (!request || request.kind !== 9734 || request.pubkey !== signer.pubkey) throw new Error('SIGN_FAILED');
  const res = await getJson(callbackUrl(info, amountSats, request, tpl.content));
  if (res?.status === 'ERROR') { const e = new ZapError('PROVIDER_ERROR'); e.reason = String(res.reason ?? '').slice(0, 200); throw e; }
  return { pr: checkInvoice(res?.pr, amountSats), request };
}

export const hasWebln = () => typeof window !== 'undefined' && !!window.webln;

// Paiement via WebLN (extension Alby, etc.). Erreurs : NO_WEBLN, PAY_FAILED
export async function payWebln(pr) {
  if (!hasWebln()) throw new Error('NO_WEBLN');
  try {
    await window.webln.enable();
    return await window.webln.sendPayment(pr);
  } catch { throw new Error('PAY_FAILED'); }
}

// ---- Totaux de zaps par note (reçus vérifiés)
const totals = new Map();       // eventId → { sats, count, receipts:Set }
const watchers = new Map();     // eventId → Set(callbacks)
const targets = new Map();      // eventId → pubkey du destinataire
let timer = null;
const emit = (id) => { const t = totals.get(id); if (t) for (const cb of watchers.get(id) ?? []) cb({ sats: t.sats, count: t.count }); };

async function nostrPubkeyOf(pubkey) {
  let lud16 = getCached(pubkey)?.lud16;
  if (!lud16) {
    requestProfile(pubkey);
    lud16 = await new Promise((resolve) => {
      const done = (v) => { stop(); clearTimeout(to); resolve(v); };
      const stop = onProfiles(() => { const v = getCached(pubkey)?.lud16; if (v) done(v); });
      const to = setTimeout(() => done(null), 6000);
    });
  }
  if (!lud16) return null;
  try { return (await lnurlInfo(lud16)).nostrPubkey; } catch { return null; }
}

async function flush() {
  timer = null;
  const ids = [...targets.keys()].filter((id) => !totals.get(id)?.loaded);
  if (!ids.length) return;
  const batch = ids.slice(0, 80);
  const receipts = [];
  await new Promise((resolve) => {
    const sub = pool.subscribe([{ kinds: [9735], '#e': batch, limit: 500 }], {
      closeOnEose: true, maxEvents: 500, onevent: (ev) => receipts.push(ev), oneose: resolve });
    setTimeout(() => { sub?.close?.(); resolve(); }, 8000);
  });
  const providers = new Map();   // destinataire → nostrPubkey
  for (const id of batch) {
    const recipient = targets.get(id);
    if (!providers.has(recipient)) providers.set(recipient, await nostrPubkeyOf(recipient));
    const np = providers.get(recipient);
    const total = totals.get(id) ?? { sats: 0, count: 0, receipts: new Set() };
    if (np) for (const r of receipts) {
      if (total.receipts.has(r.id) || !r.tags.some((t) => t[0] === 'e' && t[1] === id)) continue;
      const ok = checkReceipt(r, { recipient, nostrPubkey: np });
      if (ok && ok.eventId === id) { total.receipts.add(r.id); total.sats += ok.sats; total.count++; }
    }
    total.loaded = true;
    totals.set(id, total);
    emit(id);
  }
  if ([...targets.keys()].some((id) => !totals.get(id)?.loaded)) timer ||= setTimeout(flush, 100);
}

// Suit les zaps d'une note : cb({ sats, count }) à chaque mise à jour (regroupe les requêtes).
export function watchZaps(event, cb) {
  if (!event?.id) return;
  targets.set(event.id, event.pubkey);
  if (!watchers.has(event.id)) watchers.set(event.id, new Set());
  watchers.get(event.id).add(cb);
  if (totals.get(event.id)?.loaded) { emit(event.id); return; }
  timer ||= setTimeout(flush, 500);
}

// Après un paiement : réinterroger les reçus de cette note.
export function refreshZaps(eventId) {
  const t = totals.get(eventId);
  if (t) t.loaded = false;
  timer ||= setTimeout(flush, 4000);
}
