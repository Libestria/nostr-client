// Contrôles structurels des événements reçus (la signature est vérifiée à part).
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
export const MAX_FUTURE_SECONDS = 900;

const isStr = (v) => typeof v === 'string';

export function isValidShape(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (!isStr(e.id) || !HEX64.test(e.id) || !isStr(e.pubkey) || !HEX64.test(e.pubkey) || !isStr(e.sig) || !HEX128.test(e.sig)) return false;
  if (!Number.isInteger(e.created_at) || e.created_at < 0) return false;
  if (!Number.isInteger(e.kind) || e.kind < 0 || e.kind > 65535) return false;
  if (!isStr(e.content) || e.content.length > 200000) return false;
  if (!Array.isArray(e.tags) || e.tags.length > 3000) return false;
  for (const tag of e.tags) {
    if (!Array.isArray(tag) || tag.length > 64) return false;
    for (const v of tag) if (!isStr(v) || v.length > 8192) return false;
  }
  return true;
}

export const isTooFarInFuture = (e, now = Math.floor(Date.now() / 1000)) => e.created_at > now + MAX_FUTURE_SECONDS;
export const eventKey = (e) => e.id + e.sig; // inclut la signature : une copie falsifiée n'empoisonne pas la vraie

export function matchesFilter(e, f) {
  if (f.ids && !f.ids.some((p) => e.id.startsWith(p))) return false;
  if (f.authors && !f.authors.some((p) => e.pubkey.startsWith(p))) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  if (f.until !== undefined && e.created_at > f.until) return false;
  for (const [k, vals] of Object.entries(f)) {
    if (k.length === 2 && k[0] === '#' && Array.isArray(vals)) {
      if (!e.tags.some((tag) => tag[0] === k[1] && vals.includes(tag[1]))) return false;
    }
  }
  return true;
}
export const matchesAny = (e, filters) => filters.some((f) => matchesFilter(e, f));

export const isReplaceable = (k) => k === 0 || k === 3 || (k >= 10000 && k < 20000);
export const isAddressable = (k) => k >= 30000 && k < 40000;
export function replaceKey(e) {
  if (isReplaceable(e.kind)) return `${e.kind}:${e.pubkey}:`;
  if (isAddressable(e.kind)) return `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
  return null;
}
