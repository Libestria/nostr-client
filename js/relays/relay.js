// Une connexion WebSocket vers un relais : reconnexion (backoff exponentiel),
// limite d'abonnements simultanés, plafond d'événements entrants par seconde.
const MAX_EVENTS_PER_SEC = 500;
const MAX_MESSAGE_CHARS = 1_000_000;
const BACKOFF_MAX_MS = 60_000;

export class Relay {
  constructor(url, hooks) {
    this.url = url;
    this.hooks = hooks;           // { onChange(), onEvent(relay, sub, event), onClosed(relay, sub, msg) }
    this.read = true;
    this.write = true;
    this.state = 'idle';          // idle | connecting | open | retrying | closed
    this.latency = null;
    this.error = null;
    this.notice = null;
    this.info = undefined;        // NIP-11 (null si indisponible)
    this.stats = { events: 0, invalid: 0, dropped: 0 };
    this.maxSubs = 8;
    this.authChallenge = null;    // NIP-42 : traité au jalon réseau
    this.subs = new Map();
    this.pendingOk = new Map();   // id d'événement → callback (accusé OK du relais)
    this.active = new Set();
    this.ws = null;
    this.timer = null;
    this.attempt = 0;
    this.wanted = false;
    this.win = { t: 0, n: 0 };
  }

  connect() {
    this.wanted = true;
    if (!this.ws && !this.timer) this._open();
  }

  close() {
    this.wanted = false;
    clearTimeout(this.timer);
    this.timer = null;
    this._failPending('closed');
    const ws = this.ws;
    this.ws = null;
    this.active.clear();
    try { ws?.close(); } catch { /* déjà fermé */ }
    this._set('closed');
  }

  reconnectNow() {
    if (!this.wanted || this.ws) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.attempt = 0;
    this._open();
  }

  addSub(sub) { this.subs.set(sub.id, sub); this._pump(); }

  removeSub(id) {
    if (this.active.has(id)) this._send(['CLOSE', id]);
    this.active.delete(id);
    this.subs.delete(id);
    this._pump();
  }

  _set(state) { this.state = state; this.hooks.onChange(); }

  _open() {
    this.timer = null;
    this._set('connecting');
    const t0 = performance.now();
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.error = 'url'; this._set('retrying'); return this._retry(); }
    this.ws = ws;
    ws.onopen = () => {
      this.latency = Math.round(performance.now() - t0);
      this.attempt = 0;
      this.error = null;
      this.active.clear();
      this._set('open');
      this._fetchInfo();
      this._pump();
    };
    ws.onmessage = (m) => this._onMessage(m.data);
    ws.onerror = () => { this.error = 'connexion'; };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.active.clear();
      this._failPending('closed');
      if (this.wanted) { this._set('retrying'); this._retry(); } else this._set('closed');
    };
  }

  _retry() {
    if (!this.wanted) return;
    const delay = Math.min(BACKOFF_MAX_MS, 1000 * 2 ** this.attempt) * (0.5 + Math.random() / 2);
    this.attempt++;
    this.timer = setTimeout(() => this._open(), delay);
    this.timer?.unref?.();
  }

  // Publication : résout { url, ok, message } à la réception du OK du relais (ou après un délai).
  publish(event, timeout = 8000) {
    return new Promise((resolve) => {
      if (this.state !== 'open') return resolve({ url: this.url, ok: false, message: 'not-connected' });
      const timer = setTimeout(() => { this.pendingOk.delete(event.id); resolve({ url: this.url, ok: false, message: 'timeout' }); }, timeout);
      timer?.unref?.();
      this.pendingOk.set(event.id, (ok, message) => { clearTimeout(timer); resolve({ url: this.url, ok, message }); });
      this._send(['EVENT', event]);
    });
  }

  _failPending(message) {
    for (const [id, cb] of this.pendingOk) { this.pendingOk.delete(id); cb(false, message); }
  }

  _send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  _pump() {
    if (this.state !== 'open') return;
    for (const sub of this.subs.values()) {
      if (this.active.size >= this.maxSubs) break;
      if (!this.active.has(sub.id)) {
        this._send(['REQ', sub.id, ...sub.filters]);
        this.active.add(sub.id);
      }
    }
  }

  _onMessage(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) { this.stats.dropped++; return; }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg)) return;
    switch (msg[0]) {
      case 'EVENT': {
        const now = Date.now();
        if (now - this.win.t > 1000) this.win = { t: now, n: 0 };
        if (++this.win.n > MAX_EVENTS_PER_SEC) { this.stats.dropped++; return; }
        const sub = this.subs.get(msg[1]);
        if (sub) this.hooks.onEvent(this, sub, msg[2]);
        break;
      }
      case 'EOSE': this.subs.get(msg[1])?.markEose(this.url); break;
      case 'CLOSED': {
        const sub = this.subs.get(msg[1]);
        this.active.delete(msg[1]);
        this.notice = String(msg[2] ?? '').slice(0, 200);
        if (sub) this.hooks.onClosed?.(this, sub, this.notice);
        this.hooks.onChange();
        break;
      }
      case 'OK': {
        const cb = this.pendingOk.get(msg[1]);
        if (cb) { this.pendingOk.delete(msg[1]); cb(msg[2] === true, String(msg[3] ?? '').slice(0, 200)); }
        break;
      }
      case 'NOTICE': this.notice = String(msg[1] ?? '').slice(0, 200); this.hooks.onChange(); break;
      case 'AUTH': this.authChallenge = typeof msg[1] === 'string' ? msg[1] : null; break;
      default: break;
    }
  }

  async _fetchInfo() {
    if (this.info !== undefined) return;
    this.info = null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await fetch(this.url.replace(/^wss:/, 'https:'), {
        headers: { Accept: 'application/nostr+json' }, credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
      if (!res.ok) return;
      const j = await res.json();
      const s = (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined);
      this.info = { name: s(j.name), description: s(j.description), software: s(j.software) };
      const ms = j?.limitation?.max_subscriptions;
      if (Number.isInteger(ms) && ms > 0) { this.maxSubs = Math.min(10, ms); this._pump(); }
      this.hooks.onChange();
    } catch { /* infos facultatives */ } finally { clearTimeout(timer); }
  }
}
