// NIP-05 : adresse name@domaine → clé publique. Module sans DOM.
const DOMAIN = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const NAME = /^[a-z0-9._-]+$/;

export function parseIdentifier(input) {
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (!s.includes('@')) s = `_@${s}`;
  const parts = s.split('@');
  if (parts.length !== 2) return null;
  const [name, domain] = parts;
  return NAME.test(name) && DOMAIN.test(domain) ? { name, domain } : null;
}

export async function resolveNip05(input, { timeout = 6000, fetchFn = fetch } = {}) {
  const id = parseIdentifier(input);
  if (!id) throw new Error('invalid');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const url = `https://${id.domain}/.well-known/nostr.json?name=${encodeURIComponent(id.name)}`;
    const res = await fetchFn(url, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (!res.ok) throw new Error('http');
    const json = await res.json();
    const pubkey = Object.hasOwn(json?.names ?? {}, id.name) ? json.names[id.name] : null;
    if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('not-found');
    const list = Object.hasOwn(json.relays ?? {}, pubkey) ? json.relays[pubkey] : [];
    const relays = Array.isArray(list) ? list.filter((r) => typeof r === 'string' && /^wss:\/\/\S+$/.test(r)).slice(0, 8) : [];
    return { pubkey, relays, ...id };
  } finally {
    clearTimeout(timer);
  }
}
