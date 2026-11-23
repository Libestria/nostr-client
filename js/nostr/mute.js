// Liste de sourdine (NIP-51, kind 10000) : fonctions pures. Seules les entrées publiques (balises) sont lues et écrites ;
// le contenu chiffré éventuel (entrées privées créées par un autre client) est conservé tel quel.
const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_ENTRIES = 500;
const TAG = { pubkey: 'p', word: 'word', event: 'e', hashtag: 't' };

export const emptyMute = () => ({ pubkeys: [], words: [], events: [], hashtags: [] });

export function parseMute(event) {
  const out = emptyMute();
  if (event?.kind !== 10000 || !Array.isArray(event.tags)) return out;
  for (const t of event.tags) {
    const v = t[1];
    if (typeof v !== 'string') continue;
    if (t[0] === 'p' && HEX64.test(v)) out.pubkeys.push(v);
    else if (t[0] === 'e' && HEX64.test(v)) out.events.push(v);
    else if (t[0] === 'word' && v.trim()) out.words.push(v.trim().toLowerCase().slice(0, 100));
    else if (t[0] === 't' && v.trim()) out.hashtags.push(v.trim().replace(/^#/, '').toLowerCase().slice(0, 100));
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].slice(0, MAX_ENTRIES);
  return out;
}

export function normalizeValue(kind, value) {
  const v = String(value ?? '').trim();
  if (kind === 'pubkey' || kind === 'event') { const h = v.toLowerCase(); if (!HEX64.test(h)) throw new Error('INVALID_VALUE'); return h; }
  if (kind === 'word') { const w = v.toLowerCase(); if (!w || w.length > 100) throw new Error('INVALID_VALUE'); return w; }
  if (kind === 'hashtag') { const h = v.replace(/^#/, '').toLowerCase(); if (!h || h.length > 100 || /\s/.test(h)) throw new Error('INVALID_VALUE'); return h; }
  throw new Error('INVALID_VALUE');
}

// ops : [{ type: 'add'|'remove', kind: 'pubkey'|'word'|'event'|'hashtag', value }]
// → modèle d'événement kind 10000 ; erreurs : INVALID_VALUE, MAX, NO_CHANGE
export function muteTemplate(previous, ops, now = Math.floor(Date.now() / 1000)) {
  const tags = (previous?.tags ?? []).map((t) => [...t]);
  const has = (name, v) => tags.some((t) => t[0] === name && (name === 'word' || name === 't' ? String(t[1]).trim().replace(/^#/, '').toLowerCase() === v : t[1] === v));
  let changed = false;
  for (const op of ops) {
    const v = normalizeValue(op.kind, op.value);
    const name = TAG[op.kind];
    if (op.type === 'add') {
      if (has(name, v)) continue;
      if (tags.filter((t) => t[0] === name).length >= MAX_ENTRIES) throw new Error('MAX');
      tags.push([name, v]); changed = true;
    } else if (op.type === 'remove') {
      const before = tags.length;
      for (let i = tags.length - 1; i >= 0; i--) {
        const t = tags[i];
        if (t[0] !== name) continue;
        const cur = name === 'word' || name === 't' ? String(t[1]).trim().replace(/^#/, '').toLowerCase() : t[1];
        if (cur === v) tags.splice(i, 1);
      }
      if (tags.length !== before) changed = true;
    }
  }
  if (!changed) throw new Error('NO_CHANGE');
  return { kind: 10000, created_at: Math.max(now, (previous?.created_at ?? 0) + 1), tags, content: typeof previous?.content === 'string' ? previous.content : '' };
}

// Une note (ou un profil) est-elle masquée ? → raison ('pubkey' | 'thread' | 'word' | 'hashtag') ou null
export function muteReason(ev, mute) {
  if (!ev || !mute) return null;
  if (mute.pubkeys.includes(ev.pubkey)) return 'pubkey';
  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  if (mute.events.includes(ev.id) || tags.some((t) => t[0] === 'e' && mute.events.includes(t[1]))) return 'thread';
  if (mute.hashtags.length && tags.some((t) => t[0] === 't' && mute.hashtags.includes(String(t[1]).toLowerCase()))) return 'hashtag';
  if (mute.words.length && ev.kind === 1) {
    const text = String(ev.content ?? '').toLowerCase();
    if (mute.words.some((w) => text.includes(w))) return 'word';
  }
  return null;
}
