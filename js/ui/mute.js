import { t } from '../i18n.js';
import { state } from '../state.js';
import { muteList, editMute } from '../mute.js';
import { getCached, requestProfile } from '../profiles.js';
import { getSigner } from '../auth.js';
import { npubEncode } from '../nostr/nip19.js';
import { el, shortNpub, publishKind } from './common.js';

const nameOf = (pk) => { const p = getCached(pk); return p?.displayName || p?.name || shortNpub(pk); };

// Section Réglages : comptes, mots, mots-clés (#) et fils en sourdine.
export function muteSection() {
  const node = el('section', { class: 'mute' });
  const msg = el('p', { class: 'status', role: 'status' });
  const say = (text, kind = '') => { msg.className = kind ? `status status-${kind}` : 'status'; msg.textContent = text; };
  const run = async (ops) => {
    say(t('lists.publishing'));
    try {
      const res = await editMute(ops);
      say(res.ok ? t('lists.published', { ok: res.ok, total: res.total }) : t('lists.publish.failed', { ok: res.ok, total: res.total }), publishKind(res));
    } catch (e) { say(t(e.message === 'NO_CHANGE' ? 'mute.nochange' : e.message === 'INVALID_VALUE' ? 'mute.invalid' : 'compose.err.generic'), e.message === 'NO_CHANGE' ? '' : 'error'); }
  };
  const row = (label, remove) => {
    const b = el('button', { type: 'button', class: 'btn btn-small' }, t('mute.remove'));
    b.addEventListener('click', () => { b.disabled = true; remove(); });
    return el('li', { class: 'mute-item' }, el('span', {}, label), ' ', b);
  };
  const draw = () => {
    const m = muteList();
    m.pubkeys.forEach(requestProfile);
    const group = (key, items, make) => [el('h3', {}, t(key, { n: items.length })),
      items.length ? el('ul', { class: 'mute-list' }, ...items.map(make)) : el('p', { class: 'hint' }, t('mute.none'))];
    const kind = el('select', { 'aria-label': t('mute.kind') }, el('option', { value: 'word' }, t('mute.kind.word')), el('option', { value: 'hashtag' }, t('mute.kind.hashtag')));
    const input = el('input', { type: 'text', maxlength: 100, autocomplete: 'off', autocapitalize: 'off', 'aria-label': t('mute.add.label') });
    const add = el('button', { type: 'submit', class: 'btn' }, t('mute.add'));
    const form = el('form', { class: 'form' }, el('label', {}, t('mute.add.label'), input), kind, add);
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; run([{ type: 'add', kind: kind.value, value: v }]); });
    node.replaceChildren(el('h2', {}, t('mute.title')), el('p', { class: 'hint' }, t('mute.hint')),
      ...group('mute.accounts', m.pubkeys, (pk) => row(el('a', { href: `#/profile/${npubEncode(pk)}` }, nameOf(pk)), () => run([{ type: 'remove', kind: 'pubkey', value: pk }]))),
      ...group('mute.words', m.words, (w) => row(w, () => run([{ type: 'remove', kind: 'word', value: w }]))),
      ...group('mute.hashtags', m.hashtags, (h) => row(`#${h}`, () => run([{ type: 'remove', kind: 'hashtag', value: h }]))),
      ...group('mute.threads', m.events, (id) => row(`${id.slice(0, 12)}…`, () => run([{ type: 'remove', kind: 'event', value: id }]))),
      ...(getSigner() ? [form] : []), msg);
  };
  draw();
  const stop = state.on('mute', () => { if (!node.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') draw(); });
  return { node, stop };
}
