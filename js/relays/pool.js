// Pool de relais : abonnements groupés, déduplication, vérification de chaque événement.
import { Relay } from './relay.js';
import { Subscription } from './subscription.js';
import { normalizeRelayUrl } from '../nostr/relayurl.js';
import { isValidShape, isTooFarInFuture, eventKey, matchesAny } from '../nostr/events.js';
import { noteSeen } from './seen.js';

const VERIFIED_MAX = 5000;
const LIMIT_DEFAULT = 100;
const LIMIT_MAX = 500;
const MAX_IN_FLIGHT = 300;
const MAX_OUTBOX_RELAYS = 24;      // connexions temporaires vers les relais des comptes suivis
const OUTBOX_GRACE_MS = 20000;     // un relais temporaire reste ouvert un moment après son dernier abonnement
let counter = 0;

export class Pool {
  constructor({ verify } = {}) {
    this.verify = verify ?? ((ev) => import('../nostr/verifier.js').then((m) => m.verifyEvent(ev)));
    this.signer = null;               // (modèle d'événement) → événement signé ou null, pour NIP-42
    this.onVerified = null;           // appelé une fois par événement vérifié (cache)
    this.relays = new Map();
    this.subs = new Map();
    this.listeners = new Set();
    this.verified = new Set();
    this.inFlight = 0;
    this.emitTimer = null;
    this.hooks = {
      onChange: () => this._emit(),
      onEvent: (relay, sub, ev) => this._onEvent(relay, sub, ev),
      onClosed: (relay, sub) => sub.markEose(relay.url),
      sign: (tpl) => (this.signer ? this.signer(tpl) : null),
    };
  }

  // Relais du compte : { url, read, write, dm }. Les relais « dm » restent connectés en arrière-plan
  // mais ne reçoivent que les abonnements de messagerie (scope « dm »).
  setRelays(list) {
    const wanted = new Map();
    for (const r of Array.isArray(list) ? list : []) {
      const url = normalizeRelayUrl(r?.url);
      if (!url) continue;
      const cur = wanted.get(url);
      const flags = { read: r.read === true || (r.read !== false && r.dm !== true), write: r.write === true || (r.write !== false && r.dm !== true), dm: r.dm === true };
      wanted.set(url, cur ? { read: cur.read || flags.read, write: cur.write || flags.write, dm: cur.dm || flags.dm } : flags);
    }
    for (const [url, relay] of [...this.relays]) {
      if (relay.scope === 'account' && !wanted.has(url)) { this._detachAll(relay); relay.close(); this.relays.delete(url); }
    }
    for (const [url, flags] of wanted) {
      let relay = this.relays.get(url);
      if (!relay) { relay = new Relay(url, this.hooks); this.relays.set(url, relay); }
      relay.scope = 'account';
      Object.assign(relay, flags);
      this._sync(relay);
      relay.connect();
    }
    this._emit();
  }

  // Relais temporaires pour le modèle outbox : lecture seule, fermés peu après leur dernier abonnement.
  _ensureOutbox(urls) {
    for (const raw of urls) {
      const url = normalizeRelayUrl(raw);
      if (!url || this.relays.has(url)) continue;
      if ([...this.relays.values()].filter((r) => r.scope === 'outbox').length >= MAX_OUTBOX_RELAYS) break;
      const relay = new Relay(url, this.hooks);
      relay.scope = 'outbox'; relay.read = true; relay.write = false;
      this.relays.set(url, relay);
      relay.connect();
    }
  }

  _gcOutbox() {
    setTimeout(() => {
      for (const [url, relay] of [...this.relays]) {
        if (relay.scope === 'outbox' && relay.subs.size === 0) { relay.close(); this.relays.delete(url); }
      }
      this._emit();
    }, OUTBOX_GRACE_MS).unref?.();
  }

  // Un abonnement doit-il être envoyé à ce relais ?
  _wants(relay, sub) {
    if (sub.relayFilters) return sub.relayFilters.has(relay.url);
    if (sub.scope === 'dm') return relay.dm;
    return relay.read && relay.scope === 'account';
  }

  _sync(relay) {
    for (const s of this.subs.values()) {
      const want = this._wants(relay, s), has = s.relays.has(relay.url);
      if (want && !has) { relay.addSub(s); s.attach(relay.url); }
      else if (!want && has) { relay.removeSub(s.id); s.detach(relay.url); }
    }
  }

  // scope : 'general' (relais de lecture du compte) | 'dm' (relais de messagerie).
  // relayFilters : Map(url → filtres) pour le modèle outbox ; seuls ces relais reçoivent la demande.
  subscribe(filters, { closeOnEose = false, onevent, oneose, maxEvents, scope = 'general', relayFilters = null } = {}) {
    const clean = (arr) => (Array.isArray(arr) ? arr : [arr]).slice(0, 10).map((f) => ({
      ...f, limit: Math.min(Number.isInteger(f.limit) && f.limit > 0 ? f.limit : LIMIT_DEFAULT, LIMIT_MAX) }));
    const list = clean(filters);
    let perRelay = null;
    if (relayFilters) {
      perRelay = new Map();
      for (const [url, f] of relayFilters) { const u = normalizeRelayUrl(url); if (u && f?.length) perRelay.set(u, clean(f)); }
      this._ensureOutbox([...perRelay.keys()]);
      for (const url of [...perRelay.keys()]) if (!this.relays.has(url)) perRelay.delete(url); // plafond atteint
    }
    const sub = new Subscription({
      id: `s${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      filters: list, closeOnEose, onevent, oneose, maxEvents, scope, relayFilters: perRelay, onClose: (s) => this._remove(s) });
    this.subs.set(sub.id, sub);
    for (const relay of this.relays.values()) if (this._wants(relay, sub)) { relay.addSub(sub); sub.attach(relay.url); }
    return sub;
  }

  status() {
    return [...this.relays.values()].map((r) => ({
      url: r.url, state: r.state, latency: r.latency, error: r.error, notice: r.notice,
      read: r.read, write: r.write, dm: r.dm, scope: r.scope, authenticated: r.authenticated, name: r.info?.name, events: r.stats.events, invalid: r.stats.invalid, dropped: r.stats.dropped, subs: r.active.size }));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // Publie sur les relais d'écriture connectés : [{ url, ok, message }]
  publish(event) {
    const targets = [...this.relays.values()].filter((r) => r.write && r.scope === 'account' && r.state === 'open');
    return Promise.all(targets.map((r) => r.publish(event)));
  }

  // Publie sur les relais de messagerie du compte (connectés en arrière-plan) : [{ url, ok, message }]
  publishDm(event) {
    const targets = [...this.relays.values()].filter((r) => r.dm && r.scope === 'account' && r.state === 'open');
    return Promise.all(targets.map((r) => r.publish(event)));
  }

  reconnectAll() { for (const r of this.relays.values()) r.reconnectNow(); }
  closeAll() {
    for (const s of [...this.subs.values()]) s.close();
    for (const r of this.relays.values()) r.close();
    this.relays.clear();
  }

  _attachAll(relay) { for (const s of this.subs.values()) { relay.addSub(s); s.attach(relay.url); } }
  _detachAll(relay) { for (const s of this.subs.values()) { relay.removeSub(s.id); s.detach(relay.url); } }
  _remove(sub) {
    this.subs.delete(sub.id);
    for (const r of this.relays.values()) r.removeSub(sub.id);
    if (sub.relayFilters) this._gcOutbox();
  }

  _emit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.listeners.forEach((fn) => fn()); }, 100);
    this.emitTimer?.unref?.();
  }

  _remember(key) {
    this.verified.add(key);
    if (this.verified.size > VERIFIED_MAX) this.verified.delete(this.verified.values().next().value);
  }

  _onEvent(relay, sub, ev) {
    relay.stats.events++;
    if (!isValidShape(ev) || isTooFarInFuture(ev) || !matchesAny(ev, sub.relayFilters?.get(relay.url) ?? sub.filters)) { relay.stats.invalid++; return; }
    noteSeen(ev.id, relay.url);   // « reçue de » : tous les relais qui livrent l'événement, même doublons
    const key = eventKey(ev);
    if (sub.seen.has(key)) return;
    sub.seen.add(key);
    const deliver = () => {
      if (sub.closed) return;
      sub.onevent?.(ev, relay.url);
      if (++sub.count >= sub.maxEvents) sub.close(); // soupape : un abonnement ne reçoit jamais indéfiniment
    };
    if (this.verified.has(key)) return deliver();
    if (this.inFlight >= MAX_IN_FLIGHT) { relay.stats.dropped++; sub.seen.delete(key); return; } // file de vérification saturée
    this.inFlight++;
    sub.pending++;
    Promise.resolve(this.verify(ev)).then((ok) => {
      if (!ok) { relay.stats.invalid++; this._emit(); return; }
      if (!this.verified.has(key)) { this._remember(key); try { this.onVerified?.(ev); } catch { /* cache facultatif */ } }
      deliver();
    }).catch(() => { relay.stats.invalid++; }).finally(() => { this.inFlight--; sub.pending--; sub.settle(); });
  }
}

export const pool = new Pool();
