import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConnection, parseInfo, checkInfo, parseResponse, responseMatches, payRequestTemplate, NwcError } from '../js/nostr/nip47.js';
import { seal, open } from '../js/storage/vault.js';
import { nwcExchange } from '../js/relays/nwc.js';

const W = 'a'.repeat(64), SEC = '5'.repeat(64), C = 'c'.repeat(64);
const URI = `nostr+walletconnect://${W}?relay=${encodeURIComponent('wss://relay.example.com')}&secret=${SEC}&lud16=me@ln.example.com`;

test('chaîne de connexion', () => {
  const c = parseConnection(URI);
  assert.deepEqual([c.walletPubkey, c.relays, c.secret, c.lud16], [W, ['wss://relay.example.com'], SEC, 'me@ln.example.com']);
  assert.equal(parseConnection(`nostr+walletconnect:${W}?relay=wss://r.example.com&secret=${SEC}`).relays[0], 'wss://r.example.com');
  for (const bad of ['nostr://x', `nostr+walletconnect://zz?relay=wss://r.example.com&secret=${SEC}`])
    assert.throws(() => parseConnection(bad), (e) => e.code === 'INVALID_URI');
  assert.throws(() => parseConnection(`nostr+walletconnect://${W}?relay=ws://x.example.com&secret=${SEC}`), (e) => e.code === 'NO_RELAY');
  assert.throws(() => parseConnection(`nostr+walletconnect://${W}?relay=wss://192.168.1.2&secret=${SEC}`), (e) => e.code === 'NO_RELAY');
  assert.throws(() => parseConnection(`nostr+walletconnect://${W}?relay=wss://r.example.com&secret=abc`), (e) => e.code === 'NO_SECRET');
});

test('informations du portefeuille', () => {
  assert.throws(() => checkInfo(parseInfo({ kind: 13194, content: 'pay_invoice get_balance', tags: [] })), (e) => e.code === 'NWC_ENCRYPTION');   // NIP-04 seul
  assert.doesNotThrow(() => checkInfo(parseInfo({ kind: 13194, content: 'pay_invoice', tags: [['encryption', 'nip44_v2 nip04']] })));
  assert.throws(() => checkInfo(parseInfo({ kind: 13194, content: 'get_balance', tags: [['encryption', 'nip44_v2']] })), (e) => e.code === 'NWC_UNSUPPORTED');
  assert.doesNotThrow(() => checkInfo(null));
});

test('réponses', () => {
  assert.deepEqual(parseResponse(JSON.stringify({ result_type: 'pay_invoice', result: { preimage: 'ab' } })), { preimage: 'ab' });
  assert.throws(() => parseResponse(JSON.stringify({ error: { code: 'INSUFFICIENT_BALANCE', message: 'pas assez' } })), (e) => e.code === 'NWC_REFUSED' && /INSUFFICIENT/.test(e.detail));
  assert.throws(() => parseResponse('pas du json'), (e) => e.code === 'NWC_ERROR');
  const ev = { kind: 23195, pubkey: W, tags: [['e', 'r'], ['p', C]] };
  assert.ok(responseMatches(ev, { walletPubkey: W, clientPubkey: C, requestId: 'r' }));
  assert.ok(!responseMatches({ ...ev, pubkey: C }, { walletPubkey: W, clientPubkey: C, requestId: 'r' }));
  assert.ok(!responseMatches(ev, { walletPubkey: W, clientPubkey: C, requestId: 'autre' }));
});

test('requête : NIP-44 annoncé et expiration', () => {
  const r = payRequestTemplate(W, 'chiffre', 1000);
  assert.equal(r.kind, 23194);
  assert.deepEqual(r.tags, [['p', W], ['encryption', 'nip44_v2'], ['expiration', '1120']]);
});

test('coffre : aller-retour, mauvais mot de passe, données altérées', async () => {
  const blob = await seal('mot-de-passe-solide', SEC, 2000);
  assert.ok(!JSON.stringify(blob).includes(SEC));
  assert.equal(await open('mot-de-passe-solide', blob), SEC);
  await assert.rejects(open('mauvais', blob), (e) => e.code === 'BAD_PASSWORD');
  await assert.rejects(open('mot-de-passe-solide', { ...blob, data: blob.data.slice(0, -4) + 'AAAA' }), (e) => e.code === 'BAD_PASSWORD');
  await assert.rejects(open('x', { v: 1, iter: 999999999 }), (e) => e.code === 'BAD_PASSWORD');
});

// ---- échange avec un faux relais
class WS {
  static mode = 'ok';
  constructor(url) { this.url = url; WS.last = this; this.sent = []; setTimeout(() => this.onopen?.(), 0); }
  reply(m) { setTimeout(() => this.onmessage?.({ data: JSON.stringify(m) }), 0); }
  send(raw) {
    const m = JSON.parse(raw); this.sent.push(m[0]);
    if (m[0] === 'REQ' && m[1] === 'info') {
      if (WS.mode === 'nip04') this.reply(['EVENT', 'info', { kind: 13194, content: 'pay_invoice', tags: [] }]);
      this.reply(['EOSE', 'info']);
    } else if (m[0] === 'EVENT' && WS.mode === 'ok') this.reply(['EVENT', 'resp', { id: 'x', kind: 23195, pubkey: W, tags: [['e', m[1].id], ['p', C]], content: 'rep' }]);
    else if (m[0] === 'EVENT' && WS.mode === 'refuse') this.reply(['OK', m[1].id, false, 'blocked: rate limit']);
  }
  close() {}
}
const base = { relay: 'wss://r.example.com', walletPubkey: W, clientPubkey: C, WS, timeout: 80, infoWait: 20 };
const onResponse = async (ev, req) => { if (!responseMatches(ev, { walletPubkey: W, clientPubkey: C, requestId: req.id })) throw new Error('ignore'); return { preimage: 'pi' }; };

test('échange : succès, requête signée après vérification du portefeuille', async () => {
  WS.mode = 'ok';
  const r = await nwcExchange({ ...base, signRequest: async () => ({ id: 'req1' }), onResponse });
  assert.deepEqual(r, { preimage: 'pi' });
  assert.deepEqual(WS.last.sent, ['REQ', 'REQ', 'EVENT']);
});
test('échange : portefeuille NIP-04 seul → refus avant toute signature', async () => {
  WS.mode = 'nip04'; let signed = false;
  await assert.rejects(nwcExchange({ ...base, signRequest: async () => { signed = true; return { id: 'r' }; }, onResponse }), (e) => e.code === 'NWC_ENCRYPTION');
  assert.equal(signed, false);
});
test('échange : relais qui refuse, et délai dépassé', async () => {
  WS.mode = 'refuse';
  await assert.rejects(nwcExchange({ ...base, signRequest: async () => ({ id: 'r' }), onResponse }), (e) => e.code === 'NWC_REFUSED' && /rate limit/.test(e.detail));
  WS.mode = 'silent';
  await assert.rejects(nwcExchange({ ...base, signRequest: async () => ({ id: 'r' }), onResponse }), (e) => e.code === 'NWC_TIMEOUT');
});
