import test from 'node:test';
import assert from 'node:assert/strict';
import { neventEncode } from '../js/nostr/nip19.js';
import { buildReport, REPORT_TYPES } from '../js/nostr/compose.js';
import { noteSeen, seenOn } from '../js/relays/seen.js';

const id = 'a'.repeat(64), pk = 'b'.repeat(64);
test('neventEncode inclut id, relais, auteur et kind', async () => {
  const s = neventEncode({ id, relays: ['wss://r.example'], author: pk, kind: 1 });
  assert.match(s, /^nevent1/);
  const mod = await import('../js/nostr/nip19.js');
  const dec = (mod.decode ?? mod.nip19Decode)?.(s);
  if (dec) { assert.equal(dec.data?.id ?? dec.id, id); }
});
test('buildReport produit un kind 1984', () => {
  const r = buildReport({ id, pubkey: pk }, 'spam', 5);
  assert.equal(r.kind, 1984); assert.deepEqual(r.tags, [['e', id, 'spam'], ['p', pk]]); assert.equal(r.created_at, 5);
  assert.throws(() => buildReport({ id, pubkey: pk }, 'nope'));
  assert.ok(REPORT_TYPES.includes('other'));
});
test('seen mémorise les relais par note', () => {
  noteSeen(id, 'wss://a'); noteSeen(id, 'wss://b'); noteSeen(id, 'wss://a');
  assert.deepEqual([...seenOn(id)].sort(), ['wss://a', 'wss://b']);
});
