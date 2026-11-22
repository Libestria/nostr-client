import { t } from '../i18n.js';
import { npubEncode } from '../nostr/nip19.js';

// Création de nœuds DOM sûre : le texte passe toujours par createTextNode,
// jamais par innerHTML ; les attributs on* sont refusés.
export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k.startsWith('on') || k === 'innerHTML') continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  node.append(...kids.flat().filter((c) => c != null).map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return node;
}

// kind : 'loading' | 'empty' | 'error'
export function stateBlock(kind, key, vars) {
  const children = [];
  if (kind === 'loading') children.push(el('span', { class: 'spinner', 'aria-hidden': 'true' }));
  children.push(el('p', {}, t(key, vars)));
  return el('div', { class: `state state-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, ...children);
}

export const pageTitle = (key) => el('h1', {}, t(key));

export function shortNpub(hex) {
  const n = npubEncode(hex);
  return `${n.slice(0, 12)}…${n.slice(-4)}`;
}

export function timeAgo(ts) {
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'fr', { numeric: 'auto' });
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  return rtf.format(-Math.floor(s / 86400), 'day');
}
