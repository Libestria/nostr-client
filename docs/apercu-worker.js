// Service d'aperçu de liens pour le client Nostr — à déployer comme « Worker » Cloudflare.
// Appel : GET https://<ton-worker>.workers.dev/?url=https%3A%2F%2Fexemple.org%2Fpage
// Réponse : { "title": "...", "description": "...", "image": "https://..." }  (format « plat » accepté par le client)

// Seul ce site a le droit d'appeler le service depuis un navigateur. Ajoute ton adresse si elle change.
const ALLOWED_ORIGINS = ['https://libestria.fr'];

const MAX_BYTES = 600_000;        // on ne lit que le début de la page (les balises sont dans <head>)
const TIMEOUT_MS = 7000;
const UA = 'Mozilla/5.0 (compatible; Twitterbot/1.0)';   // beaucoup de sites ne servent leurs balises qu'aux robots de partage

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

function json(body, status, origin) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'access-control-allow-methods': 'GET, OPTIONS',
      vary: 'Origin',
      'cache-control': status === 200 ? 'public, max-age=86400' : 'no-store',
    },
  });
}

// Adresses refusées : pas http(s), pas de nom de domaine « public » (IP, localhost, .local...), ports inhabituels.
function checkTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || /\.(local|internal|localhost|lan|home|corp)$/.test(h)) return null;
  return u;
}

async function readHead(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return all;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return json({}, 204, origin);
    if (request.method !== 'GET') return json({ error: 'method' }, 405, origin);

    const target = checkTarget(new URL(request.url).searchParams.get('url') || '');
    if (!target) return json({ error: 'url' }, 400, origin);

    let res;
    try {
      res = await fetch(target.href, {
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'fr,en;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cf: { cacheTtl: 86400, cacheEverything: true },
      });
    } catch { return json({ error: 'fetch' }, 502, origin); }
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return json({ error: 'type' }, 502, origin);

    const meta = {};
    let titleTag = '';
    const metaHandler = {
      element(e) {
        const key = (e.getAttribute('property') || e.getAttribute('name') || '').toLowerCase();
        const val = e.getAttribute('content');
        if (key && val && !(key in meta)) meta[key] = val;
      },
    };
    const titleHandler = { text(t) { titleTag += t.text; } };

    try {
      const head = new Response(await readHead(res), { headers: { 'content-type': res.headers.get('content-type') } });
      await new HTMLRewriter().on('meta', metaHandler).on('title', titleHandler).transform(head).arrayBuffer();
    } catch { return json({ error: 'parse' }, 502, origin); }

    const title = clean(meta['og:title'] || meta['twitter:title'] || titleTag, 160);
    const description = clean(meta['og:description'] || meta['twitter:description'] || meta.description, 300);
    let image = '';
    try {
      const u = new URL(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || '', res.url || target.href);
      if (/^https?:$/.test(u.protocol)) { u.protocol = 'https:'; image = u.href; }
    } catch { /* pas d'image */ }

    if (!title && !image) return json({ error: 'empty' }, 404, origin);
    return json({ title, description, image }, 200, origin);
  },
};
