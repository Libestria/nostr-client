import { state } from './state.js';
import { setLang, applyI18n, t } from './i18n.js';
import { loadSettings, updateSettings } from './storage/settings.js';
import { stateBlock } from './ui/common.js';
import { renderFeed, placeholder } from './ui/feed.js';
import { renderProfile } from './ui/profile.js';
import { renderSettings } from './ui/settings.js';
import { renderLogin } from './ui/login.js';
import { loadSession } from './storage/session.js';
import { restoreRemoteSession } from './auth.js';
import { pool } from './relays/pool.js';
import { putEvent, prune } from './storage/db.js';

const routes = {
  feed: renderFeed,
  search: placeholder('nav.search'),
  notifications: placeholder('nav.notifications'),
  messages: placeholder('nav.messages'),
  profile: renderProfile,
  settings: renderSettings,
  login: renderLogin,
};

const main = document.getElementById('view');
let renderId = 0;
let currentLang = null;
let cleanup = null;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  return { name: parts[0] || 'feed', params: parts.slice(1) };
}

async function render(focus = false) {
  const id = ++renderId;
  if (cleanup) { cleanup(); cleanup = null; }
  const { name, params } = parseHash();
  const view = Object.hasOwn(routes, name) ? routes[name] : null;
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${t(view ? `nav.${name}` : 'state.notFound')} – Nostr`;
  main.replaceChildren(stateBlock('loading', 'state.loading'));
  try {
    if (!view) main.replaceChildren(stateBlock('error', 'state.notFound'));
    else {
      const done = await view(main, params);
      if (typeof done === 'function') { if (id === renderId) cleanup = done; else done(); }
    }
  } catch (err) {
    console.error(err);
    if (id === renderId) main.replaceChildren(stateBlock('error', 'state.error'));
  }
  if (focus && id === renderId) main.focus({ preventScroll: true });
}

function applyTheme(theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

async function loadDefaultRelays() {
  try {
    const res = await fetch(new URL('../data/default-relays.json', import.meta.url));
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

async function applyLang(lang) {
  currentLang = lang;
  try { await setLang(lang); } catch (err) { console.error(err); }
  applyI18n();
}

async function boot() {
  let settings = loadSettings();
  if (settings.relays.length === 0) settings = updateSettings({ relays: await loadDefaultRelays() });
  state.set('settings', settings);
  state.set('session', loadSession());
  restoreRemoteSession();
  pool.onVerified = putEvent;
  pool.setRelays(settings.relays);
  setTimeout(() => prune(), 5000);
  let relaysKey = JSON.stringify(settings.relays);
  applyTheme(settings.theme);
  await applyLang(settings.lang);

  state.on('settings', async (s) => {
    applyTheme(s.theme);
    const key = JSON.stringify(s.relays);
    if (key !== relaysKey) { relaysKey = key; pool.setRelays(s.relays); }
    if (s.lang !== currentLang) { await applyLang(s.lang); render(); }
  });

  const offline = document.getElementById('offline');
  const syncOnline = () => { state.set('online', navigator.onLine); offline.hidden = navigator.onLine; };
  addEventListener('online', () => { syncOnline(); pool.reconnectAll(); });
  addEventListener('offline', syncOnline);
  syncOnline();

  document.getElementById('skip').addEventListener('click', () => main.focus());
  addEventListener('hashchange', () => render(true));
  render();
}

boot();
