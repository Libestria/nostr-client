// Fenêtre (dialog natif, focus piégé et Échap gérés par le navigateur) listant le détail d'une statistique d'une note.
import { t } from '../i18n.js';
import { onProfiles } from '../profiles.js';
import { noteHref } from '../nostr/content.js';
import { el, timeAgo } from './common.js';
import { authorLink, updateAuthors, renderContent } from './note.js';
import { compact } from '../nostr/stats.js';

const MAX_SHOWN = 200;
const lang = () => document.documentElement.lang || 'fr';

const row = (from, right, body) => el('li', { class: 'sd-item' },
  el('div', { class: 'sd-head' }, authorLink(from), right ? el('span', { class: 'sd-right' }, right) : null), body ?? null);

const BUILDERS = {
  reactions: (d) => d.reactors.map((r) => row(r.from, r.emoji === '+' ? '♥' : r.emoji)),
  reposts: (d) => d.reposters.map((r) => row(r.from, timeAgo(r.at))),
  quotes: (d) => d.quoted.map((e) => row(e.pubkey, el('a', { href: noteHref(e.id) }, t('note.open')),
    el('p', { class: 'sd-text' }, ...renderContent(e.content.length > 280 ? `${e.content.slice(0, 280)}…` : e.content)))),
  zaps: (d) => d.zaps.map((z) => row(z.from, `⚡ ${compact(z.sats, lang()) || z.sats} sats`, z.comment ? el('p', { class: 'sd-text' }, z.comment) : null)),
};

// key : 'reactions' | 'reposts' | 'quotes' | 'zaps' ; getData() → données à jour. Retourne { update } pour rafraîchir à l'arrivée de nouvelles données.
export function openStatsDialog(key, getData, opener) {
  const list = el('ul', { class: 'sd-list' });
  const title = el('h2', { id: `sd-title-${key}` }, t(`note.stat.${key}`));
  const close = el('button', { type: 'button', class: 'sheet-x', 'aria-label': t('zap.close') }, '✕');
  const dlg = el('dialog', { class: 'stats-dialog', 'aria-labelledby': title.id, tabindex: '-1', autofocus: '' }, el('div', { class: 'sd-bar' }, title, close), list);
  const fill = () => {
    const items = BUILDERS[key](getData()).slice(0, MAX_SHOWN);
    list.replaceChildren(...(items.length ? items : [el('li', { class: 'hint' }, t('stats.empty'))]));
    updateAuthors(list);
  };
  const stop = onProfiles(() => { if (dlg.isConnected) updateAuthors(list); });
  const done = () => { stop(); dlg.remove(); opener?.focus?.(); };
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', done);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // clic sur le fond
  document.body.append(dlg);
  fill();
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  dlg.focus();
  return { update: () => { if (dlg.isConnected) fill(); } };
}
