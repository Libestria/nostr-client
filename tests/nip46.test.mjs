import test from 'node:test';
import assert from 'node:assert/strict';
import { connectBunker, startNostrConnect, restoreBunker, cleanRelays, Nip46Error, PERMS } from '../js/nostr/nip46.js';

const B = 'b'.repeat(64), U = 'a'.repeat(64);
const key = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);

function fakeLib({ bp, userPubkey = U, connect = async () => {}, signed, uriWait } = {}) {
  const calls = { closed: 0, fromBunker: null, uri: null };
  const signer = {
    bp: { pubkey: B }, connect, getPublicKey: async () => userPubkey,
    signEvent: async (tpl) => signed ?? { ...tpl, pubkey: userPubkey, id: '1', sig: '2' },
    close: async () => { calls.closed++; },
  };
  return { calls, signer, lib: {
    generateSecretKey: key, getPublicKey: () => 'c'.repeat(64),
    nip46: {
      parseBunkerInput: async () => bp,
      createNostrConnectURI: (p) => { calls.uri = p; return `nostrconnect://${p.clientPubkey}?relay=x`; },
      BunkerSigner: {
        fromBunker: (k, b, p) => { calls.fromBunker = { k, b, p }; return signer; },
        fromURI: async (k, uri, p, max) => (uriWait ? uriWait(signer) : signer),
      },
    } } };
}

test('cleanRelays : refuse le réseau local, dédoublonne, plafonne', () => {
  const r = cleanRelays(['wss://a.example.com', 'wss://a.example.com/', 'wss://localhost', 'ws://b.example.com', 'wss://192.168.0.2', 'wss://c.example.com', 'wss://d.example.com', 'wss://e.example.com', 'wss://f.example.com']);
  assert.deepEqual(r, ['wss://a.example.com', 'wss://c.example.com', 'wss://d.example.com', 'wss://e.example.com']);
});
test('connectBunker : succès, relais filtrés, clé de transport sérialisée', async () => {
  const { lib, calls } = fakeLib({ bp: { pubkey: B, relays: ['wss://r.example.com', 'wss://localhost'], secret: 's' } });
  const s = await connectBunker('bunker://x', { lib });
  assert.equal(s.pubkey, U);
  assert.deepEqual(calls.fromBunker.b.relays, ['wss://r.example.com']);
  assert.equal(s.saved.bunker.pubkey, B);
  assert.match(s.saved.clientKey, /^[0-9a-f]{64}$/);
  const ev = await s.signEvent({ kind: 1, created_at: 1, tags: [], content: 'x' });
  assert.equal(ev.pubkey, U);
});
test('connectBunker : entrées refusées', async () => {
  const ok = { pubkey: B, relays: ['wss://r.example.com'] };
  await assert.rejects(connectBunker('nsec1abc', { lib: fakeLib({ bp: ok }).lib }), (e) => e.code === 'invalid');
  await assert.rejects(connectBunker('x', { lib: fakeLib({ bp: null }).lib }), (e) => e.code === 'invalid');
  await assert.rejects(connectBunker('x', { lib: fakeLib({ bp: { pubkey: 'zz', relays: ['wss://r.example.com'] } }).lib }), (e) => e.code === 'invalid');
  await assert.rejects(connectBunker('x', { lib: fakeLib({ bp: { pubkey: B, relays: ['wss://127.0.0.1'] } }).lib }), (e) => e.code === 'no-relays');
  await assert.rejects(connectBunker('x', { lib: {} }), (e) => e.code === 'unsupported');
});
test('connectBunker : échec et mauvaise clé publique ferment le signeur', async () => {
  const bp = { pubkey: B, relays: ['wss://r.example.com'] };
  const a = fakeLib({ bp, connect: async () => { throw new Error('refusé'); } });
  await assert.rejects(connectBunker('x', { lib: a.lib }), (e) => e.code === 'failed');
  assert.equal(a.calls.closed, 1);
  const b = fakeLib({ bp, userPubkey: 'pas-hex' });
  await assert.rejects(connectBunker('x', { lib: b.lib }), (e) => e.code === 'failed');
  assert.equal(b.calls.closed, 1);
});
test('connectBunker : délai dépassé', async () => {
  const { lib, calls } = fakeLib({ bp: { pubkey: B, relays: ['wss://r.example.com'] }, connect: () => new Promise(() => {}) });
  await assert.rejects(connectBunker('x', { lib, timeout: 20 }), (e) => e.code === 'timeout');
  assert.equal(calls.closed, 1);
});
test('signature : un événement altéré par le signeur est refusé', async () => {
  const bp = { pubkey: B, relays: ['wss://r.example.com'] };
  const tpl = { kind: 3, created_at: 1, tags: [['p', B]], content: '' };
  const s = await connectBunker('x', { lib: fakeLib({ bp, signed: { ...tpl, tags: [], pubkey: U, id: '1', sig: '2' } }).lib });
  await assert.rejects(s.signEvent(tpl), (e) => e.code === 'failed');
});
test('nostrconnect : lien, permissions, attente puis succès', async () => {
  const { lib, calls } = fakeLib();
  const nc = await startNostrConnect({ relays: ['wss://r.example.com', 'wss://localhost'], name: 'Test', url: 'https://x.org', lib });
  assert.match(nc.uri, /^nostrconnect:\/\//);
  assert.deepEqual(calls.uri.relays, ['wss://r.example.com']);
  assert.deepEqual(calls.uri.perms, PERMS);
  assert.match(calls.uri.secret, /^[0-9a-f]{32}$/);
  assert.equal((await nc.wait()).pubkey, U);
});
test('nostrconnect : annulation, le signeur arrivé trop tard est fermé', async () => {
  let release;
  const { lib, calls } = fakeLib({ uriWait: (signer) => new Promise((r) => { release = () => r(signer); }) });
  const nc = await startNostrConnect({ relays: ['wss://r.example.com'], lib });
  nc.cancel(); release();
  await assert.rejects(nc.wait(), (e) => e.code === 'cancelled');
  assert.equal(calls.closed, 1);
});
test('nostrconnect : sans relais utilisable', async () => {
  await assert.rejects(startNostrConnect({ relays: ['wss://localhost'], lib: fakeLib().lib }), (e) => e.code === 'no-relays');
});
test('restoreBunker : reprise locale sans connexion, données invalides refusées', async () => {
  const { lib, calls } = fakeLib();
  const saved = { pubkey: U, clientKey: '1'.repeat(64), bunker: { pubkey: B, relays: ['wss://r.example.com'] } };
  const s = await restoreBunker(saved, { lib });
  assert.equal(s.pubkey, U);
  assert.equal(calls.fromBunker.b.secret, null);
  await assert.rejects(restoreBunker({ ...saved, clientKey: 'zz' }, { lib }), (e) => e.code === 'invalid');
  await assert.rejects(restoreBunker({ ...saved, bunker: { pubkey: B, relays: ['wss://localhost'] } }, { lib }), (e) => e.code === 'invalid');
});
