// Service worker : lecture hors ligne de l'application. Stratégie « réseau d'abord » (les mises à jour sont prises tout de suite),
// avec repli sur la copie en cache si le réseau est absent ou trop lent. Seules les ressources de ce site sont concernées :
// les relais (WebSocket), les images externes et les API Lightning ne passent jamais par ici.
const CACHE = 'nostr-shell-m35';
const SLOW = 5000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('nostr-shell-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fallback = async () => (await cache.match(req)) ?? (req.mode === 'navigate' ? (await cache.match('./index.html')) ?? (await cache.match('./')) : undefined);
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
    const cached = await cache.match(req);
    try {
      if (!cached) return await network;
      return await Promise.race([network, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), SLOW))]);
    } catch {
      return (await fallback()) ?? Response.error();
    }
  })());
});
