import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

class MockWS {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; MockWS.all.push(this); }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}
globalThis.WebSocket = MockWS;
globalThis.fetch = async () => { throw new Error('hors ligne'); };
const { Pool } = await import('../js/relays/pool.js');

const now = () => Math.floor(Date.now() / 1000);
const ev = (n, o = {}) => ({ id: n.toString(16).padStart(64, '0'), pubkey: 'b'.repeat(64), created_at: now(), kind: 1, tags: [], content: 'x', sig: 'c'.repeat(128), ...o });
const tick = () => new Promise((r) => setImmediate(r));
const verify = async (e) => !e.sig.startsWith('dead');

function setup(urls = ['wss://r1.example.com', 'wss://r2.example.com']) {
  MockWS.all.length = 0;
  const pool = new Pool({ verify });
  pool.setRelays(urls.map((url) => ({ url, read: true, write: true })));
  MockWS.all.forEach((w) => w.open());
  return { pool, ws: MockWS.all };
}

test('doublon reçu de deux relais : livré une seule fois', async () => {
  const { pool, ws } = setup();
  const got = [];
  const sub = pool.subscribe([{ kinds: [1] }], { onevent: (e) => got.push(e.id) });
  const id = ws[0].sent[0][1];
  ws[0].recv(['EVENT', id, ev(1)]);
  ws[1].recv(['EVENT', id, ev(1)]);
  await tick();
  assert.equal(got.length, 1);
  sub.close(); pool.closeAll();
});

test('signature invalide rejetée, sans empoisonner la vraie copie', async () => {
  const { pool, ws } = setup(['wss://r1.example.com']);
  const got = [];
  const sub = pool.subscribe([{ kinds: [1] }], { onevent: (e) => got.push(e.sig.slice(0, 4)) });
  const id = ws[0].sent[0][1];
  ws[0].recv(['EVENT', id, ev(2, { sig: 'dead' + 'c'.repeat(124) })]);
  ws[0].recv(['EVENT', id, ev(2)]);
  await tick();
  assert.deepEqual(got, ['cccc']);
  assert.equal(pool.status()[0].invalid, 1);
  sub.close(); pool.closeAll();
});

test('événements hors filtre, futurs ou mal formés rejetés', async () => {
  const { pool, ws } = setup(['wss://r1.example.com']);
  const got = [];
  const sub = pool.subscribe([{ kinds: [1] }], { onevent: (e) => got.push(e.id) });
  const id = ws[0].sent[0][1];
  ws[0].recv(['EVENT', id, ev(3, { kind: 7 })]);
  ws[0].recv(['EVENT', id, ev(4, { created_at: now() + 5000 })]);
  ws[0].recv(['EVENT', id, { n: 'importe quoi' }]);
  ws[0].recv(['EVENT', 'inconnu', ev(5)]);
  await tick();
  assert.equal(got.length, 0);
  assert.equal(pool.status()[0].invalid, 3);
  sub.close(); pool.closeAll();
});

test('limite d\'abonnements par relais : file d\'attente', () => {
  const { pool, ws } = setup(['wss://r1.example.com']);
  pool.relays.get('wss://r1.example.com').maxSubs = 2;
  const subs = [1, 2, 3].map(() => pool.subscribe([{ kinds: [1] }], {}));
  const reqs = () => ws[0].sent.filter((m) => m[0] === 'REQ').length;
  assert.equal(reqs(), 2);
  subs[0].close();
  assert.equal(reqs(), 3);
  assert.ok(ws[0].sent.some((m) => m[0] === 'CLOSE'));
  subs.forEach((s) => s.close()); pool.closeAll();
});

test('limit imposé et plafonné', () => {
  const { pool, ws } = setup(['wss://r1.example.com']);
  const a = pool.subscribe([{ kinds: [1] }], {});
  const b = pool.subscribe([{ kinds: [1], limit: 99999 }], {});
  const reqs = ws[0].sent.filter((m) => m[0] === 'REQ');
  assert.equal(reqs[0][2].limit, 100);
  assert.equal(reqs[1][2].limit, 500);
  a.close(); b.close(); pool.closeAll();
});

test('closeOnEose : CLOSE envoyé après EOSE de tous les relais', () => {
  const { pool, ws } = setup();
  let eose = 0;
  const sub = pool.subscribe([{ kinds: [1] }], { closeOnEose: true, oneose: () => eose++ });
  const id = ws[0].sent[0][1];
  ws[0].recv(['EOSE', id]);
  assert.equal(eose, 0);
  ws[1].recv(['EOSE', id]);
  assert.equal(eose, 1);
  assert.equal(sub.closed, true);
  assert.ok(ws[0].sent.some((m) => m[0] === 'CLOSE' && m[1] === id));
  pool.closeAll();
});

test('reconnexion avec backoff exponentiel', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { pool, ws } = setup(['wss://r1.example.com']);
    ws[0].drop();
    assert.equal(pool.status()[0].state, 'retrying');
    mock.timers.tick(1000);               // 1re tentative : 0,5 à 1 s
    assert.equal(MockWS.all.length, 2);
    MockWS.all[1].drop();                 // échec sans ouverture : délai 1 à 2 s
    mock.timers.tick(999);
    assert.equal(MockWS.all.length, 2);
    mock.timers.tick(1001);
    assert.equal(MockWS.all.length, 3);
    pool.closeAll();
  } finally { mock.timers.reset(); }
});

test('abonnement rejoué après reconnexion', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { pool, ws } = setup(['wss://r1.example.com']);
    const sub = pool.subscribe([{ kinds: [1] }], {});
    ws[0].drop();
    mock.timers.tick(1000);
    MockWS.all[1].open();
    assert.equal(MockWS.all[1].sent.filter((m) => m[0] === 'REQ').length, 1);
    sub.close(); pool.closeAll();
  } finally { mock.timers.reset(); }
});

test('adresses de relais dangereuses ignorées par le pool', () => {
  const { pool } = setup(['wss://127.0.0.1', 'wss://ok.example.com', 'ws://x.example.com']);
  assert.deepEqual(pool.status().map((r) => r.url), ['wss://ok.example.com']);
  pool.closeAll();
});

test('soupape : un abonnement se ferme après maxEvents événements', async () => {
  const { pool, ws } = setup(['wss://r1.example.com']);
  const got = [];
  const sub = pool.subscribe([{ kinds: [1] }], { maxEvents: 3, onevent: (e) => got.push(e.id) });
  const id = ws[0].sent[0][1];
  for (let i = 10; i < 20; i++) ws[0].recv(['EVENT', id, ev(i)]);
  await tick();
  assert.equal(got.length, 3);
  assert.equal(sub.closed, true);
  assert.ok(ws[0].sent.some((m) => m[0] === 'CLOSE' && m[1] === id));
  pool.closeAll();
});

test('file de vérification saturée : les surplus sont écartés', async () => {
  MockWS.all.length = 0;
  const pool = new Pool({ verify: () => new Promise(() => {}) }); // vérification jamais terminée
  pool.setRelays([{ url: 'wss://r1.example.com' }]);
  MockWS.all[0].open();
  const sub = pool.subscribe([{ kinds: [1] }], { maxEvents: 5000 });
  const id = MockWS.all[0].sent[0][1];
  for (let i = 100; i < 450; i++) MockWS.all[0].recv(['EVENT', id, ev(i)]);
  assert.equal(pool.inFlight, 300);
  assert.equal(pool.status()[0].dropped, 50);
  sub.close(); pool.closeAll();
});

test('publication : OK accepté, refusé, délai et fermeture', async () => {
  const { pool, ws } = setup(['wss://r1.example.com', 'wss://r2.example.com']);
  const e = ev(900);
  const p = pool.publish(e);
  assert.deepEqual(ws[0].sent.at(-1), ['EVENT', e]);
  ws[0].recv(['OK', e.id, true, '']);
  ws[1].recv(['OK', e.id, false, 'blocked: spam']);
  const res = await p;
  assert.deepEqual(res.map((r) => [r.ok, r.message]), [[true, ''], [false, 'blocked: spam']]);
  const e2 = ev(901);
  const p2 = pool.publish(e2);
  ws[0].drop(); ws[1].drop();
  assert.deepEqual((await p2).map((r) => r.message), ['closed', 'closed']);
  pool.closeAll();
});
test('publication : relais non connectés ou en lecture seule ignorés', async () => {
  MockWS.all.length = 0;
  const pool = new Pool({ verify });
  pool.setRelays([{ url: 'wss://r1.example.com', read: true, write: false }, { url: 'wss://r2.example.com', read: true, write: true }]);
  MockWS.all[0].open();                 // r2 reste en connexion
  assert.deepEqual(await pool.publish(ev(902)), []);
  pool.closeAll();
});

test('closeOnEose : les événements en cours de vérification sont livrés avant la fermeture', async () => {
  MockWS.all.length = 0;
  const slow = (e) => new Promise((r) => setTimeout(() => r(true), 20));
  const pool = new Pool({ verify: slow });
  pool.setRelays([{ url: 'wss://r1.example.com' }]);
  MockWS.all[0].open();
  const got = []; let eose = 0;
  const sub = pool.subscribe([{ kinds: [1] }], { closeOnEose: true, onevent: (e) => got.push(e.id), oneose: () => eose++ });
  const id = MockWS.all[0].sent[0][1];
  MockWS.all[0].recv(['EVENT', id, ev(700)]);
  MockWS.all[0].recv(['EVENT', id, ev(701)]);
  MockWS.all[0].recv(['EOSE', id]);          // arrive avant la fin des vérifications
  assert.equal(sub.closed, false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(got.length, 2);
  assert.equal(eose, 1);
  assert.equal(sub.closed, true);
  pool.closeAll();
});
