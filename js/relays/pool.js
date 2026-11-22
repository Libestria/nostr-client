// Pool de relais : abonnements groupés, déduplication, vérification de chaque événement.
import { Relay } from './relay.js';
import { Subscription } from './subscription.js';
import { normalizeRelayUrl } from '../nostr/relayurl.js';
import { isValidShape, isTooFarInFuture, eventKey, matchesAny } from '../nostr/events.js';

const VERIFIED_MAX = 5000;
const LIMIT_DEFAULT = 100;
const LIMIT_MAX = 500;
const MAX_IN_FLIGHT = 300;
let counter = 0;

export class Pool {
  constructor({ verify } = {}) {
    this.verify = verify ?? ((ev) => import('../nostr/verifier.js').then((m) => m.verifyEvent(ev)));
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
    };
  }

  setRelays(list) {
    const wanted = new Map();
    for (const r of Array.isArray(list) ? list : []) {
      const url = normalizeRelayUrl(r?.url);
      if (url) wanted.set(url, { read: r.read !== false, write: r.write !== false });
    }
    for (const [url, relay] of this.relays) {
      if (!wanted.has(url)) { this._detachAll(relay); relay.close(); this.relays.delete(url); }
    }
    for (const [url, flags] of wanted) {
      let relay = this.relays.get(url);
      const isNew = !relay;
      if (isNew) { relay = new Relay(url, this.hooks); this.relays.set(url, relay); }
      const hadRead = !isNew && relay.read;
      Object.assign(relay, flags);
      if (relay.read && !hadRead) this._attachAll(relay);
      if (!relay.read && hadRead) this._detachAll(relay);
      if (relay.read || relay.write) relay.connect();
    }
    this._emit();
  }

  subscribe(filters, { closeOnEose = false, onevent, oneose, maxEvents } = {}) {
    const list = (Array.isArray(filters) ? filters : [filters]).slice(0, 10).map((f) => ({
      ...f, limit: Math.min(Number.isInteger(f.limit) && f.limit > 0 ? f.limit : LIMIT_DEFAULT, LIMIT_MAX) }));
    const sub = new Subscription({
      id: `s${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      filters: list, closeOnEose, onevent, oneose, maxEvents, onClose: (s) => this._remove(s) });
    this.subs.set(sub.id, sub);
    for (const relay of this.relays.values()) if (relay.read) { relay.addSub(sub); sub.attach(relay.url); }
    return sub;
  }

  status() {
    return [...this.relays.values()].map((r) => ({
      url: r.url, state: r.state, latency: r.latency, error: r.error, notice: r.notice,
      read: r.read, write: r.write, name: r.info?.name, events: r.stats.events, invalid: r.stats.invalid, dropped: r.stats.dropped, subs: r.active.size }));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // Publie sur les relais d'écriture connectés : [{ url, ok, message }]
  publish(event) {
    const targets = [...this.relays.values()].filter((r) => r.write && r.state === 'open');
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
    if (!isValidShape(ev) || isTooFarInFuture(ev) || !matchesAny(ev, sub.filters)) { relay.stats.invalid++; return; }
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
