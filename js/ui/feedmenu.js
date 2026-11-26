// Liste déroulante des fils de l'accueil, dans la barre fixe du haut (à la place du titre) : bouton « nom du fil + chevron rond »
// qui ouvre une fenêtre « verre » en haut de l'écran (même style que le menu « … » des notes). Les fils sont des itinéraires (#/feed…),
// ce qui permettra d'en ajouter de personnalisés plus tard sans changer ce module.
import { t } from '../i18n.js';
import { el, returnFocus } from './common.js';
import { icon } from './icons.js';

let current = null;   // { feeds, activeId } du fil affiché

// Balayage horizontal : fil voisin (dir = +1 suivant, -1 précédent) → href, ou null hors de l'accueil
export function feedNeighbor(dir) {
  if (!current || !document.querySelector('.feed-switch')) return null;
  const i = current.feeds.findIndex((f) => f.id === current.activeId);
  return current.feeds[i + dir]?.href ?? null;
}

// feeds : [{ id, label, href, icon }] ; activeId : fil affiché
export function mountFeedSwitcher(feeds, activeId) {
  const bar = document.querySelector('.topbar-title');
  if (!bar) return;
  const active = feeds.find((f) => f.id === activeId) ?? feeds[0];
  current = { feeds, activeId: active.id };
  const btn = el('button', { type: 'button', class: 'feed-switch', 'aria-haspopup': 'dialog', 'aria-label': `${t('feed.switch')} : ${active.label}` },
    el('span', {}, active.label), el('span', { class: 'feed-chevron', 'aria-hidden': 'true' }, icon('down', 16)));
  bar.replaceChildren(btn);
  bar.classList.add('interactive');
  bar.removeAttribute('aria-hidden');
  btn.addEventListener('click', () => openFeedMenu(feeds, active.id, btn));
}

function openFeedMenu(feeds, activeId, opener) {
  const dlg = el('dialog', { class: 'note-menu feed-menu', 'aria-label': t('feed.menu'), tabindex: '-1', autofocus: '' });
  const close = el('button', { type: 'button', class: 'sheet-x', 'aria-label': t('shell.menu.close') }, '✕');
  close.addEventListener('click', () => dlg.close());
  const list = el('ul', { class: 'drawer-list nm-list' });
  for (const f of feeds) {
    const on = f.id === activeId;
    const a = el('a', { href: f.href, 'aria-current': on ? 'true' : false }, icon(f.icon, 20), el('span', {}, f.label), on ? el('span', { class: 'nm-check' }, icon('check', 20)) : null);
    a.addEventListener('click', () => dlg.close());
    list.append(el('li', {}, a));
  }
  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, t('feed.menu')), close), list);
  dlg.addEventListener('close', () => { dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}
