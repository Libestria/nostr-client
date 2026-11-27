import { t } from '../i18n.js';
import { state } from '../state.js';
import { el, pageTitle } from './common.js';
import { decode, Nip19Error, npubEncode } from '../nostr/nip19.js';
import { resolveNip05 } from '../nostr/nip05.js';
import { hasExtension, connectExtension, readOnlySession, setSession, setRemoteSession, logout, takeReturnTo } from '../auth.js';
import { connectBunker, startNostrConnect } from '../nostr/nip46.js';
import { pool } from '../relays/pool.js';
import { bootRelays } from '../account.js';
import { qrSvg } from './qr.js';
import { icon } from './icons.js';

const section = (titleKey, ic, ...kids) => el('section', {}, el('h2', { class: 'section-title' }, icon(ic, 20), el('span', {}, t(titleKey))), ...kids);

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

  const msg = el('p', { class: 'status', role: 'status' });
  const setMsg = (text, kind = false) => { msg.textContent = text; msg.classList.toggle('status-error', kind === true); msg.classList.toggle('status-ok', kind === 'ok'); };

  // Extension NIP-07
  const extBtn = el('button', { type: 'button', class: 'btn', disabled: !hasExtension() }, t('login.ext.button'));
  extBtn.addEventListener('click', async () => {
    extBtn.disabled = true;
    try {
      setSession(await connectExtension());
      location.hash = takeReturnTo();
    } catch {
      setMsg(t('login.ext.denied'), true);
      extBtn.disabled = false;
    }
  });

  // Lecture seule
  const input = el('input', { type: 'text', id: 'ro-id', name: 'ro-id', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': t('login.ro.label'), 'aria-describedby': 'ro-hint' });
  const roBtn = el('button', { type: 'submit', class: 'btn' }, t('login.ro.button'));
  const form = el('form', { class: 'form' },
    el('div', { class: 'field login-field' },
      el('p', { class: 'hint', id: 'ro-hint' }, t('login.ro.hint')),
      el('div', { class: 'row' }, input, roBtn)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    if (/^(nsec|ncryptsec)1/i.test(value)) { input.value = ''; return setMsg(t('login.nsec'), true); }
    roBtn.disabled = true;
    let pubkey;
    try {
      if (/^(npub|nprofile)1/i.test(value)) {
        const d = decode(value);
        pubkey = d.type === 'npub' ? d.data : d.data.pubkey;
      } else {
        setMsg(t('profile.resolving'));
        pubkey = (await resolveNip05(value)).pubkey;
      }
    } catch (err) {
      roBtn.disabled = false;
      if (err instanceof Nip19Error && err.code === 'private-key') { input.value = ''; return setMsg(t('login.nsec'), true); }
      return setMsg(t(err instanceof Nip19Error || err.message === 'invalid' ? 'login.ro.invalid' : 'login.ro.nip05fail'), true);
    }
    setSession(readOnlySession(pubkey));
    location.hash = takeReturnTo();
  });

  main.replaceChildren(pageTitle('nav.login'),
    section('login.ro.title', 'eye', form),
    section('login.ext.title', 'puzzle', el('p', { class: 'hint' }, t(hasExtension() ? 'login.ext.hint' : 'login.ext.missing')), extBtn),
    section('login.bunker.title', 'lock', bunkerSection(setMsg)),
    section('login.nc.title', 'link', nostrConnectSection(setMsg)),
    msg);
}

const errKey = (e) => ({ invalid: 'login.bunker.invalid', 'no-relays': 'login.bunker.noRelays', timeout: 'login.bunker.timeout', unsupported: 'login.bunker.unsupported', cancelled: 'login.bunker.cancelled' })[e?.code] || 'login.bunker.failed';

function bunkerSection(setMsg) {
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
      location.hash = takeReturnTo();
    } catch (err) { setMsg(t(errKey(err)), true); go.disabled = false; }
  });

  return el('div', {}, form, el('p', { class: 'hint' }, t('login.sameDevice')));
}

function nostrConnectSection(setMsg) {
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
      const x = el('button', { type: 'button', class: 'sheet-x', 'aria-label': t('zap.close') }, '✕');
      const open = el('a', { class: 'btn', href: mine.uri }, t('login.nc.open'));
      const copy = el('button', { type: 'button', class: 'btn' }, t('login.nc.copy'));
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(mine.uri); setMsg(t('profile.copied'), 'ok'); } catch { setMsg(t('profile.copyFail'), true); } });
      const cancel = el('button', { type: 'button', class: 'btn' }, t('login.nc.cancel'));
      const qrSlot = el('div', { class: 'nc-qr' });
      dlg = el('dialog', { class: 'stats-dialog nc-dialog', 'aria-labelledby': 'nc-title', tabindex: '-1', autofocus: '' },
        el('div', { class: 'sd-bar' }, title, x),
        el('div', { class: 'nc-body' },
          el('p', { class: 'hint' }, t('login.nc.hint')), qrSlot,
          el('code', { class: 'nc-link' }, mine.uri),
          el('div', { class: 'nc-actions' }, open, copy),
          el('p', { class: 'hint nc-wait', role: 'status' }, t('login.nc.waiting')), cancel));
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
      location.hash = takeReturnTo();
    } catch (err) {
      if (err?.code !== 'cancelled') { setMsg(t(errKey(err)), true); }
      end();
    }
  });
  return el('div', {}, el('p', { class: 'hint' }, t('login.nc.or')), gen);
}
