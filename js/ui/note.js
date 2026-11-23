import { t } from '../i18n.js';
import { state } from '../state.js';
import { npubEncode } from '../nostr/nip19.js';
import { getCached, requestProfile } from '../profiles.js';
import { getSigner } from '../auth.js';
import { tokenizeContent, noteHref } from '../nostr/content.js';
import { buildReaction, buildRepost, buildDeletion } from '../nostr/compose.js';
import { publishEvent } from '../publish.js';
import { deleteEvent } from '../storage/db.js';
import { el, shortNpub, timeAgo } from './common.js';
import { composer, showResult, errorKey } from './composer.js';
import { zapPanel, zapBadge } from './zap.js';
import { isMuted, editMute } from '../mute.js';

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

function fillMention(node) {
  const p = getCached(node.dataset.pk);
  node.textContent = `@${p?.displayName || p?.name || shortNpub(node.dataset.pk)}`;
}
export const updateAuthors = (root) => {
  root.querySelectorAll('.author[data-pk]').forEach(fillAuthor);
  root.querySelectorAll('.mention[data-pk]').forEach(fillMention);
};

// Texte d'une note : liens https, mentions, références de notes et hashtags ; le reste est du texte brut.
export function renderContent(text) {
  const media = !!state.get('settings')?.loadMedia;
  const nodes = tokenizeContent(text).map((tk) => {
    switch (tk.type) {
      case 'link': {
        const a = el('a', { href: tk.url, target: '_blank', rel: 'noopener noreferrer nofollow ugc', class: 'ext' }, tk.label.length > 40 ? `${tk.label.slice(0, 40)}…` : tk.label);
        if (!tk.image || !media) return a;
        const img = el('img', { class: 'note-img', src: tk.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => img.remove());
        return el('span', { class: 'note-media' }, a, img);
      }
      case 'mention': {
        requestProfile(tk.pubkey);
        const a = el('a', { class: 'mention', href: `#/profile/${npubEncode(tk.pubkey)}`, 'data-pk': tk.pubkey });
        fillMention(a);
        return a;
      }
      case 'note': return el('a', { class: 'note-ref', href: noteHref(tk.id) }, t('note.ref'));
      case 'hashtag': return el('span', { class: 'hashtag' }, `#${tk.tag}`);
      default: return tk.text;
    }
  });
  return nodes;
}

const done = { reacted: new Set(), reposted: new Set() };   // pour éviter les doublons dans cette session

// Boutons Répondre / J'aime / Reposter / Supprimer (uniquement avec un signeur).
function noteActions(ev, article) {
  const signer = getSigner();
  if (!signer) return null;
  const msg = el('div', { class: 'note-msg', role: 'status' });
  let busy = false;
  const btn = (key, onClick, disabled = false) => {
    const b = el('button', { type: 'button', class: 'btn btn-small' }, t(key));
    b.disabled = disabled;
    b.addEventListener('click', () => onClick(b));
    return b;
  };
  const act = async (b, build, mark, doneKey) => {
    if (busy) return;
    busy = true; b.disabled = true; msg.replaceChildren(t('lists.publishing'));
    try {
      const res = await publishEvent(build());
      showResult(msg, res, () => publishEvent(build()));
      if (res.ok) { mark?.(); b.textContent = t(doneKey); } else b.disabled = false;
    } catch (e) { msg.replaceChildren(el('span', { class: 'status status-error' }, t(errorKey(e)))); b.disabled = false; } finally { busy = false; }
  };
  let form = null;
  const reply = btn('note.reply', () => {
    if (form) { form.remove(); form = null; return; }
    form = composer({ reply: ev, onPublished: () => { form?.remove(); form = null; } });
    article.append(form);
    form.querySelector('textarea').focus();
  });
  const like = btn(done.reacted.has(ev.id) ? 'note.liked' : 'note.like', (b) => act(b, () => buildReaction(ev), () => done.reacted.add(ev.id), 'note.liked'), done.reacted.has(ev.id));
  const repost = btn(done.reposted.has(ev.id) ? 'note.reposted' : 'note.repost', (b) => act(b, () => buildRepost(ev), () => done.reposted.add(ev.id), 'note.reposted'), done.reposted.has(ev.id));
  const row = el('div', { class: 'note-actions' }, reply, like, repost);
  if (ev.pubkey !== signer.pubkey) {
    const hide = btn('mute.account', async (b) => {
      b.disabled = true; msg.replaceChildren(t('lists.publishing'));
      try {
        const res = await editMute([{ type: 'add', kind: 'pubkey', value: ev.pubkey }]);
        if (res.ok) article.replaceChildren(el('p', { class: 'hint' }, t('mute.done')));
        else { b.disabled = false; msg.replaceChildren(t('lists.publish.failed', { ok: res.ok, total: res.total })); }
      } catch { b.disabled = false; msg.replaceChildren(t('compose.err.generic')); }
    });
    row.append(hide);
    let panel = null;
    row.append(btn('note.zap', () => {
      if (panel) { panel.remove(); panel = null; return; }
      panel = zapPanel({ recipient: ev.pubkey, event: ev, onClose: () => { panel = null; } });
      article.append(panel);
    }));
  }
  if (ev.pubkey === signer.pubkey) {
    let armed = false;
    const del = btn('note.delete', async (b) => {
      if (!armed) { armed = true; b.textContent = t('note.delete.confirm'); msg.replaceChildren(t('note.delete.hint')); return; }
      if (busy) return;
      busy = true; b.disabled = true; msg.replaceChildren(t('lists.publishing'));
      try {
        const res = await publishEvent(buildDeletion(ev, signer.pubkey));
        showResult(msg, res, () => publishEvent(buildDeletion(ev, signer.pubkey)));
        if (res.ok) { deleteEvent(ev.id); article.classList.add('note-deleted'); article.replaceChildren(el('p', { class: 'hint' }, t('note.deleted'))); }
        else { armed = false; b.disabled = false; b.textContent = t('note.delete'); }
      } catch (e) { msg.replaceChildren(el('span', { class: 'status status-error' }, t(errorKey(e)))); armed = false; b.disabled = false; b.textContent = t('note.delete'); } finally { busy = false; }
    });
    row.append(del);
  }
  return [row, msg];
}

// Note masquée (sourdine) : un bandeau avec la raison et un bouton pour l'afficher quand même.
export function noteCard(ev, opts = {}) {
  const reason = opts.force ? null : isMuted(ev);
  if (!reason) return buildNoteCard(ev, opts);
  const box = el('article', { class: 'note note-muted' });
  const show = el('button', { type: 'button', class: 'btn btn-small' }, t('mute.show'));
  show.addEventListener('click', () => box.replaceWith(buildNoteCard(ev, opts)));
  box.append(el('p', { class: 'hint' }, t(`mute.hidden.${reason}`), ' ', show));
  return box;
}

function buildNoteCard(ev, { via, author = true } = {}) {
  const text = ev.content.length > 600 ? `${ev.content.slice(0, 600)}…` : ev.content;
  const article = el('article', { class: 'note' },
    el('div', { class: 'note-head' },
      author ? authorLink(ev.pubkey) : el('span'),
      el('a', { class: 'note-time', href: noteHref(ev.id), 'aria-label': t('note.open') },
        el('time', { datetime: new Date(ev.created_at * 1000).toISOString() }, timeAgo(ev.created_at)))),
    el('p', { class: 'note-text' }, ...renderContent(text)),
    el('p', { class: 'note-zaps' }, zapBadge(ev)),
    via ? el('p', { class: 'note-via' }, t('note.relay', { relay: via.replace(/^wss:\/\//, '') })) : null);
  const actions = noteActions(ev, article);
  if (actions) article.append(...actions);
  return article;
}
