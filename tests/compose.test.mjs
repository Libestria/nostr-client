import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNote, buildReaction, buildRepost, buildDeletion, parseNoteText, MAX_NOTE_CHARS } from '../js/nostr/compose.js';
import { npubEncode, noteEncode, nprofileEncode } from '../js/nostr/nip19.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), ID = '1'.repeat(64), ID2 = '2'.repeat(64);
const ev = (o) => ({ id: ID, pubkey: A, kind: 1, created_at: 1, content: '', tags: [], sig: 'f'.repeat(128), ...o });

test('note simple : hashtags minuscules, dédoublonnés', () => {
  const n = buildNote('Bonjour #Nostr et #nostr, #Été !', { created_at: 5 });
  assert.deepEqual(n, { kind: 1, created_at: 5, content: 'Bonjour #Nostr et #nostr, #Été !', tags: [['t', 'nostr'], ['t', 'été']] });
});
test('mentions : npub / nprofile → nostr: + balise p ; note → balise q', () => {
  const text = `Salut ${npubEncode(B)} et nostr:${nprofileEncode({ pubkey: C })} voir ${noteEncode(ID)} npub1invalide`;
  const n = buildNote(text);
  assert.ok(n.content.includes(`nostr:${npubEncode(B)}`) && n.content.includes(`nostr:${noteEncode(ID)}`));
  assert.ok(n.content.includes('npub1invalide') && !n.content.includes('nostr:npub1invalide'));
  assert.deepEqual(n.tags, [['p', B], ['p', C], ['q', ID, '']]);
});
test('vide, trop long, clé privée : refusés', () => {
  assert.throws(() => buildNote('  \n '), /EMPTY/);
  assert.throws(() => buildNote('x'.repeat(MAX_NOTE_CHARS + 1)), /TOO_LONG/);
  assert.throws(() => buildNote('ma clé nsec1' + 'q'.repeat(58)), /PRIVATE_KEY/);
});
test('réponse à une note racine : e « root », p de l’auteur', () => {
  const n = buildNote('ok', { reply: ev({ id: ID, pubkey: A }) });
  assert.deepEqual(n.tags, [['e', ID, '', 'root', A], ['p', A]]);
});
test('réponse dans un fil : root + reply, p du parent et de ses destinataires', () => {
  const parent = ev({ id: ID2, pubkey: B, tags: [['e', ID, '', 'root', A], ['e', 'f'.repeat(64), '', 'reply'], ['p', A], ['p', C]] });
  const n = buildNote('ok', { reply: parent });
  assert.deepEqual(n.tags, [['e', ID, '', 'root', A], ['e', ID2, '', 'reply', B], ['p', B], ['p', A], ['p', C]]);
});
test('réponse à une note à l’ancien format (e sans marqueur) : première référence = racine', () => {
  const n = buildNote('ok', { reply: ev({ id: ID2, pubkey: B, tags: [['e', ID]] }) });
  assert.deepEqual(n.tags.slice(0, 2), [['e', ID, '', 'root'], ['e', ID2, '', 'reply', B]]);
});
test('réaction, repost, suppression', () => {
  assert.deepEqual(buildReaction(ev({}), '+', 3), { kind: 7, created_at: 3, content: '+', tags: [['e', ID], ['p', A], ['k', '1']] });
  const r = buildRepost(ev({ content: 'x' }), 3);
  assert.equal(r.kind, 6);
  assert.equal(JSON.parse(r.content).id, ID);
  assert.deepEqual(r.tags, [['e', ID, ''], ['p', A]]);
  assert.equal(buildRepost(ev({ kind: 30023 })).kind, 16);
  assert.deepEqual(buildDeletion(ev({}), A, 3), { kind: 5, created_at: 3, content: '', tags: [['e', ID], ['k', '1']] });
  assert.throws(() => buildDeletion(ev({}), B), /NOT_OWN/);
});
test('analyse : hashtag dans une adresse ignoré', () => {
  assert.deepEqual(parseNoteText('https://x.org/page#ancre mot#collé').hashtags, []);
});
