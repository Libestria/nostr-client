// Coque de l'application (inspirée de Nostur) : barre du haut avec avatar, menu latéral, bouton « + » flottant, icônes de navigation, balayage entre sous-onglets.
import { openSettingsMenu } from './settingsmenu.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { getSigner, logout, isRemoteKept, setRemoteKept } from '../auth.js';
import { toast } from './toast.js';
import { feedNeighbor } from './feedmenu.js';
import { getCached, onProfiles, requestProfile } from '../profiles.js';
import { el, returnFocus, scrollToTop, scrollTopNow, closeButton } from './common.js';
import { icon } from './icons.js';
import { openCompose } from './composedialog.js';

const NAV_ICONS = { login: 'user', feed: 'home', bookmarks: 'bookmark', search: 'search', notifications: 'bell', messages: 'mail', profile: 'user', settings: 'settings' };
const loadMedia = () => state.get('settings')?.loadMedia !== false;

function paintAvatar(box, pubkey, size) {
  box.replaceChildren();
  const p = pubkey ? getCached(pubkey) : null;
  if (p?.picture && loadMedia()) {
    const img = el('img', { src: p.picture, alt: '', width: size, height: size, decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
}

// ---------- barre du haut + menu latéral
function buildTopbar() {
  const avatar = el('span', { class: 'avatar', 'aria-hidden': 'true' });
  const open = el('button', { type: 'button', class: 'topbar-avatar', 'aria-haspopup': 'dialog' }, avatar);
  // Sans compte : engrenage à droite, qui ouvre le menu des réglages (thème, langue)
  const gear = el('button', { type: 'button', class: 'topbar-btn topbar-gear', 'aria-haspopup': 'dialog', 'aria-label': t('nav.settings') }, icon('settings', 22));
  gear.addEventListener('click', () => openSettingsMenu(gear));
  const bar = el('header', { class: 'topbar' }, open, el('span', { class: 'topbar-title', 'aria-hidden': 'true' }), gear);
  document.body.insertBefore(bar, document.querySelector('.app'));
  // Hauteur réelle de la barre (zone sûre comprise) : les fenêtres du haut s'affichent dessous
  const syncHeight = () => document.documentElement.style.setProperty('--topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
  syncHeight();
  const nav = document.getElementById('nav');
  const syncNav = () => nav && document.documentElement.style.setProperty('--nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`);
  syncNav();
  if (typeof ResizeObserver !== 'undefined') { new ResizeObserver(syncHeight).observe(bar); if (nav) new ResizeObserver(syncNav).observe(nav); } else addEventListener('resize', () => { syncHeight(); syncNav(); });

  const refresh = () => {
    const s = state.get('session');
    open.hidden = !s;
    open.setAttribute('aria-label', t('shell.menu'));
    gear.hidden = !!s;
    gear.setAttribute('aria-label', t('nav.settings'));
    if (s) { requestProfile(s.pubkey); paintAvatar(avatar, s.pubkey, 34); }
  };

  // Contenu du menu du compte : fenêtre latérale (dismiss = fermeture) ou barre latérale fixe des grands écrans (dismiss = null)
  async function fill(drawer, dismiss) {
    const s = state.get('session');
    if (!s) return;
    const pk = s.pubkey, p = getCached(pk);
    const banner = el('div', { class: 'drawer-banner' });
    if (p?.banner && loadMedia()) { const img = el('img', { src: p.banner, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' }); img.addEventListener('error', () => img.remove()); banner.append(img); }
    const pic = el('span', { class: 'avatar avatar-xl', 'aria-hidden': 'true' }); paintAvatar(pic, pk, 72);
    const close = dismiss ? closeButton(t('shell.menu.close'), { cls: 'drawer-close' }) : null;
    const link = (href, ic, label) => el('li', {}, el('a', { href }, icon(ic, 20), el('span', {}, label)));
    // Ordre : Profil, Réglages, filet, Favoris, Messages, Portefeuille (si signature), Liste de blocage
    const items = [link('#/profile', 'user', t('nav.profile')), link('#/settings', 'settings', t('nav.settings')),
      el('li', { class: 'drawer-sep', role: 'separator' }), link('#/bookmarks', 'bookmark', t('nav.bookmarks')), link('#/messages', 'mail', t('nav.messages'))];
    if (getSigner()) items.push(link('#/settings/wallet', 'wallet', t('menu.wallet')));
    items.push(link('#/settings/mute', 'mute', t('menu.mute')));
    const out = el('button', { type: 'button', class: 'drawer-logout' }, icon('logout', 20), el('span', {}, t('menu.logout')));
    out.addEventListener('click', () => { dismiss?.(); logout(); location.hash = '#/login'; });
    // Signeur distant : option facultative pour rester connecté entre deux ouvertures du navigateur (clé de transport chiffrée)
    let keep = null;
    if (s.method === 'nip46') {
      const box = el('input', { type: 'checkbox', checked: isRemoteKept() });
      keep = el('label', { class: 'drawer-keep' }, box, el('span', {}, t('menu.keep')));
      box.addEventListener('change', async () => {
        const want = box.checked;
        box.disabled = true;
        try { await setRemoteKept(want); toast(t(want ? 'menu.keep.on' : 'menu.keep.off'), { kind: 'ok' }); }
        catch { box.checked = !want; toast(t('menu.keep.fail'), { error: true }); }
        box.disabled = false;
      });
    }
    const list = el('ul', { class: 'drawer-list' }, ...items);
    list.addEventListener('click', (e) => { if (e.target.closest('a')) dismiss?.(); });
    close?.addEventListener('click', () => dismiss());
    drawer.replaceChildren(el('div', { class: 'drawer-head' }, banner, close, pic),
      el('div', { class: 'drawer-id' }, el('strong', {}, p?.displayName || p?.name || t('shell.account'))), list, el('div', { class: 'drawer-foot' }, keep, out));
  }

  open.addEventListener('click', async () => {
    const drawer = el('dialog', { class: 'drawer', 'aria-label': t('shell.account'), tabindex: '-1', autofocus: '' });
    await fill(drawer, () => drawer.close());
    drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.close(); });
    drawer.addEventListener('close', () => { drawer.remove(); returnFocus(open); });
    document.body.append(drawer);
    drawer.showModal?.() ?? drawer.setAttribute('open', '');
    drawer.focus();
  });
  // Grands écrans (CSS ≥ 75 rem) : même contenu que le menu glissant, en barre latérale fixe. Redessinée seulement si le compte
  // ou son profil change (les profils des autres comptes arrivent en continu).
  const side = el('aside', { class: 'drawer sidebar', id: 'sidebar', 'aria-label': t('shell.account') });
  document.body.insertBefore(side, document.querySelector('.app'));
  let sideKey = '';
  const paintSide = () => {
    const s = state.get('session');
    document.body.classList.toggle('has-sidebar', !!s);
    document.body.classList.toggle('signed-out', !s);   // sans compte : ni barre du bas ni barre latérale
    const p = s ? getCached(s.pubkey) : null;
    const key = s ? [s.pubkey, s.method, p?.picture, p?.banner, p?.displayName, p?.name, !!getSigner(), state.get('settings')?.loadMedia].join('|') : '';
    if (key === sideKey) return;
    sideKey = key;
    if (s) fill(side, null); else side.replaceChildren();
  };
  addEventListener('hashchange', refresh);
  state.on('session', () => { refresh(); paintSide(); });
  onProfiles(() => { refresh(); paintSide(); });
  refresh();
  paintSide();
}

// ---------- bouton « + » flottant : ouvre le composeur dans une fenêtre
function buildFab() {
  const fab = el('button', { type: 'button', class: 'fab', 'aria-haspopup': 'dialog' }, icon('plus', 26));
  document.body.append(fab);
  const refresh = () => { fab.hidden = !(state.get('session') && getSigner()); fab.setAttribute('aria-label', t('shell.newPost')); fab.title = t('shell.newPost'); };
  fab.addEventListener('click', () => openCompose({ opener: fab }));
  state.on('session', refresh);
  refresh();
}

// ---------- icônes de navigation + clic sur l'onglet déjà actif : retour en haut de page
function buildNav() {
  document.querySelectorAll('#nav a[data-route]').forEach((a) => {
    const slot = a.querySelector('.nav-icon');
    if (slot && !slot.firstChild) slot.append(icon(NAV_ICONS[a.dataset.route] ?? 'home', 22));
    a.addEventListener('click', (e) => {
      const same = a.getAttribute('aria-current') === 'page' && location.hash.replace(/\/$/, '') === a.getAttribute('href');
      if (same) { e.preventDefault(); scrollToTop(); }
    });
  });
}

// ---------- balayage horizontal entre les sous-onglets de l'accueil
function buildSwipe() {
  const view = document.getElementById('view');
  let start = null;
  view.addEventListener('touchstart', (e) => {
    const tch = e.touches[0];
    start = e.touches.length === 1 && !e.target.closest('textarea, input, select, dialog, [data-noswipe]') ? { x: tch.clientX, y: tch.clientY, at: Date.now() } : null;
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!start) return;
    const tch = e.changedTouches[0], dx = tch.clientX - start.x, dy = tch.clientY - start.y, dt = Date.now() - start.at;
    start = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 45 || dt > 700) return;
    const next = feedNeighbor(dx < 0 ? 1 : -1);
    if (next) location.hash = next;
  }, { passive: true });
}

// ---------- tirer pour rafraîchir (accueil) : geste vers le bas en haut de page
function buildPullToRefresh() {
  const view = document.getElementById('view');
  let start = null;
  view.addEventListener('touchstart', (e) => { start = scrollTopNow() <= 0 && e.touches.length === 1 && !e.target.closest('dialog, textarea, input, select') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!start) return;
    const tch = e.changedTouches[0], dy = tch.clientY - start.y, dx = Math.abs(tch.clientX - start.x);
    start = null;
    if (dy < 110 || dx > 60 || scrollTopNow() > 0) return;
    const btn = view.querySelector('button[data-refresh]:not(:disabled)');
    if (btn) btn.click();
  }, { passive: true });
}

export function initShell() {
  buildPullToRefresh();
  buildNav();
  buildTopbar();
  buildFab();
  buildSwipe();
}
