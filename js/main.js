import { state } from './state.js';
import { setLang, applyI18n, t } from './i18n.js';
import { loadSettings } from './storage/settings.js';
import { stateBlock } from './ui/common.js';
import { renderFeed, placeholder } from './ui/feed.js';
import { renderProfile } from './ui/profile.js';
import { renderThread } from './ui/thread.js';
import { renderSettings } from './ui/settings.js';
import { renderLogin } from './ui/login.js';
import { loadSession } from './storage/session.js';
import { restoreRemoteSession, rememberReturnTo, getSigner } from './auth.js';
import { pool } from './relays/pool.js';
import { putEvent, prune } from './storage/db.js';
import { loadAccountLists, resetAccount } from './account.js';
import { renderGate } from './ui/gate.js';
import { renderDms } from './ui/dms.js';
import { initDms } from './dms.js';

const routes = {
  feed: renderFeed,
  search: placeholder('nav.search'),
  notifications: placeholder('nav.notifications'),
  messages: renderDms,
  profile: renderProfile,
  note: renderThread,
  settings: renderSettings,
  login: renderLogin,
};

const main = document.getElementById('view');
let renderId = 0;
let currentLang = null;
let cleanup = null;
const OPEN_ROUTES = new Set(['login', 'settings']);   // accessibles sans compte

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
  if (view && !OPEN_ROUTES.has(name) && !state.get('session')) {
    rememberReturnTo(location.hash || '#/feed');
    location.hash = '#/login';   // déclenche un nouveau rendu
    return;
  }
  document.querySelectorAll('#nav a').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${t(view ? `nav.${name}` : 'state.notFound')} – Nostr`;
  main.replaceChildren(stateBlock('loading', 'state.loading'));
  try {
    if (!view) main.replaceChildren(stateBlock('error', 'state.notFound'));
    else {
      const gated = view && !OPEN_ROUTES.has(name) && state.get('lists').status !== 'ready';
      const done = gated ? renderGate(main, name) : await view(main, params);
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

// Navigation : sans compte, seules la connexion et les réglages sont proposées.
function syncNav() {
  const connected = !!state.get('session');
  document.querySelectorAll('#nav a[data-route]').forEach((a) => {
    const r = a.dataset.route;
    a.parentElement.hidden = r === 'login' ? connected : !connected && !OPEN_ROUTES.has(r);
  });
}

async function applyLang(lang) {
  currentLang = lang;
  try { await setLang(lang); } catch (err) { console.error(err); }
  applyI18n();
}

async function boot() {
  window.__nostrBooted = true;   // lu par boot-check.js
  const settings = loadSettings();
  state.set('settings', settings);
  state.set('session', loadSession());
  restoreRemoteSession();
  pool.onVerified = putEvent;
  pool.signer = (tpl) => getSigner()?.signEvent(tpl) ?? null;   // NIP-42 : seulement si un relais exige l'authentification
  // Reprise (onglet de nouveau visible, réseau revenu) : reconnexion immédiate, sans attendre le délai de reprise
  const resume = () => { if (document.visibilityState === 'visible') pool.reconnectAll(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  setTimeout(() => prune(), 5000);
  applyTheme(settings.theme);
  await applyLang(settings.lang);

  state.on('settings', async (s) => {
    applyTheme(s.theme);
    if (s.lang !== currentLang) { await applyLang(s.lang); render(); }
  });

  // Compte : à chaque changement, listes de relais du compte (cache, puis découverte)
  const onSession = (s, fresh) => {
    syncNav();
    resetAccount();
    if (s) loadAccountLists(s.pubkey);
  };
  state.on('session', (s) => { onSession(s, true); render(); });
  let lastStatus = state.get('lists').status;
  state.on('lists', (l) => {
    if (l.status === lastStatus) return;
    lastStatus = l.status;
    if (!OPEN_ROUTES.has(parseHash().name)) render();   // la page affichée dépend de l'état des listes
  });
  initDms();
  const first = state.get('session');
  syncNav();
  if (first) loadAccountLists(first.pubkey);

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
