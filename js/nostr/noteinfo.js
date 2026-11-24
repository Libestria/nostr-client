// Informations tirées des étiquettes d'une note : repost (NIP-18) et réponse (NIP-10). Module sans DOM.
const HEX64 = /^[0-9a-f]{64}$/;

// Repost de kind 6 : renvoie la note d'origine (non vérifiée : signature à contrôler par l'appelant) ou null.
export function parseRepost(ev) {
  if (ev?.kind !== 6 || typeof ev.content !== 'string' || ev.content.length > 100000 || !ev.content.startsWith('{')) return null;
  let inner;
  try { inner = JSON.parse(ev.content); } catch { return null; }
  if (!inner || inner.kind !== 1 || !HEX64.test(inner.id ?? '') || !HEX64.test(inner.pubkey ?? '') || typeof inner.content !== 'string'
    || !Array.isArray(inner.tags) || !Number.isInteger(inner.created_at) || typeof inner.sig !== 'string') return null;
  const target = ev.tags?.find((x) => x[0] === 'e' && typeof x[1] === 'string')?.[1];
  if (target && target !== inner.id) return null;
  return inner;
}

// Réponse : { parentId, parentAuthor|null } ou null. Marqueur « reply », sinon dernière étiquette e non « mention ».
export function replyInfo(ev) {
  const es = (ev?.tags ?? []).filter((x) => x[0] === 'e' && HEX64.test(x[1] ?? '') && x[3] !== 'mention');
  if (!es.length) return null;
  const target = es.find((x) => x[3] === 'reply') ?? es.find((x) => x[3] === 'root' && es.length === 1) ?? es.at(-1);
  const ps = ev.tags.filter((x) => x[0] === 'p' && HEX64.test(x[1] ?? ''));
  const author = (HEX64.test(target[4] ?? '') ? target[4] : null) ?? ps.at(-1)?.[1] ?? null;
  return { parentId: target[1], parentAuthor: author };
}
