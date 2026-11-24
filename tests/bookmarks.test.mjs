import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBookmarks, bookmarksTemplate } from '../js/nostr/bookmarks.js';

const H = (c) => c.repeat(64);
const prev = { kind: 10003, created_at: 100, content: 'chiffré-autre-client', tags: [['e', H('1')], ['a', '30023:x:y'], ['e', H('2')], ['t', 'nostr']] };

test('parse : plus récent d\'abord, sans doublon ni valeur invalide', () => {
  assert.deepEqual(parseBookmarks({ ...prev, tags: [...prev.tags, ['e', H('1')], ['e', 'zz']] }), [H('2'), H('1')]);
  assert.deepEqual(parseBookmarks({ kind: 1, tags: [['e', H('1')]] }), []);
  assert.deepEqual(parseBookmarks(null), []);
});
test('ajout : conserve les autres balises et le contenu', () => {
  const t = bookmarksTemplate(prev, { type: 'add', id: H('3') }, 200);
  assert.equal(t.kind, 10003); assert.equal(t.content, 'chiffré-autre-client');
  assert.deepEqual(t.tags.at(-1), ['e', H('3')]);
  assert.ok(t.tags.some((x) => x[0] === 'a') && t.tags.some((x) => x[0] === 't'));
  assert.equal(t.created_at, 200);
});
test('retrait et created_at strictement croissant', () => {
  const t = bookmarksTemplate(prev, { type: 'remove', id: H('1') }, 50);
  assert.ok(!t.tags.some((x) => x[1] === H('1')));
  assert.equal(t.created_at, 101);
});
test('erreurs', () => {
  assert.throws(() => bookmarksTemplate(prev, { type: 'add', id: H('1') }), /NO_CHANGE/);
  assert.throws(() => bookmarksTemplate(prev, { type: 'remove', id: H('9') }), /NO_CHANGE/);
  assert.throws(() => bookmarksTemplate(prev, { type: 'add', id: 'xyz' }), /INVALID_VALUE/);
  assert.throws(() => bookmarksTemplate(prev, { type: 'zzz', id: H('1') }), /INVALID_VALUE/);
  const full = { tags: Array.from({ length: 500 }, (_, i) => ['e', i.toString(16).padStart(64, '0')]) };
  assert.throws(() => bookmarksTemplate(full, { type: 'add', id: H('f') }), /MAX/);
});
test('sans liste existante', () => {
  const t = bookmarksTemplate(null, { type: 'add', id: H('1') }, 10);
  assert.deepEqual(t.tags, [['e', H('1')]]); assert.equal(t.content, '');
});
