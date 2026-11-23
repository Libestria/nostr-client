import test from 'node:test';
import assert from 'node:assert/strict';
import { lnurlpUrl, parseLnurlPay, buildZapRequest, callbackUrl, bolt11Msats, checkInvoice, checkReceipt, ZapError } from '../js/nostr/nip57.js';
import { lnurlDecode } from '../js/nostr/nip19.js';

const P = 'a'.repeat(64), N = 'b'.repeat(64), S = 'c'.repeat(64), E = 'e'.repeat(64);
const GOOD = { tag: 'payRequest', callback: 'https://ln.example.com/cb', minSendable: 1000, maxSendable: 100000000, allowsNostr: true, nostrPubkey: N, commentAllowed: 50 };
const INV = (amt) => `lnbc${amt}1p` + 'q'.repeat(60);

test('lud16 → URL LNURL-pay', () => {
  assert.equal(lnurlpUrl('Bob@Walletofsatoshi.com'), 'https://walletofsatoshi.com/.well-known/lnurlp/Bob');
  assert.equal(lnurlpUrl('pas un lud16'), null);
  assert.equal(lnurlpUrl('a@localhost'), null);
});

test('réponse LNURL : acceptée / refusée', () => {
  const info = parseLnurlPay(GOOD, 'bob@ln.example.com');
  assert.equal(info.nostrPubkey, N); assert.equal(info.commentAllowed, 50);
  assert.equal(lnurlDecode(info.lnurl), 'https://ln.example.com/.well-known/lnurlp/bob');
  for (const bad of [{ ...GOOD, allowsNostr: false }, { ...GOOD, nostrPubkey: 'zz' }, { ...GOOD, callback: 'http://x.example.com' }, { ...GOOD, tag: 'x' }, { ...GOOD, maxSendable: 1 }, null])
    assert.throws(() => parseLnurlPay(bad, 'bob@ln.example.com'), ZapError);
});

test('demande de zap kind 9734', () => {
  const r = buildZapRequest({ recipient: P, eventId: E, amountSats: 21, comment: 'bravo', relays: ['wss://r.example.com', 'http://x', 'wss://r.example.com'], lnurl: 'lnurl1x', kind: 1 }, 5);
  assert.equal(r.kind, 9734); assert.equal(r.content, 'bravo');
  assert.deepEqual(r.tags.find((t) => t[0] === 'relays'), ['relays', 'wss://r.example.com']);
  assert.deepEqual(r.tags.find((t) => t[0] === 'amount'), ['amount', '21000']);
  assert.ok(r.tags.some((t) => t[0] === 'e' && t[1] === E) && r.tags.some((t) => t[0] === 'p' && t[1] === P));
  assert.throws(() => buildZapRequest({ recipient: P, amountSats: 0, relays: [] }), (e) => e.code === 'AMOUNT_RANGE');
  assert.throws(() => buildZapRequest({ recipient: 'x', amountSats: 5, relays: [] }), (e) => e.code === 'INVALID');
});

test('URL de rappel : montant, bornes et commentaire', () => {
  const info = parseLnurlPay(GOOD, 'bob@ln.example.com');
  const req = buildZapRequest({ recipient: P, amountSats: 100, relays: [] });
  const u = new URL(callbackUrl(info, 100, req, 'hello'));
  assert.equal(u.searchParams.get('amount'), '100000');
  assert.equal(JSON.parse(u.searchParams.get('nostr')).kind, 9734);
  assert.equal(u.searchParams.get('comment'), 'hello');
  assert.throws(() => callbackUrl(info, 1000000, req), (e) => e.code === 'AMOUNT_RANGE');
  assert.throws(() => callbackUrl(info, 100, req, 'x'.repeat(51)), (e) => e.code === 'COMMENT_TOO_LONG');
});

test('montant BOLT11', () => {
  assert.equal(bolt11Msats(INV('10u')), 1_000_000);   // 10 µBTC = 1000 sats
  assert.equal(bolt11Msats(INV('210n')), 21_000);      // 21 sats
  assert.equal(bolt11Msats(INV('2500u')), 250_000_000);
  assert.equal(bolt11Msats(INV('1')), 1e11);
  assert.equal(bolt11Msats('lnbc1p' + 'q'.repeat(60)), null);   // sans montant
  assert.equal(bolt11Msats('pas une facture'), null);
  assert.equal(checkInvoice(INV('210n'), 21), INV('210n'));
  assert.throws(() => checkInvoice(INV('210n'), 22), (e) => e.code === 'INVOICE_AMOUNT');
  assert.throws(() => checkInvoice('zzz', 22), (e) => e.code === 'INVOICE_INVALID');
});

test('reçu de zap : seul le fournisseur du destinataire est accepté', () => {
  const req = { kind: 9734, pubkey: S, content: 'merci', tags: [['p', P], ['amount', '21000'], ['e', E]] };
  const rc = { kind: 9735, pubkey: N, tags: [['p', P], ['e', E], ['bolt11', INV('210n')], ['description', JSON.stringify(req)]] };
  assert.deepEqual(checkReceipt(rc, { recipient: P, nostrPubkey: N }), { sats: 21, from: S, comment: 'merci', eventId: E });
  assert.equal(checkReceipt({ ...rc, pubkey: S }, { recipient: P, nostrPubkey: N }), null);           // faux fournisseur
  assert.equal(checkReceipt(rc, { recipient: S, nostrPubkey: N }), null);                               // autre destinataire
  assert.equal(checkReceipt({ ...rc, tags: rc.tags.map((t) => (t[0] === 'bolt11' ? ['bolt11', INV('300n')] : t)) }, { recipient: P, nostrPubkey: N }), null); // montant ≠ demande
  assert.equal(checkReceipt({ ...rc, tags: [['p', P]] }, { recipient: P, nostrPubkey: N }), null);
});
