// Découpe le texte d'une note en éléments affichables. Module sans DOM.
// Le texte reste NON FIABLE : seuls des liens https, des mentions nostr: décodées et des textes sont produits.
import { decode, noteEncode } from './nip19.js';

const TOKEN = /(?<![a-z0-9])(?:nostr:)?((?:npub|nprofile|nevent|note)1[02-9ac-hj-np-z]{20,})|(https:\/\/[^\s<>"'`]+)|(?<![\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{1,60})/giu;
const IMAGE = /\.(?:jpe?g|png|gif|webp|avif)$/i;
const TRAILING = /[.,;:!?)\]}»”’]+$/;

function safeHttps(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.href;
  } catch { return null; }
}

// → [{ type: 'text', text } | { type: 'link', url, label, image } | { type: 'mention', pubkey }
//     | { type: 'note', id } | { type: 'hashtag', tag }]
export function tokenizeContent(text) {
  const out = [];
  const pushText = (s) => { if (s) out.push({ type: 'text', text: s }); };
  let last = 0;
  for (const m of String(text ?? '').matchAll(TOKEN)) {
    let [all, ref, url, tag] = m;
    let end = m.index + all.length;
    let token = null;
    if (ref) {
      try {
        const d = decode(ref);
        if (d.type === 'npub') token = { type: 'mention', pubkey: d.data };
        else if (d.type === 'nprofile') token = { type: 'mention', pubkey: d.data.pubkey };
        else if (d.type === 'note') token = { type: 'note', id: d.data };
        else if (d.type === 'nevent') token = { type: 'note', id: d.data.id };
      } catch { /* référence invalide : laissée en texte */ }
    } else if (url) {
      const trimmed = url.replace(TRAILING, '');
      end = m.index + trimmed.length;
      const href = safeHttps(trimmed);
      if (href) token = { type: 'link', url: href, label: trimmed.replace(/^https:\/\//, ''), image: IMAGE.test(new URL(href).pathname) };
    } else if (tag) token = { type: 'hashtag', tag: tag.toLowerCase() };
    if (!token) continue;
    pushText(text.slice(last, m.index));
    out.push(token);
    last = end;
  }
  pushText(text.slice(last));
  return out;
}

export const noteHref = (id) => `#/note/${noteEncode(id)}`;
