import test from 'node:test';
import assert from 'node:assert/strict';
import { listTemplate, tagUrls, MAX_LIST_RELAYS } from '../js/nostr/relaylists.js';
import { state } from '../js/state.js';
import { editList, resetAccount, applyListEvent } from '../js/account.js';
import { publishToMany } from '../js/relays/oneshot.js';

const ev = (kind, tags, o = {}) => ({ id: '1'.padStart(64, '0'), pubkey: 'a'.repeat(64), kind, tags, created_at: 100, content: 'x', sig: 'f'.repeat(128), ...o });
const A = 'wss://a.example.com', B = 'wss://b.example.com', C = 'wss://c.example.com';

test('ajout : balise rôle, created_at après la version précédente, contenu conservé', () => {
  const base = ev(10002, [['r', A], ['title', 'garde-moi']], { created_at: 5000 });
  const t = listTemplate('pub', base, { type: 'add', url: 'WSS://B.example.com/', read: true, write: false }, 10);
  assert.deepEqual(t.tags, [['r', A], ['title', 'garde-moi'], ['r', B, 'read']]);
  assert.equal(t.created_at, 5001);
  assert.equal(t.content, 'x');
  assert.equal(t.kind, 10002);
});
test('ajout dans 10007 / 10050 : balise relay, sans rôle', () => {
  assert.deepEqual(listTemplate('dm', null, { type: 'add', url: A }, 10).tags, [['relay', A]]);
  assert.deepEqual(listTemplate('search', ev(10007, []), { type: 'add', url: A, read: false }, 10).tags, [['relay', A]]);
});
test('retrait : toutes les balises du relais, le reste intact ; dernier relais général protégé', () => {
  const base = ev(10002, [['r', A], ['r', B], ['r', B, 'write'], ['d', 'z'], ['r', 'ws://mauvais']]);
  assert.deepEqual(listTemplate('pub', base, { type: 'remove', url: B }, 1).tags, [['r', A], ['d', 'z'], ['r', 'ws://mauvais']]);
  assert.throws(() => listTemplate('pub', ev(10002, [['r', A]]), { type: 'remove', url: A }), /LAST/);
  assert.deepEqual(listTemplate('dm', ev(10050, [['relay', A]]), { type: 'remove', url: A }).tags, []);
  assert.throws(() => listTemplate('pub', base, { type: 'remove', url: C }), /NOT_FOUND/);
});
test('rôle : remplace la balise, refuse « ni lecture ni écriture »', () => {
  const base = ev(10002, [['r', A], ['r', B]]);
  assert.deepEqual(listTemplate('pub', base, { type: 'role', url: A, read: false, write: true }).tags, [['r', A, 'write'], ['r', B]]);
  assert.deepEqual(listTemplate('pub', ev(10002, [['r', A, 'read']]), { type: 'role', url: A, read: true, write: true }).tags, [['r', A]]);
  assert.throws(() => listTemplate('pub', base, { type: 'role', url: A, read: false, write: false }), /INVALID_ROLE/);
});
test('erreurs : adresse invalide, doublon, plafond ; liste > plafond : rien n’est perdu', () => {
  assert.throws(() => listTemplate('pub', null, { type: 'add', url: 'ws://x.example.com' }), /INVALID_URL/);
  assert.throws(() => listTemplate('pub', null, { type: 'add', url: 'wss://localhost' }), /INVALID_URL/);
  assert.throws(() => listTemplate('pub', ev(10002, [['r', A]]), { type: 'add', url: A }), /DUPLICATE/);
  const many = ev(10002, Array.from({ length: 15 }, (_, i) => ['r', `wss://r${i}.example.com`]));
  assert.throws(() => listTemplate('pub', many, { type: 'add', url: A }), /MAX/);
  assert.equal(tagUrls(listTemplate('pub', many, { type: 'remove', url: 'wss://r0.example.com' }) && many, 'pub').length, 15);
  assert.equal(listTemplate('pub', many, { type: 'remove', url: 'wss://r0.example.com' }).tags.length, 14);
  assert.ok(MAX_LIST_RELAYS < 15);
});

const signer = { signEvent: async (tpl) => ({ ...tpl, id: String(tpl.created_at).padStart(64, '0'), pubkey: 'a'.repeat(64), sig: 'f'.repeat(128) }) };
const mkOpts = (calls) => ({
  signer,
  boot: async () => ['wss://boot1.example.com', 'wss://boot2.example.com'],
  publish: async (urls, event) => { calls.push({ urls, event }); return urls.map((url) => ({ url, ok: url !== B, message: url === B ? 'blocked' : '' })); },
  cache: { put: () => {} },
  apply: () => {},
});

test('editList : publie sur amorçage + relais de la liste (ancienne et nouvelle) + relais d’écriture', async () => {
  resetAccount({ apply: () => {} });
  applyListEvent(ev(10002, [['r', A], ['r', B, 'read']], { created_at: 10 }), { cache: { put: () => {} }, apply: () => {} });
  const calls = [];
  const res = await editList('pub', { type: 'add', url: C }, mkOpts(calls));
  assert.equal(calls.length, 1);
  assert.deepEqual(new Set(calls[0].urls), new Set(['wss://boot1.example.com', 'wss://boot2.example.com', A, B, C]));
  assert.equal(res.total, 5);
  assert.equal(res.ok, 4);
  assert.deepEqual(state.get('lists').pub.relays.map((r) => r.url), [A, B, C]); // appliqué tout de suite
});
test('editList : sans signeur, signature refusée, lecture seule', async () => {
  resetAccount({ apply: () => {} });
  await assert.rejects(editList('dm', { type: 'add', url: A }, { ...mkOpts([]), signer: null }), /NO_SIGNER/);
  const refuse = { signEvent: async () => { throw new Error('no'); } };
  await assert.rejects(editList('dm', { type: 'add', url: A }, { ...mkOpts([]), signer: refuse }), /SIGN_FAILED/);
  assert.equal(state.get('lists').dm, null);
});
test('editList : première liste (aucune version) → status ready ; modifications en série', async () => {
  resetAccount({ apply: () => {} });
  const calls = [];
  const o = mkOpts(calls);
  await Promise.all([editList('pub', { type: 'add', url: A }, o), editList('pub', { type: 'add', url: B }, o)]);
  assert.equal(state.get('lists').status, 'ready');
  assert.deepEqual(state.get('lists').pub.relays.map((r) => r.url), [A, B]);
  assert.ok(calls[1].event.created_at > calls[0].event.created_at);
});

class FakeWS {
  constructor(url) { this.url = url; setTimeout(() => this.onopen?.(), 0); }
  send(raw) {
    const [, e] = JSON.parse(raw);
    const reply = this.url.includes('refuse') ? ['OK', e.id, false, 'blocked: spam'] : this.url.includes('muet') ? null : ['OK', e.id, true, ''];
    if (reply) setTimeout(() => this.onmessage?.({ data: JSON.stringify(reply) }), 0);
  }
  close() {}
}
test('publishToMany : OK, refus avec message, délai dépassé, relais invalides écartés', async () => {
  const r = await publishToMany(['wss://ok.example.com', 'wss://refuse.example.com', 'wss://muet.example.com', 'ws://x.example.com', 'wss://ok.example.com'],
    { id: 'e'.repeat(64) }, { WS: FakeWS, okTimeout: 30 });
  assert.deepEqual(r.map((x) => [x.url.slice(6, 10), x.ok, x.message]), [['ok.e', true, ''], ['refu', false, 'blocked: spam'], ['muet', false, 'timeout']]);
});

import { creationTemplate } from '../js/nostr/relaylists.js';
import { createLists, applyCreated } from '../js/account.js';

test('creationTemplate : normalisé, dédoublonné, plafonné, vide refusé', () => {
  const t = creationTemplate('pub', [A, 'WSS://A.example.com/', 'ws://x.example.com', B], 7);
  assert.deepEqual(t, { kind: 10002, created_at: 7, tags: [['r', A], ['r', B]], content: '' });
  assert.deepEqual(creationTemplate('dm', [A], 7).tags, [['relay', A]]);
  assert.throws(() => creationTemplate('pub', ['ws://x.example.com']), /EMPTY/);
  assert.equal(creationTemplate('pub', Array.from({ length: 30 }, (_, i) => `wss://r${i}.example.com`)).tags.length, MAX_LIST_RELAYS);
});
test('createLists : une version par liste, appliquées seulement à applyCreated', async () => {
  resetAccount({ apply: () => {} });
  const calls = [];
  const o = mkOpts(calls);
  const created = await createLists({ pub: [A, B], search: [], dm: [C] }, o);
  assert.deepEqual(Object.keys(created), ['pub', 'dm']);
  assert.equal(calls.length, 2);
  assert.equal(state.get('lists').status, 'idle'); // rien d'appliqué avant la lecture du résultat
  applyCreated(created, { cache: { put: () => {} }, apply: () => {} });
  assert.equal(state.get('lists').status, 'ready');
  assert.deepEqual(state.get('lists').dm.relays.map((r) => r.url), [C]);
  await assert.rejects(createLists({ pub: [], dm: [C] }, o), /EMPTY/);
  await assert.rejects(createLists({ pub: [A] }, { ...o, signer: null }), /NO_SIGNER/);
});
