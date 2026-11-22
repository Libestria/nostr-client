import test from 'node:test';
import assert from 'node:assert/strict';
import { relaysFromEvent, latestEvent, MAX_LIST_RELAYS } from '../js/nostr/relaylists.js';

const ev = (kind, tags, o = {}) => ({ id: '1'.padStart(64, '0'), pubkey: 'a'.repeat(64), kind, tags, created_at: 100, content: '', sig: 'f'.repeat(128), ...o });

test('10002 : marqueurs read / write / les deux, doublons fusionnés', () => {
  const e = ev(10002, [['r', 'wss://a.example.com'], ['r', 'wss://b.example.com', 'read'], ['r', 'wss://c.example.com', 'write'],
    ['r', 'wss://c.example.com', 'read'], ['r', 'wss://A.example.com/']]);
  assert.deepEqual(relaysFromEvent(e, 'pub'), [
    { url: 'wss://a.example.com', read: true, write: true },
    { url: 'wss://b.example.com', read: true, write: false },
    { url: 'wss://c.example.com', read: true, write: true }]);
});
test('10002 : adresses dangereuses ou mal formées écartées, mauvais type ignoré', () => {
  const e = ev(10002, [['r', 'wss://localhost'], ['r', 'ws://x.example.com'], ['r', 'wss://192.168.1.2'], ['r'], ['relay', 'wss://ok.example.com'], 'bidon', ['r', 'wss://ok.example.com']]);
  assert.deepEqual(relaysFromEvent(e, 'pub').map((r) => r.url), ['wss://ok.example.com']);
  assert.deepEqual(relaysFromEvent(ev(1, [['r', 'wss://ok.example.com']]), 'pub'), []);
  assert.deepEqual(relaysFromEvent(null, 'pub'), []);
});
test('10007 et 10050 : balises relay, sans rôle', () => {
  assert.deepEqual(relaysFromEvent(ev(10007, [['relay', 'wss://s.example.com'], ['r', 'wss://x.example.com']]), 'search'), [{ url: 'wss://s.example.com', read: true, write: true }]);
  assert.equal(relaysFromEvent(ev(10050, [['relay', 'wss://d.example.com']]), 'dm').length, 1);
  assert.deepEqual(relaysFromEvent(ev(10050, [['relay', 'wss://d.example.com']]), 'search'), []);
});
test('liste hostile : plafonnée', () => {
  const tags = Array.from({ length: 200 }, (_, i) => ['r', `wss://r${i}.example.com`]);
  assert.equal(relaysFromEvent(ev(10002, tags), 'pub').length, MAX_LIST_RELAYS);
});
test('latestEvent : plus récent, puis id le plus bas', () => {
  const a = ev(10002, [], { id: 'b'.padStart(64, '0'), created_at: 5 });
  const b = ev(10002, [], { id: 'a'.padStart(64, '0'), created_at: 5 });
  const c = ev(10002, [], { id: 'c'.padStart(64, '0'), created_at: 3 });
  assert.equal(latestEvent([a, c, b], 10002), b);
  assert.equal(latestEvent([ev(1, [])], 10002), null);
  assert.equal(latestEvent([], 10002), null);
});
