// Coque de l'application (inspirée de Nostur) : barre du haut avec avatar, menu latéral, bouton « + » flottant, icônes de navigation, balayage entre sous-onglets.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { getSigner, logout, isRemoteKept, setRemoteKept } from '../auth.js';
import { toast } from './toast.js';
import { feedNeighbor } from './feedmenu.js';
import { getCached, onProfiles, requestProfile } from '../profiles.js';
import { getReplaceable } from '../storage/db.js';
import { parseContacts } from '../nostr/contacts.js';
import { npubEncode } from '../nostr/nip19.js';
import { el, shortNpub, returnFocus, scrollToTop, scrollTopNow, closeButton } from './common.js';
import { icon } from './icons.js';
import { composer } from './composer.js';
import { avatarNode } from './note.js';

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
  const bar = el('header', { class: 'topbar' }, open, el('span', { class: 'topbar-title', 'aria-hidden': 'true' }));
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
    if (s) { requestProfile(s.pubkey); paintAvatar(avatar, s.pubkey, 34); }
  };

  // Contenu du menu du compte : fenêtre latérale (dismiss = fermeture) ou barre latérale fixe des grands écrans (dismiss = null)
  async function fill(drawer, dismiss) {
    const s = state.get('session');
    if (!s) return;
    const pk = s.pubkey, p = getCached(pk);
    const npub = npubEncode(pk);
    const banner = el('div', { class: 'drawer-banner' });
    if (p?.banner && loadMedia()) { const img = el('img', { src: p.banner, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' }); img.addEventListener('error', () => img.remove()); banner.append(img); }
    const pic = el('span', { class: 'avatar avatar-xl', 'aria-hidden': 'true' }); paintAvatar(pic, pk, 72);
    const close = dismiss ? closeButton(t('shell.menu.close'), { cls: 'drawer-close' }) : null;
    const copy = el('button', { type: 'button', class: 'drawer-npub', title: t('shell.copyNpub'), 'aria-label': t('shell.copyNpub') }, el('span', {}, shortNpub(pk)), icon('copy', 14));
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(npub); copy.querySelector('span').textContent = t('shell.copied'); setTimeout(() => { copy.querySelector('span').textContent = shortNpub(pk); }, 1500); } catch { /* presse-papiers refusé */ } });
    const follows = el('p', { class: 'drawer-follows' });
    getReplaceable(3, pk).then((ev) => { const n = ev ? parseContacts(ev).length : 0; follows.textContent = t('shell.following', { n }); }).catch(() => {});
    const link = (href, ic, label) => el('li', {}, el('a', { href }, icon(ic, 20), el('span', {}, label)));
    const items = [link('#/profile', 'user', t('nav.profile')), link('#/bookmarks', 'bookmark', t('nav.bookmarks')), link('#/messages', 'mail', t('nav.messages'))];
    if (getSigner()) items.push(link('#/settings/wallet', 'wallet', t('menu.wallet')));
    items.push(link('#/settings/mute', 'mute', t('menu.mute')), link('#/settings', 'settings', t('nav.settings')));
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
      el('div', { class: 'drawer-id' }, el('strong', {}, p?.displayName || p?.name || shortNpub(pk)), copy, follows), list, el('div', { class: 'drawer-foot' }, keep, out));
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
    const p = s ? getCached(s.pubkey) : null;
    const key = s ? [s.pubkey, s.method, p?.picture, p?.banner, p?.displayName, p?.name, !!getSigner(), state.get('settings')?.loadMedia].join('|') : '';
    if (key === sideKey) return;
    sideKey = key;
    if (s) fill(side, null); else side.replaceChildren();
  };
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
  fab.addEventListener('click', () => {
    const dlg = el('dialog', { class: 'compose-dialog', 'aria-label': t('shell.newPost') });
    const cancel = el('button', { type: 'button', class: 'btn btn-small' }, t('shell.cancel'));
    cancel.addEventListener('click', () => dlg.close());
    const form = composer({});
    const publish = el('button', { type: 'submit', class: 'btn btn-small btn-primary', form: form.id }, t('compose.send'));
    const me = state.get('session')?.pubkey;
    dlg.append(el('div', { class: 'sd-head' }, cancel, publish), el('div', { class: 'compose-row' }, me ? avatarNode(me) : null, form));
    dlg.addEventListener('close', () => { dlg.remove(); returnFocus(fab); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    dlg.showModal?.() ?? dlg.setAttribute('open', '');
    dlg.querySelector('textarea')?.focus();
  });
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
