// Favoris (NIP-51, kind 10003) : fonctions pures. Seules les notes publiques (balises « e ») sont gérées ;
// les autres balises (a, t, r…) et le contenu chiffré d'un autre client sont conservés tels quels.
const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_BOOKMARKS = 500;

// Identifiants des notes en favori, de la plus récemment ajoutée à la plus ancienne (NIP-51 ajoute à la fin).
export function parseBookmarks(event) {
  if (event?.kind !== 10003 || !Array.isArray(event.tags)) return [];
  const ids = [];
  for (const t of event.tags) if (t[0] === 'e' && HEX64.test(t[1] ?? '') && !ids.includes(t[1])) ids.push(t[1]);
  return ids.reverse().slice(0, MAX_BOOKMARKS);
}

// op : { type: 'add'|'remove', id } → modèle d'événement kind 10003. Erreurs : INVALID_VALUE, MAX, NO_CHANGE
export function bookmarksTemplate(previous, op, now = Math.floor(Date.now() / 1000)) {
  const id = String(op?.id ?? '').toLowerCase();
  if (!HEX64.test(id)) throw new Error('INVALID_VALUE');
  const tags = (previous?.tags ?? []).map((t) => [...t]);
  const has = tags.some((t) => t[0] === 'e' && t[1] === id);
  if (op.type === 'add') {
    if (has) throw new Error('NO_CHANGE');
    if (tags.filter((t) => t[0] === 'e').length >= MAX_BOOKMARKS) throw new Error('MAX');
    tags.push(['e', id]);
  } else if (op.type === 'remove') {
    if (!has) throw new Error('NO_CHANGE');
    for (let i = tags.length - 1; i >= 0; i--) if (tags[i][0] === 'e' && tags[i][1] === id) tags.splice(i, 1);
  } else throw new Error('INVALID_VALUE');
  return { kind: 10003, created_at: Math.max(now, (previous?.created_at ?? 0) + 1), tags, content: typeof previous?.content === 'string' ? previous.content : '' };
}
