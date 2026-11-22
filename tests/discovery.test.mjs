import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverAccount } from '../js/relays/discovery.js';
import { buildLists, loadAccountLists, resetAccount } from '../js/account.js';
import { state } from '../js/state.js';

const PK = 'a'.repeat(64);
let n = 0;
const mk = (kind, tags, created_at, o = {}) => ({ id: (++n).toString(16).padStart(64, '0'), pubkey: PK, kind, tags, content: '', created_at, sig: 'f'.repeat(128), ...o });
const tick = () => new Promise((r) => setImmediate(r));

// Faux WebSocket : le comportement dépend de l'adresse
function makeWS(behaviors) {
  const log = { opened: [], maxOpen: 0, open: 0, closed: 0 };
  class WS {
    constructor(url) {
      this.url = url; log.opened.push(url); log.open++; log.maxOpen = Math.max(log.maxOpen, log.open);
      this.closedFlag = false;
      setImmediate(() => {
        const b = behaviors[url] ?? { events: [] };
        if (b.fail) { this.close(); return; }
        if (b.silent) return;
        this.onopen?.();
      });
    }
    send(raw) {
      const [, id] = JSON.parse(raw);
      const b = behaviors[this.url] ?? { events: [] };
      setImmediate(() => {
        if (b.closed) return this.onmessage?.({ data: JSON.stringify(['CLOSED', id, 'auth-required']) });
        for (const e of b.events ?? []) this.onmessage?.({ data: JSON.stringify(['EVENT', id, e]) });
        this.onmessage?.({ data: JSON.stringify(['EOSE', id]) });
      });
    }
    close() { if (this.closedFlag) return; this.closedFlag = true; log.open--; log.closed++; this.onclose?.(); }
  }
  return { WS, log };
}
const boot = ['wss://b1.example.com', 'wss://b2.example.com', 'wss://b3.example.com'];
const verify = async (e) => !e.sig.startsWith('dead');
const fast = { connectTimeout: 100, fetchTimeout: 100 };

test('découverte : la version la plus récente gagne, deuxième vague sur les relais de la liste', async () => {
  const old10002 = mk(10002, [['r', 'wss://old.example.com']], 100);
  const new10002 = mk(10002, [['r', 'wss://b1.example.com'], ['r', 'wss://mine.example.com', 'write']], 200);
  const dm = mk(10050, [['relay', 'wss://dm.example.com']], 50);
  const { WS, log } = makeWS({
    'wss://b1.example.com': { events: [old10002] },
    'wss://b2.example.com': { events: [new10002, mk(0, [], 10, { content: '{}' })] },
    'wss://b3.example.com': { fail: true },
    'wss://mine.example.com': { events: [dm] },
  });
  const progress = [];
  const r = await discoverAccount(PK, { boot, verify, WS, onProgress: (p) => progress.push(p), ...fast });
  assert.equal(r.events[10002].id, new10002.id);
  assert.equal(r.events[10050].id, dm.id);
  assert.equal(r.events[10007], null);
  assert.equal(r.responded, 3);                       // b1, b2, mine
  assert.equal(r.total, 4);
  assert.ok(log.opened.includes('wss://mine.example.com'));
  assert.ok(!log.opened.includes('wss://b1.example.com') || log.opened.filter((u) => u === 'wss://b1.example.com').length === 1, 'relais déjà interrogé non réinterrogé');
  assert.equal(log.open, 0, 'toutes les connexions temporaires sont fermées');
  assert.deepEqual(progress.at(-1), { done: 4, total: 4 });
});
test('découverte : signature invalide écartée au profit de la version valide précédente', async () => {
  const good = mk(10002, [['r', 'wss://g.example.com']], 100);
  const bad = mk(10002, [['r', 'wss://evil.example.com']], 900, { sig: 'dead' + 'f'.repeat(124) });
  const { WS } = makeWS({ 'wss://b1.example.com': { events: [bad, good] } });
  const r = await discoverAccount(PK, { boot: ['wss://b1.example.com'], verify, WS, ...fast });
  assert.equal(r.events[10002].id, good.id);
});
test('découverte : événements d\'un autre compte ou d\'un autre type ignorés', async () => {
  const other = mk(10002, [['r', 'wss://x.example.com']], 500, { pubkey: 'b'.repeat(64) });
  const wrongKind = mk(1, [], 500);
  const { WS } = makeWS({ 'wss://b1.example.com': { events: [other, wrongKind] } });
  const r = await discoverAccount(PK, { boot: ['wss://b1.example.com'], verify, WS, ...fast });
  assert.equal(r.events[10002], null);
});
test('découverte : au plus 8 connexions simultanées, adresses dangereuses ignorées', async () => {
  const urls = Array.from({ length: 20 }, (_, i) => `wss://r${i}.example.com`);
  const { WS, log } = makeWS({});
  await discoverAccount(PK, { boot: [...urls, 'wss://localhost', 'ws://x.example.com'], verify, WS, ...fast });
  assert.ok(log.maxOpen <= 8, `max ${log.maxOpen}`);
  assert.equal(log.opened.length, 20);
});
test('découverte : relais muet, relais qui refuse, tous en échec', async () => {
  const good = mk(10002, [['r', 'wss://g.example.com']], 100);
  const a = makeWS({ 'wss://b1.example.com': { silent: true }, 'wss://b2.example.com': { closed: true }, 'wss://b3.example.com': { events: [good] } });
  const r = await discoverAccount(PK, { boot, verify, WS: a.WS, ...fast, connectTimeout: 50 });
  assert.equal(r.responded, 2);                       // b3 + g (deuxième vague, sans réponse utile mais connecté)
  assert.equal(r.events[10002].id, good.id);
  const b = makeWS({ 'wss://b1.example.com': { fail: true }, 'wss://b2.example.com': { fail: true }, 'wss://b3.example.com': { silent: true } });
  await assert.rejects(discoverAccount(PK, { boot, verify, WS: b.WS, ...fast, connectTimeout: 50 }), /RELAY_LOAD_FAILED/);
});

// ---- orchestration (cache et pool simulés)
const memCache = (init = {}) => { const m = { ...init }; return { get: async (k) => m[k] ?? null, put: (e) => { m[e.kind] = e; }, m }; };
const found = (events) => async () => ({ events: { 0: null, 10002: null, 10007: null, 10050: null, ...events }, responded: 3, total: 3 });

test('compte : cache d\'abord, puis la version la plus récente trouvée est appliquée', async () => {
  const cached = mk(10002, [['r', 'wss://cache.example.com']], 100);
  const newer = mk(10002, [['r', 'wss://new.example.com', 'read']], 200);
  const cache = memCache({ 10002: cached });
  const applied = [];
  const statuses = [];
  const off = state.on('lists', (l) => statuses.push(`${l.status}:${l.pub?.relays[0]?.url}`));
  await loadAccountLists(PK, { force: true, discover: found({ 10002: newer }), cache, apply: (r) => applied.push(r) });
  off();
  assert.deepEqual(statuses, ['ready:wss://cache.example.com', 'ready:wss://new.example.com']);
  assert.deepEqual(applied.at(-1), [{ url: 'wss://new.example.com', read: true, write: false }]);
  assert.equal(cache.m[10002].id, newer.id);
  assert.equal(state.get('lists').pub.created_at, 200);
});
test('compte : une version trouvée plus ancienne que le cache ne le remplace pas', async () => {
  const cached = mk(10002, [['r', 'wss://cache.example.com']], 300);
  const older = mk(10002, [['r', 'wss://old.example.com']], 100);
  await loadAccountLists(PK, { force: true, discover: found({ 10002: older }), cache: memCache({ 10002: cached }), apply: () => {} });
  assert.equal(state.get('lists').pub.relays[0].url, 'wss://cache.example.com');
});
test('compte : aucune liste → empty ; échec réseau → error ; échec avec cache → on garde le cache', async () => {
  const noop = () => {};
  await loadAccountLists(PK, { force: true, discover: found({}), cache: memCache(), apply: noop });
  assert.equal(state.get('lists').status, 'empty');
  await loadAccountLists(PK, { force: true, discover: async () => { throw new Error('RELAY_LOAD_FAILED'); }, cache: memCache(), apply: noop });
  assert.equal(state.get('lists').status, 'error');
  const cached = mk(10002, [['r', 'wss://cache.example.com']], 100);
  await loadAccountLists(PK, { force: true, discover: async () => { throw new Error('x'); }, cache: memCache({ 10002: cached }), apply: noop });
  assert.equal(state.get('lists').status, 'ready');
  assert.equal(state.get('listsProgress').running, false);
});
test('compte : résultat périmé ignoré après changement de compte ou déconnexion', async () => {
  let release;
  const slow = () => new Promise((r) => { release = () => r({ events: { 0: null, 10002: mk(10002, [['r', 'wss://late.example.com']], 1), 10007: null, 10050: null }, responded: 1, total: 1 }); });
  const applied = [];
  const p = loadAccountLists(PK, { force: true, discover: slow, cache: memCache(), apply: (r) => applied.push(r) });
  await tick();
  resetAccount({ apply: (r) => applied.push(r) });
  release();
  await p;
  assert.equal(state.get('lists').status, 'idle');
  assert.deepEqual(applied.at(-1), []);
});
test('compte : pas de nouvelle découverte avant 6 h si le cache est frais', async () => {
  const cached = mk(10002, [['r', 'wss://cache.example.com']], 100);
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let calls = 0;
  const discover = async () => { calls++; return found({})(); };
  const opts = { discover, cache: memCache({ 10002: cached }), apply: () => {} };
  await loadAccountLists(PK, { ...opts, force: true });
  await loadAccountLists(PK, opts);
  assert.equal(calls, 1);
  await loadAccountLists(PK, { ...opts, now: () => Date.now() + 7 * 3600 * 1000 });
  assert.equal(calls, 2);
  delete globalThis.localStorage;
});
