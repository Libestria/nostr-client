import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRelayUrl } from '../js/nostr/relayurl.js';
import { isValidShape, isTooFarInFuture, matchesFilter, replaceKey } from '../js/nostr/events.js';

const ev = (o = {}) => ({ id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1700000000, kind: 1, tags: [], content: 'x', sig: 'c'.repeat(128), ...o });

test('relayurl : adresses acceptées et normalisées', () => {
  assert.equal(normalizeRelayUrl('wss://Relay.Example.com/'), 'wss://relay.example.com');
  assert.equal(normalizeRelayUrl(' wss://nos.lol '), 'wss://nos.lol');
  assert.equal(normalizeRelayUrl('wss://relay.example.com/path/'), 'wss://relay.example.com/path');
});
test('relayurl : adresses refusées', () => {
  for (const u of ['ws://relay.example.com', 'https://x.com', 'wss://localhost', 'wss://127.0.0.1', 'wss://192.168.1.5', 'wss://10.0.0.1',
    'wss://172.16.0.1', 'wss://169.254.1.1', 'wss://[::1]', 'wss://box.local', 'wss://intranet', 'wss://user:pw@x.com', 'wss://x.com/#a', '', 'nimportequoi'])
    assert.equal(normalizeRelayUrl(u), null, u);
  assert.equal(normalizeRelayUrl('wss://8.8.8.8'), 'wss://8.8.8.8');
});
test('events : structure', () => {
  assert.equal(isValidShape(ev()), true);
  for (const bad of [null, [], ev({ id: 'zz' }), ev({ sig: 'c'.repeat(64) }), ev({ kind: -1 }), ev({ kind: 1.5 }), ev({ created_at: '1' }),
    ev({ content: 5 }), ev({ tags: 'x' }), ev({ tags: [['e', 1]] }), ev({ tags: [{}] }), ev({ pubkey: 'B'.repeat(64) })])
    assert.equal(isValidShape(bad), false);
});
test('events : dates futures', () => {
  const now = 1700000000;
  assert.equal(isTooFarInFuture(ev({ created_at: now + 100 }), now), false);
  assert.equal(isTooFarInFuture(ev({ created_at: now + 1000 }), now), true);
});
test('events : filtres', () => {
  const e = ev({ tags: [['e', 'f'.repeat(64)]] });
  assert.equal(matchesFilter(e, { kinds: [1] }), true);
  assert.equal(matchesFilter(e, { kinds: [7] }), false);
  assert.equal(matchesFilter(e, { authors: ['bbbb'] }), true);
  assert.equal(matchesFilter(e, { since: 1700000001 }), false);
  assert.equal(matchesFilter(e, { until: 1699999999 }), false);
  assert.equal(matchesFilter(e, { '#e': ['f'.repeat(64)] }), true);
  assert.equal(matchesFilter(e, { '#e': ['0'.repeat(64)] }), false);
});
test('events : clés de remplacement', () => {
  assert.equal(replaceKey(ev({ kind: 1 })), null);
  assert.equal(replaceKey(ev({ kind: 0 })), `0:${'b'.repeat(64)}:`);
  assert.equal(replaceKey(ev({ kind: 30023, tags: [['d', 'slug']] })), `30023:${'b'.repeat(64)}:slug`);
});
