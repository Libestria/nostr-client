import test from 'node:test';
import assert from 'node:assert/strict';
import { validTemplate, buildEndpoint, parsePreview, firstLinkUrl, previewLinkUrls, DEFAULT_SERVICE } from '../js/nostr/linkpreview.js';

test('modèle de service : https et {url} obligatoires', () => {
  assert.ok(validTemplate(DEFAULT_SERVICE));
  for (const bad of ['http://a.example/?u={url}', 'https://a.example/', 'javascript:{url}', 'https://u:p@a.example/?u={url}', 42, '']) assert.equal(validTemplate(bad), false, String(bad));
});
test('adresse encodée', () => {
  assert.equal(buildEndpoint('https://s.example/?u={url}', 'https://a.test/x?y=1&z=2'), 'https://s.example/?u=https%3A%2F%2Fa.test%2Fx%3Fy%3D1%26z%3D2');
});
test('lecture du format microlink et du format plat', () => {
  const a = parsePreview({ status: 'success', data: { title: ' Titre\n  long ', description: 'D', image: { url: 'https://i.test/a.jpg' } } }, 'https://www.site.test/p');
  assert.deepEqual(a, { title: 'Titre long', description: 'D', image: 'https://i.test/a.jpg', host: 'site.test' });
  assert.equal(parsePreview({ title: 'T', image: 'https://i.test/b.png' }, 'https://x.test').image, 'https://i.test/b.png');
});
test('aperçu hostile : image non https ignorée, rien d’exploitable → null', () => {
  assert.equal(parsePreview({ title: 'T', image: 'javascript:alert(1)' }, 'https://x.test').image, '');
  assert.equal(parsePreview({ title: 'T', image: 'http://i.test/a.jpg' }, 'https://x.test').image, '');
  assert.equal(parsePreview({ status: 'fail' }, 'https://x.test'), null);
  assert.equal(parsePreview({ description: 'seule' }, 'https://x.test'), null);
  assert.equal(parsePreview(null, 'https://x.test'), null);
});
test('premier lien non image', () => {
  assert.equal(firstLinkUrl([{ type: 'link', url: 'https://a.test/i.png', image: true }, { type: 'link', url: 'https://b.test/', image: false }]), 'https://b.test/');
  assert.equal(firstLinkUrl([{ type: 'text', text: 'x' }]), null);
});

test('previewLinkUrls : tous les liens web, sans doublon ni image, limités', () => {
  const l = (url, x = {}) => ({ type: 'link', url, ...x });
  assert.deepEqual(previewLinkUrls([l('https://a.test/'), l('https://i.test/x.png', { image: true }), l('https://a.test/'), l('https://b.test/')]), ['https://a.test/', 'https://b.test/']);
  assert.equal(previewLinkUrls(Array.from({ length: 9 }, (_, i) => l(`https://s${i}.test/`))).length, 5);
});

test('service par défaut : Worker libestria ; l\'ancien réglage microlink est remplacé', async () => {
  assert.equal(DEFAULT_SERVICE, 'https://apercu-libestria.libestria.workers.dev/?url={url}');
  globalThis.localStorage = { _v: JSON.stringify({ previewService: 'https://api.microlink.io/?url={url}' }), getItem() { return this._v; }, setItem(k, v) { this._v = v; } };
  globalThis.navigator ??= { language: 'fr' };
  const { loadSettings } = await import('../js/storage/settings.js');
  assert.equal(loadSettings().previewService, DEFAULT_SERVICE);
  globalThis.localStorage._v = JSON.stringify({ previewService: 'https://autre.example.org/?u={url}' });
  assert.equal(loadSettings().previewService, 'https://autre.example.org/?u={url}');
});
