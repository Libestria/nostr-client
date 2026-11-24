// Aperçus de liens : récupération via le service choisi dans les réglages, cache local, débit limité.
// Chaque lien affiché est envoyé au service : réglage désactivable, et jamais sans l'option médias.
import { state } from './state.js';
import { readJsonLimited } from './nostr/http.js';
import { buildEndpoint, parsePreview, validTemplate, DEFAULT_SERVICE } from './nostr/linkpreview.js';

const KEY = 'nostr-client:linkpreviews';
const TTL = 7 * 86400000, MAX_ENTRIES = 150, MAX_PARALLEL = 2;
const memory = new Map();        // url -> aperçu | null (échec, valable pour cette session)
const pending = new Map();
const queue = [];
let running = 0;

export function previewsEnabled() {
  const s = state.get('settings');
  return s?.linkPreviews !== false && s?.loadMedia !== false;
}
export const previewService = () => (validTemplate(state.get('settings')?.previewService) ? state.get('settings').previewService : DEFAULT_SERVICE);

function readStore() { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } }
function writeStore(url, value) {
  try {
    const all = readStore();
    all[url] = { ...value, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_ENTRIES) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete all[k]);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* stockage plein ou indisponible */ }
}
export const clearPreviewCache = () => { memory.clear(); try { localStorage.removeItem(KEY); } catch { /* ignoré */ } };

function pump() {
  while (running < MAX_PARALLEL && queue.length) { const job = queue.shift(); running++; job().finally(() => { running--; pump(); }); }
}

async function fetchPreview(url, fetchFn) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchFn(buildEndpoint(previewService(), url), { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: ctl.signal });
    if (!res.ok) return null;
    return parsePreview(await readJsonLimited(res, 60000), url);
  } catch { return null; } finally { clearTimeout(timer); }
}

export function getPreview(url, { fetchFn = fetch } = {}) {
  if (!previewsEnabled()) return Promise.resolve(null);
  if (memory.has(url)) return Promise.resolve(memory.get(url));
  const stored = readStore()[url];
  if (stored && Date.now() - stored.at < TTL) { const { at, ...p } = stored; memory.set(url, p); return Promise.resolve(p); }
  if (pending.has(url)) return pending.get(url);
  const p = new Promise((resolve) => {
    queue.push(async () => {
      const r = await fetchPreview(url, fetchFn);
      memory.set(url, r);
      if (r) writeStore(url, r);
      pending.delete(url);
      resolve(r);
    });
    pump();
  });
  pending.set(url, p);
  return p;
}
