// Article long (NIP-23, kind 30023) : lecture des étiquettes. Module sans DOM ; tout est du texte non fiable.
export const ARTICLE_KIND = 30023;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const first = (tags, name) => tags.find((x) => x[0] === name && typeof x[1] === 'string')?.[1];

function httpsUrl(raw) {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}

// → { id (étiquette d), title, summary, image, tags[], published }
export function articleMeta(ev) {
  const tags = Array.isArray(ev?.tags) ? ev.tags : [];
  const seen = new Set();
  const topics = [];
  for (const x of tags) {
    if (x[0] !== 't' || typeof x[1] !== 'string') continue;
    const v = clean(x[1], 40).toLowerCase();
    if (v && !seen.has(v) && topics.length < 12) { seen.add(v); topics.push(v); }
  }
  return {
    id: clean(first(tags, 'd') ?? '', 200),
    title: clean(first(tags, 'title') ?? '', 200),
    summary: clean(first(tags, 'summary') ?? '', 400),
    image: httpsUrl(first(tags, 'image') ?? ''),
    tags: topics,
    published: Number(first(tags, 'published_at')) || ev?.created_at || 0,
  };
}

// Clé d'adresse d'un événement remplaçable : on ne garde que la version la plus récente.
export const addressKey = (ev) => `${ev.kind}:${ev.pubkey}:${articleMeta(ev).id}`;
