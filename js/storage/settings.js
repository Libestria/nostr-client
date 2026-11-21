// Réglages locaux : JSON versionné dans localStorage.
const KEY = 'nostr-client:settings';
const VERSION = 1;
const THEMES = ['auto', 'light', 'dark'];
const LANGS = ['fr', 'en'];

export const defaults = () => ({
  version: VERSION,
  theme: 'dark',
  lang: (navigator.language || '').startsWith('fr') ? 'fr' : 'en',
  loadMedia: true,
  readOnly: false,
  relays: [],
  muted: { pubkeys: [], words: [], events: [] },
});

function normalize(raw) {
  const d = defaults();
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    version: VERSION,
    theme: THEMES.includes(s.theme) ? s.theme : d.theme,
    lang: LANGS.includes(s.lang) ? s.lang : d.lang,
    loadMedia: typeof s.loadMedia === 'boolean' ? s.loadMedia : d.loadMedia,
    readOnly: typeof s.readOnly === 'boolean' ? s.readOnly : d.readOnly,
    relays: Array.isArray(s.relays) ? s.relays.filter((r) => r && /^wss:\/\//.test(r.url)) : [],
    muted: {
      pubkeys: Array.isArray(s.muted?.pubkeys) ? s.muted.pubkeys : [],
      words: Array.isArray(s.muted?.words) ? s.muted.words : [],
      events: Array.isArray(s.muted?.events) ? s.muted.events : [],
    },
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return defaults();
  }
}

export function updateSettings(patch) {
  const next = normalize({ ...loadSettings(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* stockage indisponible */ }
  return next;
}
