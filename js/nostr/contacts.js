// Liste de contacts (kind 3, NIP-02). Module sans DOM.
const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_FOLLOWS = 5000;

export function parseContacts(event) {
  if (!event || event.kind !== 3 || !Array.isArray(event.tags)) return [];
  const out = [];
  const seen = new Set();
  for (const tag of event.tags) {
    if (tag[0] !== 'p' || !HEX64.test(tag[1] ?? '') || seen.has(tag[1])) continue;
    seen.add(tag[1]);
    out.push(tag[1]);
    if (out.length >= MAX_FOLLOWS) break;
  }
  return out;
}

// Modèle d'événement kind 3 après suivi / désabonnement. Les autres balises et le contenu
// (indications de relais) de la liste précédente sont conservés. Retourne null si rien ne change.
export function buildContactsTemplate(prev, action, target, now = Math.floor(Date.now() / 1000)) {
  if (!HEX64.test(target)) throw new Error('invalid-target');
  const tags = Array.isArray(prev?.tags) ? prev.tags.map((t) => [...t]) : [];
  const has = tags.some((t) => t[0] === 'p' && t[1] === target);
  let next;
  if (action === 'follow') {
    if (has) return null;
    if (parseContacts({ kind: 3, tags }).length >= MAX_FOLLOWS) throw new Error('too-many');
    next = [...tags, ['p', target]];
  } else if (action === 'unfollow') {
    if (!has) return null;
    next = tags.filter((t) => !(t[0] === 'p' && t[1] === target));
  } else throw new Error('invalid-action');
  return { kind: 3, created_at: Math.max(now, (prev?.created_at ?? 0) + 1), tags: next, content: typeof prev?.content === 'string' ? prev.content : '' };
}
