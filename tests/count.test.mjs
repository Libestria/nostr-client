import test from 'node:test';
import assert from 'node:assert/strict';
import { middle } from '../js/ui/fit.js';
import { Relay } from '../js/relays/relay.js';
import { Pool } from '../js/relays/pool.js';

test('middle : texte court inchangé, texte long raccourci au milieu', () => {
  assert.equal(middle('abcdef', 10), 'abcdef');
  const out = middle('npub1' + 'x'.repeat(58), 20);
  assert.equal(out.length, 20);
  assert.ok(out.startsWith('npub1') && out.includes('…'));
  assert.equal(middle('abcdefghij', 2), '…');
});

const fakeRelay = (url = 'wss://a.example') => {
  const r = new Relay(url, { onChange() {}, onEvent() {}, onClosed() {}, sign: () => null });
  r.state = 'open'; r.sent = [];
  r._send = (m) => r.sent.push(m);
  return r;
};

test('Relay.count : réponse COUNT (NIP-45)', async () => {
  const r = fakeRelay();
  const p = r.count([{ kinds: [3], '#p': ['a'.repeat(64)] }], 500);
  const [verb, id] = r.sent[0];
  assert.equal(verb, 'COUNT');
  r._onMessage(JSON.stringify(['COUNT', id, { count: 1234 }]));
  assert.equal(await p, 1234);
});
test('Relay.count : refus (CLOSED), valeur invalide, relais fermé, délai', async () => {
  let r = fakeRelay();
  let p = r.count([{}], 500);
  r._onMessage(JSON.stringify(['CLOSED', r.sent[0][1], 'unsupported']));
  assert.equal(await p, null);
  r = fakeRelay(); p = r.count([{}], 500);
  r._onMessage(JSON.stringify(['COUNT', r.sent[0][1], { count: -3 }]));
  assert.equal(await p, null);
  r = fakeRelay(); r.state = 'closed';
  assert.equal(await r.count([{}], 500), null);
  r = fakeRelay();
  assert.equal(await r.count([{}], 20), null);
});

test('Pool.count : plus grande valeur, relais sans NIP-45 ignorés', async () => {
  const pool = new Pool({ verify: async () => true });
  const mk = (url, n, nips) => { const r = fakeRelay(url); r.read = true; r.scope = 'account'; r.info = nips ? { nips } : null; r.count = async () => n; pool.relays.set(url, r); };
  mk('wss://a.example', 40, [1, 45]); mk('wss://b.example', 1500, [1, 45]); mk('wss://c.example', 99999, [1, 11]); mk('wss://d.example', null, null);
  assert.equal(await pool.count([{ kinds: [3] }]), 1500);
  const empty = new Pool({ verify: async () => true });
  assert.equal(await empty.count([{ kinds: [3] }]), null);
});
