import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, safeUrl, parseProfile } from '../js/nostr/profile.js';
import { parseContacts, buildContactsTemplate, MAX_FOLLOWS } from '../js/nostr/contacts.js';
import { matchesTemplate } from '../js/nostr/events.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const prof = (o, kind = 0) => ({ kind, content: typeof o === 'string' ? o : JSON.stringify(o) });

test('cleanText : retire caractères de contrôle et inversion bidi', () => {
  assert.equal(cleanText('a‮b​c\nd  e', 50), 'abc d e');
  assert.equal(cleanText('x\ny\r\nz\u0007', 50, { multiline: true }), 'x\ny\nz');
  assert.equal(cleanText(42, 10), '');
  assert.equal(cleanText('x'.repeat(100), 10).length, 10);
});
test('safeUrl : https uniquement, sans identifiants', () => {
  assert.equal(safeUrl('https://example.com/a.png'), 'https://example.com/a.png');
  for (const u of ['http://example.com/a', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://u:p@example.com/', 'https://localhost/x', '', null, 'https://' + 'a'.repeat(600) + '.com'])
    assert.equal(safeUrl(u), null, String(u));
});
test('parseProfile : champs normaux', () => {
  const p = parseProfile(prof({ name: 'alice', display_name: 'Alice', about: 'Salut\nmonde', picture: 'https://x.org/a.jpg', nip05: 'alice@x.org', lud16: 'alice@wallet.com' }));
  assert.deepEqual(p, { name: 'alice', displayName: 'Alice', about: 'Salut\nmonde', picture: 'https://x.org/a.jpg', banner: null, nip05: 'alice@x.org', lud16: 'alice@wallet.com' });
});
test('parseProfile : contenu hostile gardé comme texte, URLs dangereuses écartées', () => {
  const p = parseProfile(prof({ name: '<img src=x onerror=alert(1)>', about: '<script>alert(1)</script>', picture: 'javascript:alert(1)', banner: 'http://x.org/b.png', lud16: 'pas une adresse', nip05: 5 }));
  assert.equal(p.name, '<img src=x onerror=alert(1)>'); // affiché via textContent : inoffensif
  assert.equal(p.picture, null); assert.equal(p.banner, null); assert.equal(p.lud16, ''); assert.equal(p.nip05, '');
});
test('parseProfile : entrées invalides', () => {
  for (const bad of [null, prof('pas du json'), prof('[1,2]'), prof('null'), prof({}, 1), { kind: 0, content: 5 }]) assert.equal(parseProfile(bad), null);
});
test('contacts : analyse, dédoublonnage, balises invalides', () => {
  const ev = { kind: 3, tags: [['p', A], ['p', A], ['p', 'zz'], ['e', B], ['p', B, 'wss://r.x'], ['p']] };
  assert.deepEqual(parseContacts(ev), [A, B]);
  assert.deepEqual(parseContacts({ kind: 1, tags: [['p', A]] }), []);
  assert.deepEqual(parseContacts(null), []);
});
test('contacts : suivre conserve contenu et autres balises, created_at strictement plus récent', () => {
  const prev = { kind: 3, created_at: 2000, content: '{"wss://r":{}}', tags: [['p', A, 'wss://hint'], ['t', 'x']] };
  const tpl = buildContactsTemplate(prev, 'follow', B, 1000);
  assert.deepEqual(tpl.tags, [['p', A, 'wss://hint'], ['t', 'x'], ['p', B]]);
  assert.equal(tpl.content, prev.content);
  assert.equal(tpl.created_at, 2001);
  assert.equal(buildContactsTemplate(prev, 'follow', A, 5000), null);
});
test('contacts : désabonnement et absence de liste', () => {
  const prev = { kind: 3, created_at: 10, content: '', tags: [['p', A], ['p', B]] };
  assert.deepEqual(buildContactsTemplate(prev, 'unfollow', A, 100).tags, [['p', B]]);
  assert.equal(buildContactsTemplate(prev, 'unfollow', C, 100), null);
  assert.deepEqual(buildContactsTemplate(null, 'follow', A, 100), { kind: 3, created_at: 100, tags: [['p', A]], content: '' });
  assert.throws(() => buildContactsTemplate(prev, 'follow', 'zz'));
  assert.throws(() => buildContactsTemplate(prev, 'bidon', A));
});
test('contacts : plafond de la liste', () => {
  const tags = Array.from({ length: MAX_FOLLOWS }, (_, i) => ['p', i.toString(16).padStart(64, '0')]);
  assert.throws(() => buildContactsTemplate({ kind: 3, created_at: 1, tags, content: '' }, 'follow', 'f'.repeat(64)), /too-many/);
});
test('signeur : le résultat doit correspondre à la demande', () => {
  const tpl = { kind: 3, content: '', tags: [['p', A]], created_at: 5 };
  const ev = { ...tpl, pubkey: B, id: '1', sig: '2' };
  assert.equal(matchesTemplate(ev, tpl, B), true);
  assert.equal(matchesTemplate({ ...ev, pubkey: C }, tpl, B), false);
  assert.equal(matchesTemplate({ ...ev, tags: [] }, tpl, B), false);
  assert.equal(matchesTemplate({ ...ev, content: 'x' }, tpl, B), false);
  assert.equal(matchesTemplate({ ...ev, kind: 1 }, tpl, B), false);
  assert.equal(matchesTemplate(null, tpl, B), false);
});
