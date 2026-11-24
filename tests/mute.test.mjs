import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMute, muteTemplate, muteReason, emptyMute } from '../js/nostr/mute.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), E = 'e'.repeat(64);
const prev = { kind: 10000, created_at: 100, content: 'chiffré-privé', tags: [['p', A], ['word', 'Spam'], ['t', '#Promo'], ['e', E], ['x', 'autre'], ['p', 'zz']] };

test('lecture de la liste', () => {
  assert.deepEqual(parseMute(prev), { pubkeys: [A], words: ['spam'], events: [E], hashtags: ['promo'] });
  assert.deepEqual(parseMute(null), emptyMute());
});

test('ajout / retrait : conserve les autres balises et le contenu chiffré', () => {
  const t1 = muteTemplate(prev, [{ type: 'add', kind: 'pubkey', value: B.toUpperCase() }, { type: 'add', kind: 'word', value: ' Crypto ' }], 50);
  assert.equal(t1.created_at, 101); assert.equal(t1.content, 'chiffré-privé');
  assert.ok(t1.tags.some((t) => t[0] === 'x') && t1.tags.some((t) => t[0] === 'p' && t[1] === B) && t1.tags.some((t) => t[0] === 'word' && t[1] === 'crypto'));
  const t2 = muteTemplate(prev, [{ type: 'remove', kind: 'word', value: 'SPAM' }, { type: 'remove', kind: 'hashtag', value: 'promo' }], 500);
  assert.ok(!t2.tags.some((t) => t[0] === 'word' || t[0] === 't'));
  assert.throws(() => muteTemplate(prev, [{ type: 'add', kind: 'pubkey', value: A }]), (e) => e.message === 'NO_CHANGE');
  assert.throws(() => muteTemplate(prev, [{ type: 'add', kind: 'pubkey', value: 'nope' }]), (e) => e.message === 'INVALID_VALUE');
  assert.throws(() => muteTemplate(prev, [{ type: 'add', kind: 'hashtag', value: 'a b' }]), (e) => e.message === 'INVALID_VALUE');
  assert.equal(muteTemplate(null, [{ type: 'add', kind: 'word', value: 'x' }], 7).created_at, 7);
});

test('filtrage', () => {
  const m = parseMute(prev);
  assert.equal(muteReason({ id: B, pubkey: A, kind: 1, tags: [], content: '' }, m), 'pubkey');
  assert.equal(muteReason({ id: B, pubkey: B, kind: 1, tags: [['e', E]], content: '' }, m), 'thread');
  assert.equal(muteReason({ id: B, pubkey: B, kind: 1, tags: [['t', 'PROMO']], content: '' }, m), 'hashtag');
  assert.equal(muteReason({ id: B, pubkey: B, kind: 1, tags: [], content: 'Un SPAM ici' }, m), 'word');
  assert.equal(muteReason({ id: B, pubkey: B, kind: 7, tags: [], content: 'spam' }, m), null);   // les mots ne visent que les notes
  assert.equal(muteReason({ id: B, pubkey: B, kind: 1, tags: [], content: 'normal' }, m), null);
});

import { classify } from '../js/nostr/notif.js';
test('notifications : classement', () => {
  const ME = 'a'.repeat(64), X = 'b'.repeat(64), N = 'c'.repeat(64), N2 = 'd'.repeat(64);
  const ev = (kind, tags, content = '', pubkey = X) => ({ kind, tags, content, pubkey, id: 'f'.repeat(64) });
  assert.equal(classify(ev(1, [['p', ME]]), ME).type, 'mention');
  assert.deepEqual(classify(ev(1, [['e', N, '', 'root'], ['e', N2, '', 'reply'], ['p', ME]]), ME), { type: 'reply', actor: X, target: N2 });
  assert.equal(classify(ev(6, [['e', N], ['p', ME]]), ME).type, 'repost');
  assert.deepEqual(classify(ev(7, [['e', N], ['p', ME]], '+'), ME), { type: 'reaction', actor: X, target: N, emoji: '❤️' });
  assert.equal(classify(ev(7, [['e', N], ['p', ME]], '-'), ME), null);
  assert.equal(classify(ev(9735, [['e', N], ['p', ME]]), ME).type, 'zap');
  assert.equal(classify(ev(1, [['p', N]]), ME), null);                 // ne me vise pas
  assert.equal(classify(ev(1, [['p', ME]], '', ME), ME), null);        // mes propres événements
});

import { parseQuery } from '../js/nostr/search.js';
import { npubEncode, noteEncode } from '../js/nostr/nip19.js';
import { searchRelays } from '../js/relays/search.js';
test('recherche : interprétation de la saisie', () => {
  const pk = 'a'.repeat(64);
  assert.deepEqual(parseQuery(npubEncode(pk)), { type: 'profile', pubkey: pk });
  assert.deepEqual(parseQuery(`nostr:${noteEncode(E)}`), { type: 'note', id: E });
  assert.deepEqual(parseQuery('bob@example.com'), { type: 'nip05', identifier: 'bob@example.com' });
  assert.deepEqual(parseQuery('  du texte libre  '), { type: 'text', text: 'du texte libre' });
  assert.equal(parseQuery('   ').type, 'empty');
  assert.equal(parseQuery('npub1invalide').type, 'text');
});
class SWS {
  constructor(url) { this.url = url; setTimeout(() => this.onopen?.(), 0); }
  send(raw) {
    const m = JSON.parse(raw); if (m[0] !== 'REQ') return;
    const good = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128), created_at: 5, kind: 1, tags: [], content: 'x' };
    const bad = { ...good, id: 'd'.repeat(64) };
    setTimeout(() => { for (const e of [good, bad, { nimporte: 'quoi' }]) this.onmessage?.({ data: JSON.stringify(['EVENT', m[1], e]) }); this.onmessage?.({ data: JSON.stringify(['EOSE', m[1]]) }); }, 0);
  }
  close() {}
}
test('recherche NIP-50 : forme et signature vérifiées, doublons fusionnés', async () => {
  const r = await searchRelays(['wss://a.example.com', 'wss://b.example.com'], [{ kinds: [1], search: 'x' }], { WS: SWS, timeout: 200, verify: async (e) => e.id.startsWith('a') });
  assert.equal(r.events.length, 1); assert.equal(r.responded, 2); assert.equal(r.total, 2);
});

import { buildBackup, parseBackup, importPlan, BackupError } from '../js/nostr/backup.js';
test('export / import : aller-retour, nettoyage et plan', () => {
  const lists = { pub: { relays: [{ url: 'wss://a.example.com', read: true, write: false }] }, search: { relays: [{ url: 'wss://s.example.com', read: true }] }, dm: { relays: [{ url: 'wss://d.example.com' }] } };
  const mute = { pubkeys: [A], words: ['spam'], events: [], hashtags: ['promo'] };
  const b = buildBackup({ settings: { theme: 'dark', lang: 'fr', loadMedia: true, browserNotify: false }, lists, mute }, 9);
  assert.ok(!JSON.stringify(b).includes('nsec'));
  const p = parseBackup(JSON.stringify(b));
  assert.deepEqual(p.relays.pub, [{ url: 'wss://a.example.com', read: true, write: false }]);
  assert.deepEqual(p.muted, { pubkeys: [A], words: ['spam'], events: [], hashtags: ['promo'] });
  assert.equal(p.skipped, 0);
  const plan = importPlan(p, { lists: { pub: { relays: [] }, search: { relays: [{ url: 'wss://s.example.com' }] }, dm: null }, mute: { pubkeys: [A], words: [], events: [], hashtags: [] } });
  assert.deepEqual(plan.relayOps.map((x) => x.key + x.op.url), ['pubwss://a.example.com', 'dmwss://d.example.com']);
  assert.deepEqual(plan.muteOps.map((o) => o.kind), ['word', 'hashtag']);
  // fichier hostile
  const hostile = { ...b, relays: { pub: [{ url: 'ws://x.example.com' }, { url: 'wss://192.168.0.1' }, { url: 'wss://ok.example.com' }], search: [], dm: [] }, muted: { pubkeys: ['zz', A], words: [], events: [], hashtags: [] }, settings: { theme: '<script>', lang: 'xx' } };
  const h = parseBackup(JSON.stringify(hostile));
  assert.deepEqual(h.relays.pub.map((r) => r.url), ['wss://ok.example.com']); assert.deepEqual(h.muted.pubkeys, [A]); assert.deepEqual(h.settings, {}); assert.equal(h.skipped, 3);
  for (const [txt, code] of [['pas du json', 'INVALID'], [JSON.stringify({ app: 'autre', version: 1 }), 'WRONG_APP'], [JSON.stringify({ ...b, note: 'nsec1' + 'q'.repeat(58) }), 'PRIVATE_KEY'], ['x'.repeat(400000), 'TOO_BIG']])
    assert.throws(() => parseBackup(txt), (e) => e instanceof BackupError && e.code === code);
});

import { groupOf, GROUPS } from '../js/nostr/notif.js';
test('notifications : abonnés et groupes', () => {
  const ME = 'a'.repeat(64), OTHER = 'b'.repeat(64);
  const c = classify({ id: 'x', pubkey: OTHER, kind: 3, tags: [['p', ME]], content: '' }, ME);
  assert.deepEqual(c, { type: 'follow', actor: OTHER, target: null });
  assert.equal(classify({ id: 'x', pubkey: OTHER, kind: 3, tags: [['p', OTHER]], content: '' }, ME), null);
  assert.deepEqual(['mention', 'reply', 'reaction', 'repost', 'zap', 'follow'].map(groupOf), ['mentions', 'mentions', 'reactions', 'reposts', 'zaps', 'follows']);
  assert.equal(GROUPS.length, 5);
});
