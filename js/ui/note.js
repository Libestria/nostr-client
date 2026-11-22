import { t } from '../i18n.js';
import { state } from '../state.js';
import { npubEncode } from '../nostr/nip19.js';
import { getCached, requestProfile } from '../profiles.js';
import { el, shortNpub, timeAgo } from './common.js';

// Remplit un lien d'auteur (nom + avatar) à partir du cache de profils.
export function fillAuthor(node) {
  const pk = node.dataset.pk;
  const p = getCached(pk);
  node.querySelector('.author-name').textContent = p?.displayName || p?.name || shortNpub(pk);
  const av = node.querySelector('.avatar');
  if (p?.picture && state.get('settings')?.loadMedia && !av.firstChild) {
    const img = el('img', { src: p.picture, alt: '', width: 32, height: 32, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    av.append(img);
  }
}

export function authorLink(pk) {
  requestProfile(pk);
  const a = el('a', { class: 'author', href: `#/profile/${npubEncode(pk)}`, 'data-pk': pk },
    el('span', { class: 'avatar', 'aria-hidden': 'true' }), el('span', { class: 'author-name' }, shortNpub(pk)));
  fillAuthor(a);
  return a;
}

export const updateAuthors = (root) => root.querySelectorAll('.author[data-pk]').forEach(fillAuthor);

export function noteCard(ev, { via, author = true } = {}) {
  const text = ev.content.length > 600 ? `${ev.content.slice(0, 600)}…` : ev.content;
  return el('article', { class: 'note' },
    el('div', { class: 'note-head' },
      author ? authorLink(ev.pubkey) : el('span'),
      el('time', { datetime: new Date(ev.created_at * 1000).toISOString() }, timeAgo(ev.created_at))),
    el('p', { class: 'note-text' }, text),
    via ? el('p', { class: 'note-via' }, t('note.relay', { relay: via.replace(/^wss:\/\//, '') })) : null);
}
