import { t } from '../i18n.js';
import { state } from '../state.js';
import { el, pageTitle, closeButton, returnFocus, setStatus } from './common.js';
import { npubEncode } from '../nostr/nip19.js';
import { hasExtension, connectExtension, setSession, setRemoteSession, logout, takeReturnTo } from '../auth.js';
import { connectBunker, startNostrConnect } from '../nostr/nip46.js';
import { pool } from '../relays/pool.js';
import { bootRelays } from '../account.js';
import { qrSvg } from './qr.js';
import { icon } from './icons.js';
import { pushPage } from './sheetnav.js';
import { toast } from './toast.js';


function renderConnected(main, session) {
  const npub = npubEncode(session.pubkey);
  const out = el('button', { type: 'button', class: 'btn' }, t('login.logout'));
  out.addEventListener('click', () => { logout(); renderLogin(main); });
  main.replaceChildren(pageTitle('nav.login'),
    el('p', {}, t(`login.connected.${session.method}`)),
    el('p', { class: 'ident' }, npub),
    el('div', { class: 'row' }, el('a', { class: 'btn', href: `#/profile/${npub}` }, t('nav.profile')), out));
}

export function renderLogin(main) {
  const session = state.get('session');
  if (session) return renderConnected(main, session);

  // Logo Libestria (WebP animé, fichier à déposer dans img/ à côté de index.html) ; sa taille grandit avec l'écran (voir le CSS)
  const logo = el('div', { class: 'login-logo' },
    el('img', { src: 'img/logo-libestria.webp', alt: 'Libestria', width: 128, height: 128, decoding: 'async' }));
  const welcome = el('div', { class: 'login-welcome' },
    el('h2', {}, t('login.welcome.title')),
    el('p', {}, t('login.welcome.tagline')),
    el('p', {}, ...t('login.welcome.keys').split(/(NIP-\d+)/).map((x) => (/^NIP-\d+$/.test(x) ? el('span', { class: 'nowrap' }, x) : x))));   // « NIP-07 » ne se coupe pas en fin de ligne
  const cta = el('button', { type: 'button', class: 'btn btn-primary login-cta', 'aria-haspopup': 'dialog' }, t('login.cta'));
  cta.addEventListener('click', () => openLoginMenu(cta));
  main.replaceChildren(pageTitle('nav.login'), logo, welcome, el('div', { class: 'login-cta-wrap' }, cta));
}

// Menu « Se connecter » : une rubrique par mode, un sous-menu pour chacune
function openLoginMenu(opener) {
  const dlg = el('dialog', { class: 'note-menu login-menu', 'aria-label': t('login.cta'), tabindex: '-1', autofocus: '' });
  const close = closeButton(t('shell.menu.close'));
  close.addEventListener('click', () => dlg.close());
  // Connexion réussie : message vert en bas, le menu se ferme, retour à la page demandée
  const finish = (method) => { toast(t(`login.connected.${method}`), { kind: 'ok' }); dlg.close(); location.hash = takeReturnTo(); };
  // Un message d'état par page (rouge : erreur, vert : succès, blanc : en cours)
  const page = () => {
    const msg = el('p', { class: 'status nm-msg', role: 'status' });
    return { msg, setMsg: (text, kind = false) => setStatus(msg, text, kind === true ? 'error' : kind === 'ok' ? 'ok' : 'info') };
  };
  const open = (titleKey, build) => (node) => { const { msg, setMsg } = page(); pushPage(dlg, { title: t(titleKey), body: [build(setMsg, finish), msg], opener: node }); };

  const items = [
    ['puzzle', 'login.ext.title', open('login.ext.title', (setMsg) => extensionPage(setMsg, finish))],
    ['lock', 'login.bunker.title', open('login.bunker.title', (setMsg) => bunkerSection(setMsg, finish))],
    ['link', 'login.nc.title', open('login.nc.title', (setMsg) => nostrConnectSection(setMsg, finish))],
  ];
  const list = el('ul', { class: 'drawer-list nm-list' });
  for (const [ic, key, run] of items) {
    const b = el('button', { type: 'button', 'aria-haspopup': 'true' }, icon(ic, 20), el('span', {}, t(key)), el('span', { class: 'nm-chev', 'aria-hidden': 'true' }, icon('chevron', 18)));
    b.addEventListener('click', () => run(b));
    list.append(el('li', {}, b));
  }
  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, t('login.cta')), close), list);
  dlg.addEventListener('close', () => { dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}

// Extension de navigateur (NIP-07) : sans extension, seulement le message d'aide (pas de bouton grisé)
function extensionPage(setMsg, finish) {
  if (!hasExtension()) return el('div', { class: 'login-page' }, el('p', { class: 'hint' }, t('login.ext.missing')));
  const btn = el('button', { type: 'button', class: 'btn' }, t('login.ext.button'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      setSession(await connectExtension());
      finish('nip07');
    } catch {
      setMsg(t('login.ext.denied'), true);
      btn.disabled = false;
    }
  });
  return el('div', { class: 'login-page' }, el('p', { class: 'hint' }, t('login.ext.hint')), btn);
}

const errKey = (e) => ({ invalid: 'login.bunker.invalid', 'no-relays': 'login.bunker.noRelays', timeout: 'login.bunker.timeout', unsupported: 'login.bunker.unsupported', cancelled: 'login.bunker.cancelled' })[e?.code] || 'login.bunker.failed';

function bunkerSection(setMsg, finish) {
  const input = el('input', { type: 'text', id: 'bunker', name: 'bunker', placeholder: 'bunker://…', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': t('login.bunker.label'), 'aria-describedby': 'bunker-hint' });
  const go = el('button', { type: 'submit', class: 'btn' }, t('login.bunker.button'));
  const form = el('form', { class: 'form' }, el('div', { class: 'field login-field' },
    el('p', { class: 'hint', id: 'bunker-hint' }, t('login.bunker.hint')),
    el('div', { class: 'row' }, input, go)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    if (/^(nsec|ncryptsec)1/i.test(value)) { input.value = ''; return setMsg(t('login.nsec'), true); }
    go.disabled = true; setMsg(t('login.bunker.waiting'));
    try {
      const info = await connectBunker(value);
      input.value = '';
      setRemoteSession(info);
      finish('nip46');
    } catch (err) { setMsg(t(errKey(err)), true); go.disabled = false; }
  });

  return el('div', { class: 'login-page' }, form, el('p', { class: 'hint' }, t('login.sameDevice.bunker')));
}

function nostrConnectSection(setMsg, finish) {
  // Connexion initiée ici : lien nostrconnect:// (et code QR) présenté dans une fenêtre en haut de l'écran.
  // Fermer la fenêtre (✕, Annuler, Échap, clic sur le fond) abandonne la connexion en attente.
  const gen = el('button', { type: 'button', class: 'btn' }, t('login.nc.button'));
  gen.addEventListener('click', async () => {
    gen.disabled = true; setMsg('');
    let dlg = null, mine = null, finished = false;
    const end = () => { gen.disabled = false; dlg?.remove(); dlg = null; };
    try {
      // Sans session, le pool n'a pas encore de relais d'écriture : on se replie sur les relais d'amorçage.
      let relays = pool.status().filter((r) => r.write).map((r) => r.url);
      if (!relays.length) { try { relays = await bootRelays(); } catch { relays = []; } }
      mine = await startNostrConnect({ relays, name: 'Client Nostr Libestria', url: location.origin });
      const title = el('h2', { id: 'nc-title' }, t('login.nc.title'));
      const x = closeButton(t('zap.close'));
      const copy = el('button', { type: 'button', class: 'btn' }, t('login.nc.copy'));
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(mine.uri); setMsg(t('profile.copied'), 'ok'); } catch { setMsg(t('profile.copyFail'), true); } });
      const cancel = el('button', { type: 'button', class: 'btn' }, t('login.nc.cancel'));
      const qrSlot = el('div', { class: 'nc-qr' });
      dlg = el('dialog', { class: 'stats-dialog nc-dialog', 'aria-labelledby': 'nc-title', tabindex: '-1', autofocus: '' },
        el('div', { class: 'sd-bar' }, title, x),
        el('div', { class: 'nc-body' },
          el('p', { class: 'hint' }, t('login.nc.hint')), qrSlot,
          el('code', { class: 'nc-link' }, mine.uri),
          el('div', { class: 'nc-actions' }, copy, cancel),
          el('p', { class: 'hint nc-wait', role: 'status' }, t('login.nc.waiting'))));   // le message s'affiche en bandeau en bas de l'écran
      const closing = () => { if (!finished) mine.cancel(); setMsg(''); end(); };
      x.addEventListener('click', () => dlg.close());
      cancel.addEventListener('click', () => dlg.close());
      dlg.addEventListener('close', closing);
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // clic sur le fond
      document.body.append(dlg);
      dlg.showModal();
      qrSvg(mine.uri, t('login.nc.qr')).then((svg) => { if (dlg) qrSlot.append(svg); }).catch(() => {});   // sans bibliothèque : lien seul
      const info = await mine.wait();
      if (!dlg) { info.close?.(); return; }   // fermée entre-temps
      finished = true;
      dlg.close();
      setRemoteSession(info);
      finish('nip46');
    } catch (err) {
      if (err?.code !== 'cancelled') { setMsg(t(errKey(err)), true); }
      end();
    }
  });
  return el('div', { class: 'login-page' }, el('p', { class: 'hint' }, t('login.nc.or')), gen, el('p', { class: 'hint' }, t('login.sameDevice.nc')));
}
