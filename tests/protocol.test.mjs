import test from 'node:test';
import assert from 'node:assert/strict';
import * as n19 from '../js/nostr/nip19.js';
import { parseIdentifier, resolveNip05 } from '../js/nostr/nip05.js';

const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
const HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
const NPROFILE = 'nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p';

test('npub : vecteur NIP-19 dans les deux sens', () => {
  assert.deepEqual(n19.decode(NPUB), { type: 'npub', data: HEX });
  assert.equal(n19.npubEncode(HEX), NPUB);
  assert.equal(n19.decode(NPUB.toUpperCase()).data, HEX);
});
test('nprofile : vecteur NIP-19', () => {
  assert.deepEqual(n19.decode(NPROFILE).data, {
    pubkey: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
    relays: ['wss://r.x.com', 'wss://djbas.sadkb.com'] });
});
test('nprofile : aller-retour', () => {
  const d = { pubkey: HEX, relays: ['wss://relay.example.com'] };
  assert.deepEqual(n19.decode(n19.nprofileEncode(d)).data, d);
});
test('note : aller-retour', () => {
  assert.deepEqual(n19.decode(n19.noteEncode(HEX)), { type: 'note', data: HEX });
});
test('nsec et ncryptsec sont refusées', () => {
  for (const s of [NSEC, NSEC.toUpperCase(), 'ncryptsec1abc', 'nsec1invalide']) {
    assert.throws(() => n19.decode(s), (e) => e.code === 'private-key');
  }
});
test('entrées invalides rejetées', () => {
  const bad = [NPUB.slice(0, -1) + 'q', NPUB.replace('npub1', 'Npub1'), 'npub1abc', '', 'hello', 'note1' + NPUB.slice(5)];
  for (const s of bad) assert.throws(() => n19.decode(s), (e) => e.code === 'invalid', s);
});
test('NIP-05 : analyse des identifiants', () => {
  assert.deepEqual(parseIdentifier('Alice@Example.com'), { name: 'alice', domain: 'example.com' });
  assert.deepEqual(parseIdentifier('example.com'), { name: '_', domain: 'example.com' });
  for (const s of ['', 'a@b', 'a b@x.com', 'a@x.com/evil', 'a@b@c.com', 'a@x.com:8080']) assert.equal(parseIdentifier(s), null, s);
});
test('NIP-05 : résolution', async () => {
  const body = { names: { alice: HEX }, relays: { [HEX]: ['wss://r.example', 'http://mauvais'] } };
  const ok = async () => ({ ok: true, json: async () => body });
  assert.deepEqual(await resolveNip05('alice@example.com', { fetchFn: ok }), { pubkey: HEX, relays: ['wss://r.example'], name: 'alice', domain: 'example.com' });
  await assert.rejects(resolveNip05('bob@example.com', { fetchFn: ok }));
  await assert.rejects(resolveNip05('__proto__@example.com', { fetchFn: ok }));
  await assert.rejects(resolveNip05('alice@example.com', { fetchFn: async () => ({ ok: false }) }));
});
