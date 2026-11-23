import test from 'node:test';
import assert from 'node:assert/strict';
import { resilientCaller, restoreBunker, Nip46Error } from '../js/nostr/nip46.js';

class FakeDoc extends EventTarget {
  visibilityState = 'visible';
  set(v) { this.visibilityState = v; this.dispatchEvent(new Event('visibilitychange')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('appel normal : réponse directe, aucune reconstruction', async () => {
  const doc = new FakeDoc();
  let refreshed = 0;
  const call = resilientCaller({ get: () => 'S', refresh: async () => { refreshed++; }, env: { document: doc }, retryDelay: 20 });
  assert.equal(await call(async (s) => `ok-${s}`), 'ok-S');
  assert.equal(refreshed, 0);
});

test('iOS : page masquée puis de retour sans réponse → connexion reconstruite, demande renvoyée, réponse reçue', async () => {
  const doc = new FakeDoc();
  let current = 'ancienne', refreshed = 0;
  const call = resilientCaller({ get: () => current, refresh: async () => { refreshed++; current = 'neuve'; }, env: { document: doc }, retryDelay: 20, timeout: 2000 });
  const p = call((s) => (s === 'ancienne' ? new Promise(() => {}) : Promise.resolve('signé')));  // l'ancienne connexion est morte
  doc.set('hidden'); await wait(5); doc.set('visible');
  assert.equal(await p, 'signé');
  assert.equal(refreshed, 1);
});

test('iOS : la première réponse arrive quand même après le retour → pas de renvoi inutile', async () => {
  const doc = new FakeDoc();
  let refreshed = 0;
  const call = resilientCaller({ get: () => 'S', refresh: async () => { refreshed++; }, env: { document: doc }, retryDelay: 200 });
  const p = call(() => new Promise((r) => setTimeout(() => r('rep'), 30)));
  doc.set('hidden'); doc.set('visible');
  assert.equal(await p, 'rep');
  await wait(250);
  assert.equal(refreshed, 0);
});

test('échec : l\'erreur remonte ; délai dépassé = timeout', async () => {
  const doc = new FakeDoc();
  const call = resilientCaller({ get: () => 'S', refresh: async () => {}, env: { document: doc }, timeout: 30 });
  await assert.rejects(call(() => Promise.reject(new Error('refusé'))), /refusé/);
  await assert.rejects(call(() => new Promise(() => {})), (e) => e.code === 'timeout');
});

test('NIP-46 : chiffrement exposé seulement si la bibliothèque le fournit, avec reprise', async () => {
  const H = (c) => c.repeat(64);
  const calls = [];
  const mk = (tag) => ({ signEvent: async () => ({}), nip44Encrypt: async (pk, t) => { calls.push([tag, 'enc', pk, t]); return `c(${t})`; }, nip44Decrypt: async (pk, c) => `d(${c})`, close: async () => {} });
  const lib = { nip46: { BunkerSigner: { fromBunker: () => mk('x') } }, generateSecretKey: () => new Uint8Array(32) };
  const saved = { pubkey: H('a'), clientKey: H('b'), bunker: { pubkey: H('c'), relays: ['wss://r.example.com'] } };
  const s = await restoreBunker(saved, { lib });
  assert.equal(await s.nip44.encrypt(H('d'), 'salut'), 'c(salut)');
  assert.equal(await s.nip44.decrypt(H('d'), 'xyz'), 'd(xyz)');
  assert.equal(s.nip04, null, 'pas de NIP-04 si la bibliothèque ne le fournit pas');
  const lib2 = { ...lib, nip46: { BunkerSigner: { fromBunker: () => ({ signEvent: async () => ({}) }) } } };
  assert.equal((await restoreBunker(saved, { lib: lib2 })).nip44, null);
  await assert.rejects(restoreBunker({ ...saved, clientKey: 'nop' }, { lib }), (e) => e instanceof Nip46Error);
});
