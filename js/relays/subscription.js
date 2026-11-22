// Un abonnement (REQ) partagé entre plusieurs relais. Les doublons sont filtrés par abonnement.
export class Subscription {
  constructor({ id, filters, closeOnEose = false, onevent, oneose, onClose, eoseTimeout = 8000, maxEvents = 1000 }) {
    Object.assign(this, { id, filters, closeOnEose, onevent, oneose, onClose, maxEvents });
    this.count = 0;
    this.seen = new Set();
    this.relays = new Set();
    this.eosed = new Set();
    this.closed = false;
    this.eoseFired = false;
    this.timer = setTimeout(() => this._fireEose(), eoseTimeout);
    this.timer?.unref?.();
  }
  attach(url) { this.relays.add(url); }
  detach(url) { this.relays.delete(url); this.eosed.delete(url); this._check(); }
  markEose(url) { if (this.relays.has(url)) { this.eosed.add(url); this._check(); } }
  _check() { if (this.relays.size > 0 && this.eosed.size >= this.relays.size) this._fireEose(); }
  _fireEose() {
    if (this.eoseFired || this.closed) return;
    this.eoseFired = true;
    clearTimeout(this.timer);
    this.oneose?.();
    if (this.closeOnEose) this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.onClose?.(this);
  }
}
