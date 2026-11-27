// Aperçu de lien (image OG + titre + description) : fonctions pures, sans DOM ni réseau.
// Le service d'aperçu est un modèle d'adresse https contenant {url}. Réponses acceptées :
// format « microlink » ({ status, data: { title, description, image: { url }, publisher } })
// ou format plat ({ title, description, image }).
export const DEFAULT_SERVICE = 'https://apercu-libestria.libestria.workers.dev/?url={url}';
export const LEGACY_SERVICE = 'https://api.microlink.io/?url={url}';   // ancien service par défaut : remplacé automatiquement

export function validTemplate(tpl) {
  if (typeof tpl !== 'string' || !tpl.includes('{url}') || tpl.length > 300) return false;
  try {
    const u = new URL(tpl.replace('{url}', 'x'));
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.');
  } catch { return false; }
}

export const buildEndpoint = (tpl, pageUrl) => tpl.replace('{url}', encodeURIComponent(pageUrl));

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
function httpsUrl(v) {
  const raw = typeof v === 'string' ? v : v?.url;
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}

// → { title, description, image, host } ou null s'il n'y a ni titre ni image.
export function parsePreview(json, pageUrl) {
  if (!json || typeof json !== 'object') return null;
  if (json.status && json.status !== 'success') return null;
  const d = json.data && typeof json.data === 'object' ? json.data : json;
  const title = clean(d.title, 160), description = clean(d.description, 300), image = httpsUrl(d.image);
  if (!title && !image) return null;
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { /* ignoré */ }
  return { title, description, image, host };
}

// Premier lien web (non image) d'une liste de jetons, ou null.
export const firstLinkUrl = (tokens) => tokens.find((tk) => tk.type === 'link' && !tk.image && !tk.video)?.url ?? null;

// Tous les liens web (non image / vidéo) d'une liste de jetons, sans doublon, limités à `max` (une carte chacun).
export const previewLinkUrls = (tokens, max = 5) => [...new Set(tokens.filter((tk) => tk.type === 'link' && !tk.image && !tk.video).map((tk) => tk.url))].slice(0, max);
