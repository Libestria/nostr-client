import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { buildRumor, wrapFor, unwrap, participantsOf, convId, toRecord, partnersOf, DmError, cryptoFromLib } from '../js/nostr/dm.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Faux chiffrement symétrique : « clé » = pk dérivée de sk (pk = sha(sk)), partage = trié(pkA,pkB).
const pkOf = (sk) => sha(sk);
const key = (a, b) => [a, b].sort().join('|');
const fake = {
  generateSecretKey: () => randomBytes(8).toString('hex'),
  getPublicKey: pkOf,
  getEventHash: (e) => sha(JSON.stringify([e.pubkey, e.created_at, e.kind, e.tags, e.content])),
  finalizeEvent(t, sk) { const e = { ...t, pubkey: pkOf(sk) }; e.id = fake.getEventHash(e); e.sig = 'sig:' + e.pubkey + e.id; return e; },
  verifyEvent: (e) => e.sig === 'sig:' + e.pubkey + e.id && e.id === fake.getEventHash(e),
  encryptWith: (sk, pk, text) => JSON.stringify({ k: key(pkOf(sk), pk), t: text }),
};
const decryptAs = (myPk, otherPk, payload) => { const o = JSON.parse(payload); if (o.k !== key(myPk, otherPk)) throw new Error('bad'); return o.t; };

// Faux signeur pour un utilisateur donné (sk → pk)
const signerFor = (sk) => {
  const pk = pkOf(sk);
  return {
    nip44: { encrypt: async (other, text) => JSON.stringify({ k: key(pk, other), t: text }), decrypt: async (other, c) => decryptAs(pk, other, c) },
    signEvent: async (t) => fake.finalizeEvent(t, sk),
  };
};
// Déchiffrement de l'enveloppe : la clé jetable chiffre pour le destinataire, donc decrypt(wrap.pubkey, …) côté signeur
const alice = { sk: 'alice-sk', pk: pkOf('alice-sk') }, bob = { sk: 'bob-sk', pk: pkOf('bob-sk') };

test('aller-retour wrap → unwrap', async () => {
  const rumor = buildRumor({ content: ' salut ', pubkey: alice.pk, recipients: [bob.pk] }, fake, 1000);
  assert.equal(rumor.kind, 14); assert.equal(rumor.content, 'salut');
  const wrap = await wrapFor(rumor, bob.pk, signerFor(alice.sk), fake, 100000);
  assert.equal(wrap.kind, 1059); assert.deepEqual(wrap.tags, [['p', bob.pk]]);
  assert.notEqual(wrap.pubkey, alice.pk);
  assert.ok(wrap.created_at <= 100000 && wrap.created_at > 100000 - 2 * 86400);
  const opened = await unwrap(wrap, bob.pk, signerFor(bob.sk), fake);
  assert.equal(opened.rumor.content, 'salut'); assert.equal(opened.rumor.pubkey, alice.pk);
  assert.deepEqual(opened.participants, [alice.pk, bob.pk].sort());
  const rec = toRecord(opened, bob.pk, wrap.id);
  assert.equal(rec.mine, false); assert.equal(rec.me, bob.pk);
  assert.deepEqual(partnersOf(opened.participants, bob.pk), [alice.pk]);
});

test('copie pour soi', async () => {
  const rumor = buildRumor({ content: 'x', pubkey: alice.pk, recipients: [bob.pk] }, fake, 5);
  const w = await wrapFor(rumor, alice.pk, signerFor(alice.sk), fake);
  const o = await unwrap(w, alice.pk, signerFor(alice.sk), fake);
  assert.equal(toRecord(o, alice.pk, w.id).mine, true);
});

test('usurpation : expéditeur du message ≠ signataire du sceau', async () => {
  const rumor = buildRumor({ content: 'x', pubkey: C, recipients: [bob.pk] }, fake, 5);
  const w = await wrapFor(rumor, bob.pk, signerFor(alice.sk), fake);
  await assert.rejects(unwrap(w, bob.pk, signerFor(bob.sk), fake), (e) => e.code === 'spoofed');
});

test('message qui ne me concerne pas', async () => {
  const rumor = buildRumor({ content: 'x', pubkey: alice.pk, recipients: [C] }, fake, 5);
  const w = await wrapFor(rumor, bob.pk, signerFor(alice.sk), fake);
  await assert.rejects(unwrap(w, bob.pk, signerFor(bob.sk), fake), (e) => e.code === 'not-for-me');
});

test('sceau mal signé rejeté', async () => {
  const s = signerFor(alice.sk);
  const bad = { ...s, signEvent: async (t) => ({ ...fake.finalizeEvent(t, alice.sk), sig: 'forged' }) };
  const rumor = buildRumor({ content: 'x', pubkey: alice.pk, recipients: [bob.pk] }, fake, 5);
  const w = await wrapFor(rumor, bob.pk, bad, fake);
  await assert.rejects(unwrap(w, bob.pk, signerFor(bob.sk), fake), (e) => e.code === 'seal');
});

test('signeur sans NIP-44 / refus', async () => {
  const rumor = buildRumor({ content: 'x', pubkey: alice.pk, recipients: [bob.pk] }, fake, 5);
  await assert.rejects(wrapFor(rumor, bob.pk, { signEvent: async () => ({}) }, fake), (e) => e.code === 'signer');
  const refusing = { nip44: { encrypt: async () => { throw new Error('denied'); } }, signEvent: async () => ({}) };
  await assert.rejects(wrapFor(rumor, bob.pk, refusing, fake), (e) => e.code === 'signer');
  await assert.rejects(unwrap({ kind: 1059, pubkey: A, content: 'zz' }, bob.pk, signerFor(bob.sk), fake), (e) => e.code === 'signer');
});

test('buildRumor : validation et destinataires dédoublonnés', () => {
  assert.throws(() => buildRumor({ content: '  ', pubkey: A, recipients: [B] }, fake), DmError);
  assert.throws(() => buildRumor({ content: 'x', pubkey: A, recipients: ['zz'] }, fake), DmError);
  const r = buildRumor({ content: 'x', pubkey: A, recipients: [B, B, C], replyTo: A, subject: 's' }, fake, 1);
  assert.equal(r.tags.filter((t) => t[0] === 'p').length, 2);
  assert.ok(r.tags.some((t) => t[0] === 'e') && r.tags.some((t) => t[0] === 'subject'));
});

test('conversations : id stable et participants', () => {
  assert.equal(convId([B, A]), convId([A, B]));
  assert.deepEqual(participantsOf({ pubkey: A, tags: [['p', B], ['p', B], ['p', 'x']] }), [A, B]);
  assert.deepEqual(partnersOf([A], A), [A]);
});

test('cryptoFromLib : adaptateur et bibliothèque incomplète', () => {
  assert.throws(() => cryptoFromLib({}), (e) => e.code === 'unsupported');
  const lib = { nip44: { getConversationKey: (a, b) => a + b, encrypt: (t, k) => t + k, decrypt: () => '' },
    finalizeEvent() {}, generateSecretKey() {}, getPublicKey() {}, getEventHash() {}, verifyEvent() {} };
  assert.equal(cryptoFromLib(lib).encryptWith('s', 'p', 't'), 'tsp');
});

import { legacyGroup } from '../js/nostr/dm.js';
test('NIP-04 : regroupement par interlocuteur, envoyés/reçus, doublons et événements étrangers écartés', () => {
  const k4 = (id, pubkey, to, created_at) => ({ id, kind: 4, pubkey, tags: [['p', to]], content: 'x?iv=y', created_at });
  const g = legacyGroup([k4('1', A, B, 20), k4('2', B, A, 10), k4('2', B, A, 10), k4('3', B, C, 5), k4('4', C, B, 6), { id: '5', kind: 1, pubkey: A, tags: [], content: '' }], A);
  assert.deepEqual([...g.keys()], [B]);
  assert.deepEqual(g.get(B).map((m) => [m.id, m.mine]), [['2', false], ['1', true]]);
});
