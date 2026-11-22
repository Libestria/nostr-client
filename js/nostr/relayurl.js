// Normalise une adresse de relais et refuse celles qui visent le réseau local
// (une liste de relais hostile ne doit pas faire sonder l'intranet de l'utilisateur).
function isPrivateIPv4(h) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function normalizeRelayUrl(input) {
  let u;
  try { u = new URL(String(input).trim()); } catch { return null; }
  if (u.protocol !== 'wss:' || u.username || u.password || u.hash) return null;
  const h = u.hostname.toLowerCase();
  if (h.startsWith('[') || !h.includes('.') || isPrivateIPv4(h)) return null;
  if (/\.(local|localhost|internal|lan|home|intranet)$/.test(h)) return null;
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  const out = `wss://${u.host.toLowerCase()}${path}${u.search}`;
  return out.length <= 200 ? out : null;
}
