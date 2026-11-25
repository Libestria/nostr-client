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

// Titre de page : le <h1> reste dans le document (accessibilité) ; sur mobile il est masqué et le titre s'affiche dans la barre fixe du haut.
export function pageTitle(key) {
  const text = t(key);
  const bar = document.querySelector('.topbar-title');
  if (bar) bar.textContent = text;
  document.title = `${text} · nostr`;
  return el('h1', { class: 'page-title' }, text);
}

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

// Temps écoulé abrégé, sans « il y a » : 12s, 5m, 3h, 2j (en anglais : d). Au-delà d'un an : 1a.
export function shortAgo(ts, lang = document.documentElement.lang || 'fr') {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  const day = lang.startsWith('fr') ? 'j' : 'd', year = lang.startsWith('fr') ? 'a' : 'y';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 31536000) return `${Math.floor(s / 86400)}${day}`;
  return `${Math.floor(s / 31536000)}${year}`;
}

// Nom du client indiqué par la note (étiquette ["client", nom, …]) ; texte brut, borné.
export function clientName(ev) {
  const tag = ev.tags?.find((x) => x[0] === 'client' && typeof x[1] === 'string');
  const name = tag?.[1].replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return name || null;
}

// Temps écoulé en toutes lettres, sans « il y a » : « À l'instant », « 21 secondes », « 1 minute », « 3 heures », « 2 jours »…
export function fullAgo(ts, lang = document.documentElement.lang || 'fr', nowLabel = "À l'instant") {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 5) return nowLabel;
  const [n, unit] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour']
    : s < 2592000 ? [Math.floor(s / 86400), 'day'] : s < 31536000 ? [Math.floor(s / 2592000), 'month'] : [Math.floor(s / 31536000), 'year'];
  return new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'long' }).format(n);
}
