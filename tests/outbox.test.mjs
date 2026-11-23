import test from 'node:test';
import assert from 'node:assert/strict';
import { planOutbox, writeRelaysOf, chunkAuthors } from '../js/nostr/outbox.js';

const pk = (n) => String(n).repeat(64).slice(0, 64);
const R = (n) => `wss://r${n}.example.com`;

test('outbox : couverture gloutonne, relais populaires d\'abord, 2 relais par compte', () => {
  const w = new Map([[pk(1), [R(1), R(2)]], [pk(2), [R(1), R(3)]], [pk(3), [R(1), R(4)]], [pk(4), [R(5)]]]);
  const { byRelay, fallback } = planOutbox([pk(1), pk(2), pk(3), pk(4)], w);
  assert.deepEqual(byRelay.get(R(1)), [pk(1), pk(2), pk(3)]);
  assert.deepEqual(byRelay.get(R(5)), [pk(4)]);
  assert.ok(byRelay.has(R(2)) && byRelay.has(R(3)) && byRelay.has(R(4)));
  assert.deepEqual(fallback, []);
});
test('outbox : comptes sans liste → repli ; plafond de relais respecté', () => {
  const w = new Map([[pk(1), [R(1)]], [pk(2), [R(2)]], [pk(3), [R(3)]]]);
  const { byRelay, fallback } = planOutbox([pk(1), pk(2), pk(3), pk(4)], w, { maxRelays: 2 });
  assert.equal(byRelay.size, 2);
  assert.equal(fallback.length, 2);           // pk(4) sans liste + un compte dont le relais n'a pas été retenu
  assert.ok(fallback.includes(pk(4)));
});
test('outbox : à égalité, les relais du compte sont préférés ; chaque compte reste couvert', () => {
  const w = new Map([[pk(1), [R(1), R(2)]]]);
  const { byRelay } = planOutbox([pk(1)], w, { mine: [R(2)], perAuthor: 1 });
  assert.deepEqual([...byRelay.keys()], [R(2)]);
});
test('writeRelaysOf et chunkAuthors', () => {
  const ev = { kind: 10002, tags: [['r', R(1)], ['r', R(2), 'read'], ['r', R(3), 'write']] };
  assert.deepEqual(writeRelaysOf(ev), [R(1), R(3)]);
  assert.deepEqual(writeRelaysOf(null), []);
  assert.deepEqual(chunkAuthors([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
