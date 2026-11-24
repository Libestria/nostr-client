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
import { zapPanel } from './zap.js';
import { watchZaps } from '../zap.js';
import { watchStats, bumpStat } from '../stats.js';
import { isBookmarked, setBookmark } from '../bookmarks.js';
import { compact } from '../nostr/stats.js';
import { icon } from './icons.js';
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

// Bouton-icône avec compteur. Sans signeur (lecture seule), c'est un simple affichage.
function actionItem({ name, label, interactive, onClick }) {
  const count = el('span', { class: 'act-count' });
  const text = el('span', { class: 'act-label' });
  const kids = [icon(name), count, text];
  const node = interactive ? el('button', { type: 'button', class: `act act-${name}`, 'aria-label': label, title: label }, ...kids)
    : el('span', { class: `act act-${name} act-static`, title: label, role: 'img', 'aria-label': label }, ...kids);
  if (interactive) node.addEventListener('click', () => onClick(node));
  const setCount = (txt, spoken) => {
    count.textContent = txt;
    const full = txt ? `${label}, ${spoken ?? txt}` : label;
    node.setAttribute('aria-label', full); node.title = full;
  };
  return { node, setCount, text };
}

// Ligne de compteurs au-dessus des boutons (note ouverte) : réactions, reposts, citations, zaps.
function statsRow() {
  const cell = (key) => { const n = el('span', { class: 'stat-n' }, '0'); const lbl = el('span', {}, t(`note.stat.${key}`)); return { n, lbl, key, node: el('span', { class: 'stat' }, n, ' ', lbl) }; };
  const show = (c, v) => { c.n.textContent = String(v); c.lbl.textContent = t(`note.stat.${c.key}${v === 1 ? '.one' : ''}`); };
  const c = { reactions: cell('reactions'), reposts: cell('reposts'), quotes: cell('quotes'), zaps: cell('zaps') };
  return { node: el('div', { class: 'note-stats' }, c.reactions.node, c.reposts.node, c.quotes.node, c.zaps.node), c, show };
}

// Liste de tous les zaps reçus par la note : expéditeur, montant et message (texte brut).
function zapList() {
  const box = el('section', { class: 'zap-list', 'aria-label': t('zaps.title'), hidden: true });
  const fill = (list) => {
    box.hidden = !list.length;
    box.replaceChildren(...list.slice(0, 200).map((z) => el('div', { class: 'zap-item' },
      el('div', { class: 'zap-item-head' }, authorLink(z.from), el('span', { class: 'zap-item-sats' }, `⚡ ${compact(z.sats, document.documentElement.lang || 'fr') || z.sats} sats`)),
      z.comment ? el('p', { class: 'zap-item-msg' }, z.comment) : null)));
  };
  return { node: box, fill };
}

// Répondre / Reposter / J'aime / Zap, puis Masquer ou Supprimer. Les compteurs s'affichent même sans signeur.
function noteActions(ev, article, detail) {
  const signer = getSigner();
  const live = !!signer;
  const msg = el('div', { class: 'note-msg', role: 'status' });
  let busy = false;
  const act = async (b, build, mark, doneKey) => {
    if (busy) return;
    busy = true; b.disabled = true; msg.replaceChildren(t('lists.publishing'));
    try {
      const res = await publishEvent(build());
      showResult(msg, res, () => publishEvent(build()));
      if (res.ok) mark?.(); else b.disabled = false;
    } catch (e) { msg.replaceChildren(el('span', { class: 'status status-error' }, t(errorKey(e)))); b.disabled = false; } finally { busy = false; }
  };
  let form = null;
  const reply = actionItem({ name: 'reply', label: t('note.reply'), interactive: live, onClick: () => {
    if (form) { form.remove(); form = null; return; }
    form = composer({ reply: ev, onPublished: () => { form?.remove(); form = null; bumpStat(ev.id, 'replies'); } });
    article.append(form);
    form.querySelector('textarea').focus();
  } });
  const repost = actionItem({ name: 'repost', label: t('note.repost'), interactive: live, onClick: (b) => act(b, () => buildRepost(ev),
    () => { done.reposted.add(ev.id); bumpStat(ev.id, 'reposts'); }) });
  const like = actionItem({ name: 'like', label: t('note.like'), interactive: live, onClick: (b) => act(b, () => buildReaction(ev),
    () => { done.reacted.add(ev.id); bumpStat(ev.id, 'reactions'); }) });
  let panel = null;
  const zap = actionItem({ name: 'zap', label: t('note.zap'), interactive: live && ev.pubkey !== signer?.pubkey, onClick: () => {
    if (panel) { panel.remove(); panel = null; return; }
    panel = zapPanel({ recipient: ev.pubkey, event: ev, onClose: () => { panel = null; } });
    article.append(panel);
  } });
  const row = el('div', { class: 'note-actions' }, reply.node, repost.node, like.node, zap.node);

  const lang = document.documentElement.lang || 'fr';
  const stats = detail ? statsRow() : null;
  const zl = detail ? zapList() : null;
  const markOn = (item, on, doneLabel) => {
    item.node.classList.toggle('act-on', on);
    if (live && item.node.tagName === 'BUTTON') { item.node.disabled = on; item.node.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (on) item.node.title = doneLabel;
  };
  markOn(like, done.reacted.has(ev.id), t('note.liked'));
  markOn(repost, done.reposted.has(ev.id), t('note.reposted'));
  watchStats(ev.id, (s) => {
    reply.setCount(compact(s.replies, lang), String(s.replies));
    repost.setCount(compact(s.reposts, lang), String(s.reposts));
    like.setCount(compact(s.reactions, lang), String(s.reactions));
    markOn(like, s.reacted || done.reacted.has(ev.id), t('note.liked'));
    markOn(repost, s.reposted || done.reposted.has(ev.id), t('note.reposted'));
    if (stats) {
      stats.show(stats.c.reactions, s.reactions); stats.show(stats.c.reposts, s.reposts); stats.show(stats.c.quotes, s.quotes);
    }
  });
  watchZaps(ev, ({ sats, count, list }) => {
    zl?.fill(list ?? []);
    zap.setCount(count ? `${compact(sats, lang)} sats` : '', t('zap.count', { n: count }));
    if (stats) stats.show(stats.c.zaps, count);
  });

  if (signer) {
    const fav = actionItem({ name: 'bookmark', label: t('bookmark.add'), interactive: true, onClick: async (b) => {
      if (busy) return;
      busy = true; b.disabled = true; msg.replaceChildren(t('lists.publishing'));
      const target = !isBookmarked(ev.id);
      try {
        const res = await setBookmark(ev.id, target);
        if (res.ok) msg.replaceChildren(); else msg.replaceChildren(t('lists.publish.failed', { ok: res.ok, total: res.total }));
      } catch (e) { msg.replaceChildren(el('span', { class: 'status status-error' }, t(e?.message === 'NOT_LOADED' ? 'bookmark.notLoaded' : 'compose.err.generic'))); } finally { busy = false; b.disabled = false; paintFav(); }
    } });
    const paintFav = () => {
      const on = isBookmarked(ev.id);
      fav.node.classList.toggle('act-on', on);
      fav.node.setAttribute('aria-pressed', on ? 'true' : 'false');
      const label = t(on ? 'bookmark.remove' : 'bookmark.add');
      fav.node.setAttribute('aria-label', label); fav.node.title = label;
    };
    paintFav();
    const stop = state.on('bookmarks', () => { if (fav.node.isConnected) paintFav(); else stop(); });
    row.append(fav.node);
  }
  if (signer && ev.pubkey !== signer.pubkey) {
    const hide = actionItem({ name: 'mute', label: t('mute.account'), interactive: true, onClick: async (b) => {
      b.disabled = true; msg.replaceChildren(t('lists.publishing'));
      try {
        const res = await editMute([{ type: 'add', kind: 'pubkey', value: ev.pubkey }]);
        if (res.ok) article.replaceChildren(el('p', { class: 'hint' }, t('mute.done')));
        else { b.disabled = false; msg.replaceChildren(t('lists.publish.failed', { ok: res.ok, total: res.total })); }
      } catch { b.disabled = false; msg.replaceChildren(t('compose.err.generic')); }
    } });
    row.append(hide.node);
  }
  if (signer && ev.pubkey === signer.pubkey) {
    let armed = false;
    const del = actionItem({ name: 'trash', label: t('note.delete'), interactive: true, onClick: async (b) => {
      if (!armed) { armed = true; del.text.textContent = t('note.delete.confirm'); b.classList.add('act-warn'); msg.replaceChildren(t('note.delete.hint')); return; }
      if (busy) return;
      busy = true; b.disabled = true; msg.replaceChildren(t('lists.publishing'));
      try {
        const res = await publishEvent(buildDeletion(ev, signer.pubkey));
        showResult(msg, res, () => publishEvent(buildDeletion(ev, signer.pubkey)));
        if (res.ok) { deleteEvent(ev.id); article.classList.add('note-deleted'); article.replaceChildren(el('p', { class: 'hint' }, t('note.deleted'))); }
        else { armed = false; b.disabled = false; del.text.textContent = ''; b.classList.remove('act-warn'); }
      } catch (e) { msg.replaceChildren(el('span', { class: 'status status-error' }, t(errorKey(e)))); armed = false; b.disabled = false; del.text.textContent = ''; b.classList.remove('act-warn'); } finally { busy = false; }
    } });
    row.append(del.node);
  }
  return [stats?.node ?? null, zl?.node ?? null, row, msg];
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

function buildNoteCard(ev, { via, author = true, detail = false } = {}) {
  const text = ev.content.length > 600 ? `${ev.content.slice(0, 600)}…` : ev.content;
  const article = el('article', { class: 'note' },
    el('div', { class: 'note-head' },
      author ? authorLink(ev.pubkey) : el('span'),
      el('a', { class: 'note-time', href: noteHref(ev.id), 'aria-label': t('note.open') },
        el('time', { datetime: new Date(ev.created_at * 1000).toISOString() }, timeAgo(ev.created_at)))),
    el('p', { class: 'note-text' }, ...renderContent(text)),
    via ? el('p', { class: 'note-via' }, t('note.relay', { relay: via.replace(/^wss:\/\//, '') })) : null);
  const actions = noteActions(ev, article, detail);
  article.append(...actions.filter(Boolean));
  return article;
}
