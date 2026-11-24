import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, addInteraction, targetsOf, compact } from '../js/nostr/stats.js';

const H = (c) => c.repeat(64);
const T = H('a'), ME = H('b'), OTHER = H('c');
const ev = (o) => ({ id: H('d'), pubkey: OTHER, kind: 1, content: '', tags: [], created_at: 1, sig: 'x', ...o });

test('réactions : compte, ignore les doublons et le « - »', () => {
  const s = emptyStats();
  assert.ok(addInteraction(s, ev({ id: H('1'), kind: 7, content: '+', tags: [['e', T]] }), T, ME));
  assert.ok(!addInteraction(s, ev({ id: H('1'), kind: 7, content: '+', tags: [['e', T]] }), T, ME));
  assert.ok(!addInteraction(s, ev({ id: H('2'), kind: 7, content: '-', tags: [['e', T]] }), T, ME));
  assert.equal(s.reactions, 1); assert.equal(s.reacted, false);
  addInteraction(s, ev({ id: H('3'), pubkey: ME, kind: 7, content: '+', tags: [['e', T]] }), T, ME);
  assert.equal(s.reactions, 2); assert.equal(s.reacted, true);
});
test('reposts kind 6 et 16', () => {
  const s = emptyStats();
  addInteraction(s, ev({ id: H('4'), kind: 6, tags: [['e', T]] }), T);
  addInteraction(s, ev({ id: H('5'), kind: 16, tags: [['e', T]] }), T);
  assert.equal(s.reposts, 2);
});
test('réponses : seulement le parent direct ; citations via la balise q', () => {
  const s = emptyStats();
  addInteraction(s, ev({ id: H('6'), tags: [['e', T, '', 'reply']] }), T);
  addInteraction(s, ev({ id: H('7'), tags: [['e', H('9'), '', 'root'], ['e', H('8'), '', 'reply']] }), T);   // réponse à une autre note
  addInteraction(s, ev({ id: H('e'), tags: [['q', T]] }), T);
  assert.deepEqual([s.replies, s.quotes], [1, 1]);
});
test('événements sans rapport ou mal formés', () => {
  const s = emptyStats();
  assert.ok(!addInteraction(s, ev({ id: H('f'), kind: 7, tags: [['e', 'zz']] }), T));
  assert.ok(!addInteraction(s, ev({ id: H('0'), kind: 9, tags: [['e', T]] }), T));
  assert.deepEqual(targetsOf(ev({ tags: [['e', T], ['q', OTHER], ['e', 'x'], ['p', T]] })), [T, OTHER]);
});
test('compact', () => { assert.equal(compact(0), ''); assert.equal(compact(42), '42'); assert.match(compact(1234), /1,2/); });
