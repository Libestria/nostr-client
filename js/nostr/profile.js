// Profils (kind 0) : le contenu est une donnée NON FIABLE. On extrait des champs texte nettoyés
// et des URL https uniquement. Rien n'est jamais interprété comme du HTML.
const range = (...pairs) => pairs.map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`).join('');
const INVISIBLE = [[0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
const CTRL_LINE = new RegExp(`[${range([0, 0x1f], ...INVISIBLE)}]`, 'g');
const CTRL_MULTI = new RegExp(`[${range([0, 8], [0x0b, 0x0c], [0x0e, 0x1f], ...INVISIBLE)}]`, 'g');

export function cleanText(v, max, { multiline = false } = {}) {
  if (typeof v !== 'string') return '';
  const s = multiline ? v.replace(/\r\n?/g, '\n').replace(CTRL_MULTI, '') : v.replace(/\s+/g, ' ').replace(CTRL_LINE, '');
  return s.trim().slice(0, max);
}

export function safeUrl(v) {
  if (typeof v !== 'string' || v.length > 500) return null;
  let u;
  try { u = new URL(v.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
  return u.href;
}

const LUD16 = /^[a-z0-9._+-]{1,64}@[a-z0-9.-]{1,200}\.[a-z]{2,}$/i;

export function parseProfile(event) {
  if (!event || event.kind !== 0 || typeof event.content !== 'string') return null;
  let j;
  try { j = JSON.parse(event.content); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const lud16 = cleanText(j.lud16, 120);
  return {
    name: cleanText(j.name, 60),
    displayName: cleanText(j.display_name ?? j.displayName, 60),
    about: cleanText(j.about, 1000, { multiline: true }),
    picture: safeUrl(j.picture),
    banner: safeUrl(j.banner),
    nip05: cleanText(j.nip05, 120),
    lud16: LUD16.test(lud16) ? lud16 : '',
  };
}
