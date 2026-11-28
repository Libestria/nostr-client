import { t } from '../i18n.js';
import { state } from '../state.js';
import { npubEncode } from '../nostr/nip19.js';
import { getCached, requestProfile } from '../profiles.js';
import { getSigner } from '../auth.js';
import { tokenizeContent, noteHref, quoteRefs } from '../nostr/content.js';
import { replyInfo } from '../nostr/noteinfo.js';
import { fetchRef } from '../embed.js';
import { buildReaction, buildRepost } from '../nostr/compose.js';
import { publishEvent } from '../publish.js';
import { el, shortNpub, fullAgo, clientName } from './common.js';
import { profilePill } from './pill.js';
import { checkNip05, cachedNip05 } from '../nip05check.js';
import { composer, showResult, errorKey } from './composer.js';
import { zapPanel } from './zap.js';
import { watchZaps } from '../zap.js';
import { watchStats, bumpStat } from '../stats.js';
import { isBookmarked, setBookmark } from '../bookmarks.js';
import { compact } from '../nostr/stats.js';
import { icon } from './icons.js';
import { openStatsDialog } from './statsdialog.js';
import { openNoteMenu } from './notemenu.js';
import { mediaBox } from './media.js';
import { isMuted } from '../mute.js';
import { getPreview, previewsEnabled } from '../linkpreview.js';
import { previewLinkUrls } from '../nostr/linkpreview.js';
import { ARTICLE_KIND, articleMeta } from '../nostr/article.js';

// Remplit un lien d'auteur (nom + avatar) à partir du cache de profils.
export function fillAuthor(node) {
  const pk = node.dataset.pk;
  const p = getCached(pk);
  node.querySelector('.author-name').textContent = p?.displayName || p?.name || shortNpub(pk);
  const av = node.querySelector('.avatar');
  if (av && !av.hidden && p?.picture && state.get('settings')?.loadMedia && !av.firstChild) {
    const img = el('img', { src: p.picture, alt: '', width: 32, height: 32, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    av.append(img);
  }
}

// Avatar seul (rond) pour les listes ; se met à jour avec updateAuthors().
export function fillAvatar(av) {
  const p = getCached(av.dataset.av);
  if (p?.picture && state.get('settings')?.loadMedia && !av.firstChild) {
    const img = el('img', { src: p.picture, alt: '', width: 44, height: 44, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    av.append(img);
  }
}
export function avatarNode(pk) {
  requestProfile(pk);
  const av = el('span', { class: 'avatar avatar-md', 'aria-hidden': 'true', 'data-av': pk });
  fillAvatar(av);
  return av;
}

export function authorLink(pk) {
  requestProfile(pk);
  const a = el('a', { class: 'author', href: `#/profile/${npubEncode(pk)}`, 'data-pk': pk },
    el('span', { class: 'avatar', 'aria-hidden': 'true' }), el('span', { class: 'author-name' }, shortNpub(pk)));
  fillAuthor(a);
  return a;
}

// NIP-05 sous le nom : vert si vérifié, rouge si non vérifié (autre clé, inconnu ou domaine injoignable),
// gris pendant la vérification ; « Aucun NIP-05 renseigné » en gris quand le profil n'en a pas.
function nip05Line(pk) {
  const line = el('span', { class: 'nip05-line', 'data-pk': pk });
  const paint = () => {
    const p = getCached(pk);
    const id = p?.nip05;
    if (!p) { line.className = 'nip05-line n05-wait'; line.textContent = '\u00a0'; line.removeAttribute('title'); return; }   // profil pas encore reçu : on n'affiche rien (pas de « Aucun NIP-05 » à tort)
    if (typeof id !== 'string' || !id.trim()) {
      line.className = 'nip05-line n05-none'; line.textContent = t('nip05.none'); line.removeAttribute('title'); line.removeAttribute('data-id');
      return;
    }
    const shown = id.startsWith('_@') ? id.slice(2) : id;
    const st = cachedNip05(pk, id);
    const kind = st === 'ok' ? 'ok' : st ? 'bad' : 'checking';
    line.className = `nip05-line n05-${kind}`;
    line.textContent = shown.length > 40 ? `${shown.slice(0, 40)}…` : shown;
    line.title = t(`nip05.${st ?? 'checking'}`);
    if (!st && state.get('settings')?.loadMedia !== false && line.dataset.id !== id) {
      line.dataset.id = id;
      checkNip05(pk, id).then(() => { if (line.isConnected) paint(); });
    }
  };
  line._paint = paint;
  paint();
  return line;
}

// En-tête : grand avatar ; à sa droite le nom, le NIP-05 puis la ligne de temps (`meta`), alignés avec l'avatar.
function authorBlock(pk, meta) {
  requestProfile(pk);
  const href = `#/profile/${npubEncode(pk)}`;
  const av = el('span', { class: 'avatar avatar-note', 'aria-hidden': 'true' });
  const name = el('span', { class: 'author-name' });
  const block = el('div', { class: 'author author-block', 'data-pk': pk },
    el('a', { href, tabindex: '-1', 'aria-hidden': 'true', 'aria-label': t('nav.profile'), class: 'author-av' }, av),
    el('div', { class: 'author-text' }, el('a', { class: 'author-link', href }, name), nip05Line(pk), meta));
  block._fill = () => {
    const p = getCached(pk);
    name.textContent = p?.displayName || p?.name || shortNpub(pk);
    if (p?.picture && state.get('settings')?.loadMedia && !av.firstChild) {
      const img = el('img', { src: p.picture, alt: '', width: 56, height: 56, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      av.append(img);
    }
    block.querySelector('.nip05-line')?._paint?.();
  };
  block._fill();
  return block;
}

function fillMention(node) {
  const p = getCached(node.dataset.pk);
  node.textContent = `@${p?.displayName || p?.name || shortNpub(node.dataset.pk)}`;
}
export const updateAuthors = (root) => {
  root.querySelectorAll('.author[data-pk]').forEach((n) => (n._fill ? n._fill() : fillAuthor(n)));
  root.querySelectorAll('.avatar[data-av]').forEach(fillAvatar);
  root.querySelectorAll('.mention[data-pk]').forEach(fillMention);
  root.querySelectorAll('.who[data-pk]').forEach((n) => { const p = getCached(n.dataset.pk); n.textContent = p?.displayName || p?.name || shortNpub(n.dataset.pk); });
};

// Texte d'une note : liens https, mentions, références de notes et hashtags ; le reste est du texte brut.
export function renderContent(text, opts = {}) { return renderTokens(tokenizeContent(text), opts); }

function renderTokens(tokens, { hideRefs = false } = {}) {
  const media = !!state.get('settings')?.loadMedia;
  const nodes = tokens.map((tk) => {
    switch (tk.type) {
      case 'link': {
        const a = el('a', { href: tk.url, target: '_blank', rel: 'noopener noreferrer nofollow ugc', class: 'ext' }, tk.label.length > 40 ? `${tk.label.slice(0, 40)}…` : tk.label);
        if (tk.video) return media ? mediaBox(tk.url, 'video', a) : a;
        return tk.image && media ? mediaBox(tk.url, 'image', a) : a;
      }
      case 'mention': {
        requestProfile(tk.pubkey);
        const a = el('a', { class: 'mention', href: `#/profile/${npubEncode(tk.pubkey)}`, 'data-pk': tk.pubkey });
        fillMention(a);
        return a;
      }
      case 'note': return hideRefs ? null : el('a', { class: 'note-ref', href: noteHref(tk.id) }, t('note.ref'));
      case 'addr': return hideRefs ? null : t('note.ref');
      case 'hashtag': return el('span', { class: 'hashtag' }, `#${tk.tag}`);
      default: return tk.text;
    }
  });
  return nodes;
}

const done = { reacted: new Set(), reposted: new Set() };   // pour éviter les doublons dans cette session

// Bouton-icône avec compteur. Sans signeur, c'est un simple affichage.
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

// Ligne de statistiques au-dessus des boutons (note ouverte) : chaque statistique ouvre une fenêtre de détail.
function statsRow(onOpen) {
  const cell = (key) => {
    const n = el('span', { class: 'stat-n' }, '0');
    const lbl = el('span', {}, t(`note.stat.${key}`));
    const node = el('button', { type: 'button', class: 'stat', 'aria-haspopup': 'dialog' }, n, ' ', lbl);
    node.addEventListener('click', () => onOpen(key, node));
    return { n, lbl, key, node };
  };
  const show = (c, v) => { c.n.textContent = String(v); c.lbl.textContent = t(`note.stat.${c.key}${v === 1 ? '.one' : ''}`); };
  const c = { reactions: cell('reactions'), reposts: cell('reposts'), quotes: cell('quotes'), zaps: cell('zaps') };
  return { node: el('div', { class: 'note-stats' }, c.reactions.node, c.reposts.node, c.quotes.node, c.zaps.node), c, show };
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
  const data = { reactors: [], reposters: [], quoted: [], zaps: [] };
  let open = null;   // fenêtre de détail ouverte : { key, update }
  const stats = detail ? statsRow((key, opener) => { open = { key, ...openStatsDialog(key, () => data, opener) }; }) : null;
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
    Object.assign(data, { reactors: s.reactors, reposters: s.reposters, quoted: s.quoted });
    if (open && open.key !== 'zaps') open.update();
    if (stats) {
      stats.show(stats.c.reactions, s.reactions); stats.show(stats.c.reposts, s.reposts); stats.show(stats.c.quotes, s.quotes);
    }
  });
  watchZaps(ev, ({ sats, count, list }) => {
    data.zaps = list ?? [];
    if (open?.key === 'zaps') open.update();
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
        if (res.ok) msg.replaceChildren(); else msg.replaceChildren(el('span', { class: 'status status-error' }, t('lists.publish.failed', { ok: res.ok, total: res.total })));
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
  return [stats?.node ?? null, row, msg];
}

// Carte d'une note ou d'un article cité (nostr:nevent, note, naddr) : compacte, sans citations imbriquées.
function quoteSlot(ref) {
  const slot = el('div', { class: 'quote-slot' }, el('p', { class: 'hint' }, t('note.quote.loading')));
  fetchRef(ref).then((ev) => {
    if (!slot.isConnected) return;
    if (!ev || isMuted(ev)) { slot.replaceChildren(el('a', { class: 'note-ref', href: ref.id ? noteHref(ref.id) : '#/feed' }, t('note.ref'))); return; }
    if (ev.kind === ARTICLE_KIND) { slot.replaceChildren(...articleCard(ev, false)); updateAuthors(slot); return; }
    const body = ev.content.length > 280 ? `${ev.content.slice(0, 280)}…` : ev.content;
    slot.replaceChildren(el('a', { class: 'quote-card', href: noteHref(ev.id) },
      el('span', { class: 'quote-head' }, authorBlockSmall(ev.pubkey), el('time', { datetime: new Date(ev.created_at * 1000).toISOString() }, fullAgo(ev.created_at, undefined, t('time.now')))),
      el('span', { class: 'quote-text' }, ...renderContent(body, { hideRefs: true }))));
    updateAuthors(slot);
  });
  return el('div', { class: 'quotes' }, slot);
}

// Corps d'une note : le texte et les contenus insérés (images, cartes des notes citées, aperçu de chaque lien) dans l'ordre
// exact où l'auteur les a placés. Un contenu inséré coupe le texte en paragraphes.
function renderBody(text) {
  const tokens = tokenizeContent(text);
  const cards = new Map(quoteRefs(tokens).map((r) => [r.id ?? `${r.kind}:${r.pubkey}:${r.identifier}`, r]));
  const keyOf = (tk) => (tk.type === 'note' ? tk.id : `${tk.kind}:${tk.pubkey}:${tk.identifier}`);
  const previewUrls = new Set(previewsEnabled() ? previewLinkUrls(tokens) : []);
  const out = [];
  let inline = [];
  // Chaque ligne vide laissée par l'auteur sépare deux paragraphes ; l'écart entre blocs est géré par le CSS (8 px partout)
  const flush = () => {
    const paras = [[]];
    for (const n of inline) {
      if (typeof n !== 'string') { paras[paras.length - 1].push(n); continue; }
      n.split(/\r?\n[ \t]*\r?\n\s*/).forEach((part, i) => { if (i > 0) paras.push([]); if (part) paras[paras.length - 1].push(part); });
    }
    for (const nodes of paras) {
      if (typeof nodes[0] === 'string') nodes[0] = nodes[0].replace(/^\s+/, '');
      const last = nodes.length - 1;
      if (last >= 0 && typeof nodes[last] === 'string') nodes[last] = nodes[last].replace(/\s+$/, '');
      if (nodes.some((n) => n !== '' && n != null)) out.push(el('p', { class: 'note-text' }, ...nodes));
    }
    inline = [];
  };
  const media = !!state.get('settings')?.loadMedia;
  const shown = new Set();
  for (const tk of tokens) {
    if ((tk.type === 'note' || tk.type === 'addr') && cards.has(keyOf(tk))) {
      const k = keyOf(tk);
      if (shown.has(k)) continue;   // doublon : une seule carte
      shown.add(k);
      flush(); out.push(quoteSlot(cards.get(k)));
    } else if (tk.type === 'link' && (tk.image || tk.video) && media) {
      flush(); out.push(...renderTokens([tk]));
    } else {
      inline.push(...renderTokens([tk], { hideRefs: false }));
      if (tk.type === 'link' && !tk.image && !tk.video && previewUrls.delete(tk.url)) { flush(); out.push(linkCard(tk.url)); }
    }
  }
  flush();
  return out.filter(Boolean);
}

function authorBlockSmall(pk) {
  requestProfile(pk);
  const av = el('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true', 'data-av': pk });
  fillAvatar(av);
  return el('span', { class: 'quote-author' }, av, el('strong', { class: 'who', 'data-pk': pk }, shortNpub(pk)));
}

// Ligne au-dessus d'une note : « [pastille] a reposté » ou « En réponse à [pastille] ».
function contextLine(ev, repostedBy, detail) {
  // Indication réduite à l'icône et à la pilule de l'auteur ; le texte (« a reposté » / « a répondu à ») reste lisible pour les lecteurs d'écran
  if (repostedBy) return el('p', { class: 'note-context' }, icon('repost', 20), profilePill(repostedBy, `#/profile/${npubEncode(repostedBy)}`), el('span', { class: 'sr-only' }, t('note.reposted')));
  const r = !detail && replyInfo(ev);
  if (!r) return null;
  return el('p', { class: 'note-context' }, icon('reply', 20), profilePill(ev.pubkey, `#/profile/${npubEncode(ev.pubkey)}`), el('span', { class: 'sr-only' }, t('note.replyTo')));
}

// Carte d'aperçu d'un lien web de la note (jusqu'à 5 par note) : image en haut, titre puis description. Absente si le service n'a rien renvoyé.
function linkCard(url) {
  const slot = el('div', { class: 'link-card-slot' });
  getPreview(url).then((p) => {
    if (!p || !slot.isConnected) return;
    const body = el('div', { class: 'lc-body' }, p.title ? el('strong', { class: 'lc-title' }, p.title) : null,
      p.description ? el('span', { class: 'lc-desc' }, p.description) : null, p.host ? el('span', { class: 'lc-host' }, p.host) : null);
    let img = null;
    if (p.image) { img = el('img', { class: 'lc-img', src: p.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }); img.addEventListener('error', () => img.remove()); }
    slot.append(el('a', { class: 'link-card', href: url, target: '_blank', rel: 'noopener noreferrer nofollow ugc', 'aria-label': `${t('link.preview')} : ${p.title || p.host}` }, img, body));
  });
  return slot;
}

// Article long (NIP-23) : image en haut, titre, résumé, puces de thèmes ; ouvert, il affiche aussi le texte.
function articleCard(ev, detail) {
  const m = articleMeta(ev);
  const media = state.get('settings')?.loadMedia !== false;
  let img = null;
  if (m.image && media) { img = el('img', { class: 'lc-img', src: m.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }); img.addEventListener('error', () => img.remove()); }
  const chips = m.tags.length ? el('ul', { class: 'chips' }, ...m.tags.map((x) => el('li', {}, x))) : null;
  const body = el('div', { class: 'lc-body' }, el('strong', { class: 'lc-title lc-title-big' }, m.title || t('article.untitled')),
    m.summary ? el('span', { class: 'lc-desc' }, m.summary) : null, chips);
  const card = el(detail ? 'div' : 'a', { class: 'link-card article-card', ...(detail ? {} : { href: noteHref(ev.id), 'aria-label': m.title || t('article.untitled') }) }, img, body);
  return detail ? [card, el('div', { class: 'article-body' }, ...renderContent(ev.content.slice(0, 20000)))] : [card];
}

// « Il y a 21 secondes » ; « À l'instant » reste seul.
function agoLabel(ts) {
  const now = t('time.now'), v = fullAgo(ts, undefined, now);
  return v === now ? v : t('time.ago', { t: v });
}

// Note masquée (sourdine) : un bandeau avec la raison et un bouton pour l'afficher quand même.
// Réponse dans un fil : indication « En réponse à », note parente en ligne compacte reliée par un trait à la réponse.
// La parente est chargée à part ; si elle est introuvable ou masquée, seule la réponse s'affiche.
function replyChain(ev, r, opts) {
  const slot = el('div', { class: 'chain-slot' });
  const card = buildNoteCard(ev, { ...opts, context: false });
  const box = el('div', { class: 'note-chain' }, contextLine(ev, null, false), slot, card);
  fetchRef({ id: r.parentId }).then((parent) => {
    if (!parent || parent.kind !== 1 || isMuted(parent)) return;
    const row = buildNoteCard(parent, { nested: { row: true } });
    row.classList.add('link-next');
    slot.replaceChildren(row);
    card.classList.add('link-prev');
    updateAuthors(box);
  });
  return box;
}

export function noteCard(ev, opts = {}) {
  const reason = opts.force ? null : isMuted(ev);
  if (!reason) {
    const r = opts.parent && !opts.repostedBy && !opts.detail && ev.kind === 1 ? replyInfo(ev) : null;
    return r ? replyChain(ev, r, opts) : buildNoteCard(ev, opts);
  }
  const box = el('article', { class: 'note note-muted' });
  const show = el('button', { type: 'button', class: 'btn btn-small' }, t('mute.show'));
  show.addEventListener('click', () => box.replaceWith(buildNoteCard(ev, opts)));
  box.append(el('p', { class: 'hint' }, t(`mute.hidden.${reason}`), ' ', show));
  return box;
}

// Options : detail (note ouverte), repostedBy, nested ({ row: true } : ligne compacte du fil plat ou note parente, contenu décalé,
// sans barre d'actions), actions (barre d'actions), context (ligne « a reposté » / « En réponse à »).
function buildNoteCard(ev, { via, author = true, detail = false, repostedBy = null, nested, actions: withActions = true, context = true } = {}) {
  const row = !!nested?.row;
  const indent = row;
  const moreBtn = el('button', { type: 'button', class: 'note-more', 'aria-haspopup': 'dialog', 'aria-label': t('menu.note.more'), title: t('menu.note.more') }, icon('more', 20));
  const openBtn = el('a', { class: 'note-open', href: noteHref(ev.id), 'aria-label': t('note.open'), title: t('note.open') }, icon('thread', 18));
  const text = ev.content;   // contenu affiché en intégralité (flux comme fil)
  const client = clientName(ev);
  const meta = el('p', { class: 'note-meta' },
    el('time', { class: 'note-time', datetime: new Date(ev.created_at * 1000).toISOString() }, agoLabel(ev.created_at)),
    client ? el('span', { class: 'note-client' }, ` ${t('note.via', { client })}`) : null);
  const body = [el('div', { class: 'note-body' }, ...(ev.kind === ARTICLE_KIND ? articleCard(ev, detail) : renderBody(text)))];
  const article = el('article', { class: ['note', detail ? 'note-detail' : '', row ? 'note-row' : ''].filter(Boolean).join(' ') },
    context ? contextLine(ev, repostedBy, detail || row) : null,
    el('div', { class: 'note-head' }, author ? authorBlock(ev.pubkey, meta) : el('span'), detail ? null : openBtn, moreBtn),
    author ? null : meta,
    ...(indent ? [el('div', { class: 'note-content' }, ...body)] : body));
  moreBtn.addEventListener('click', () => openNoteMenu(ev, { via, opener: moreBtn,
    onHidden: (key) => article.replaceChildren(el('p', { class: 'hint' }, t(key))),
    onDeleted: () => { article.classList.add('note-deleted'); article.replaceChildren(el('p', { class: 'hint' }, t('note.deleted'))); } }));
  if (withActions && !row) article.append(...noteActions(ev, article, detail).filter(Boolean));
  return article;
}
