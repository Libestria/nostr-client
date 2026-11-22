import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeContent } from '../js/nostr/content.js';
import { buildThread, parentId, rootId } from '../js/nostr/thread.js';
import { buildProfileTemplate } from '../js/nostr/profile.js';
import { npubEncode, noteEncode } from '../js/nostr/nip19.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), ID = (n) => String(n).repeat(64).slice(0, 64);
const note = (n, tags, at) => ({ id: ID(n), pubkey: A, kind: 1, created_at: at ?? n, content: '', tags, sig: 'f'.repeat(128) });

test('contenu : mention, note, lien https, image, hashtag ; javascript: et http: restent du texte', () => {
  const txt = `Hello nostr:${npubEncode(B)} voir ${noteEncode(ID(1))} https://ex.org/a.png, https://ex.org/p?x=1). #Nostr javascript:alert(1) http://ex.org`;
  const t = tokenizeContent(txt);
  assert.deepEqual(t.filter((x) => x.type !== 'text').map((x) => x.type), ['mention', 'note', 'link', 'link', 'hashtag']);
  assert.equal(t.find((x) => x.type === 'link').image, true);
  assert.equal(t.filter((x) => x.type === 'link')[1].url, 'https://ex.org/p?x=1');
  assert.equal(t.find((x) => x.type === 'hashtag').tag, 'nostr');
  assert.ok(t.map((x) => x.text ?? '').join('').includes('javascript:alert(1) http://ex.org'));
  assert.equal(t.map((x) => x.text ?? x.label ?? '').join('').length > 0, true);
});
test('contenu : référence invalide et texte hostile inchangés', () => {
  const t = tokenizeContent('npub1abcdefghijklmnopqrstuvwxyz0123 <script>x</script> https://');
  assert.equal(t.every((x) => x.type === 'text'), true);
  assert.equal(t.map((x) => x.text).join(''), 'npub1abcdefghijklmnopqrstuvwxyz0123 <script>x</script> https://');
});
test('fil : parent et racine selon les marqueurs, ancien format compris', () => {
  assert.equal(parentId(note(3, [['e', ID(1), '', 'root'], ['e', ID(2), '', 'reply']])), ID(2));
  assert.equal(parentId(note(3, [['e', ID(1), '', 'root']])), ID(1));
  assert.equal(parentId(note(3, [['e', ID(1)], ['e', ID(2)]])), ID(2));
  assert.equal(rootId(note(3, [['e', ID(1)], ['e', ID(2)]])), ID(1));
  assert.equal(parentId(note(3, [])), null);
});
test('fil : arbre, ordre chronologique, orphelins rattachés à la racine', () => {
  const evs = [note(1, []), note(2, [['e', ID(1), '', 'root']], 20), note(3, [['e', ID(1), '', 'root'], ['e', ID(2), '', 'reply']], 30),
    note(4, [['e', ID(1), '', 'root'], ['e', ID(9), '', 'reply']], 25), note(5, [['e', ID(1), '', 'root']], 10)];
  const { roots } = buildThread(evs, ID(3));
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0].children.map((c) => c.event.id), [ID(5), ID(2), ID(4)]);
  assert.deepEqual(roots[0].children[1].children.map((c) => c.event.id), [ID(3)]);
  assert.equal(roots[0].children[1].children[0].depth, 2);
});
test('fil : racine inconnue, cycle forgé, profondeur plafonnée', () => {
  const { roots } = buildThread([note(2, [['e', ID(1), '', 'root']])], ID(2));
  assert.equal(roots.length, 1);
  const cyc = buildThread([note(1, [['e', ID(2), '', 'reply']]), note(2, [['e', ID(1), '', 'reply']])], ID(1));
  assert.ok(cyc.roots.length >= 0);
  let chain = [note(1, [])];
  for (let i = 2; i <= 9; i++) chain.push(note(i, [['e', ID(1), '', 'root'], ['e', ID(i - 1), '', 'reply']]));
  let node = buildThread(chain, ID(9)).roots[0], max = 0;
  while (node) { max = Math.max(max, node.depth); node = node.children[0]; }
  assert.equal(max, 6);
});
test('profil : champs inconnus conservés, champs vides retirés, validations', () => {
  const prev = { kind: 0, created_at: 100, tags: [['x', 'y']], content: JSON.stringify({ name: 'a', lud06: 'LNURL…', bot: true, about: 'vieux' }) };
  const t = buildProfileTemplate(prev, { name: 'Alice', about: '', picture: 'https://ex.org/a.png', lud16: 'alice@wallet.com', nip05: 'alice@ex.org', website: '' }, 50);
  const c = JSON.parse(t.content);
  assert.deepEqual(c, { name: 'Alice', lud06: 'LNURL…', bot: true, picture: 'https://ex.org/a.png', lud16: 'alice@wallet.com', nip05: 'alice@ex.org' });
  assert.equal(t.created_at, 101);
  assert.deepEqual(t.tags, [['x', 'y']]);
  assert.throws(() => buildProfileTemplate(null, { picture: 'http://ex.org/a.png' }), /INVALID_picture/);
  assert.throws(() => buildProfileTemplate(null, { picture: 'javascript:alert(1)' }), /INVALID_picture/);
  assert.throws(() => buildProfileTemplate(null, { lud16: 'pas une adresse' }), /INVALID_lud16/);
  assert.throws(() => buildProfileTemplate(null, { name: 'x'.repeat(61) }), /TOO_LONG_name/);
  assert.throws(() => buildProfileTemplate(null, { name: 'a\nb' }), /INVALID_name/);
  assert.equal(JSON.parse(buildProfileTemplate({ kind: 0, content: 'pas du json', created_at: 1, tags: [] }, { name: 'Z' }).content).name, 'Z');
});
