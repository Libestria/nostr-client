import { t } from '../i18n.js';
import { state } from '../state.js';
import { el, pageTitle } from './common.js';
import { decode, Nip19Error, npubEncode } from '../nostr/nip19.js';
import { resolveNip05 } from '../nostr/nip05.js';
import { hasExtension, connectExtension, readOnlySession, setSession, setRemoteSession, logout } from '../auth.js';
import { connectBunker, startNostrConnect } from '../nostr/nip46.js';
import { pool } from '../relays/pool.js';

const section = (titleKey, ...kids) => el('section', {}, el('h2', { class: 'section-title' }, t(titleKey)), ...kids);

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
  const setMsg = (text, error = false) => { msg.textContent = text; msg.classList.toggle('status-error', error); };

  // Extension NIP-07
  const extBtn = el('button', { type: 'button', class: 'btn', disabled: !hasExtension() }, t('login.ext.button'));
  extBtn.addEventListener('click', async () => {
    extBtn.disabled = true;
    try {
      setSession(await connectExtension());
      location.hash = '#/feed';
    } catch {
      setMsg(t('login.ext.denied'), true);
      extBtn.disabled = false;
    }
  });

  // Lecture seule
  const input = el('input', { type: 'text', id: 'ro-id', name: 'ro-id', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-describedby': 'ro-hint' });
  const roBtn = el('button', { type: 'submit', class: 'btn' }, t('login.ro.button'));
  const form = el('form', { class: 'form' },
    el('div', { class: 'field' },
      el('label', { for: 'ro-id' }, t('login.ro.label')),
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
    location.hash = '#/feed';
  });

  main.replaceChildren(pageTitle('nav.login'),
    section('login.ext.title', el('p', {}, t(hasExtension() ? 'login.ext.hint' : 'login.ext.missing')), extBtn),
    section('login.ro.title', form),
    section('login.bunker.title', bunkerSection(setMsg)),
    msg);
}

const errKey = (e) => ({ invalid: 'login.bunker.invalid', 'no-relays': 'login.bunker.noRelays', timeout: 'login.bunker.timeout', unsupported: 'login.bunker.unsupported', cancelled: 'login.bunker.cancelled' })[e?.code] || 'login.bunker.failed';

function bunkerSection(setMsg) {
  const input = el('input', { type: 'text', id: 'bunker', name: 'bunker', placeholder: 'bunker://…', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-describedby': 'bunker-hint' });
  const go = el('button', { type: 'submit', class: 'btn' }, t('login.bunker.button'));
  const form = el('form', { class: 'form' }, el('div', { class: 'field' },
    el('label', { for: 'bunker' }, t('login.bunker.label')), el('p', { class: 'hint', id: 'bunker-hint' }, t('login.bunker.hint')),
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
      location.hash = '#/feed';
    } catch (err) { setMsg(t(errKey(err)), true); go.disabled = false; }
  });

  // Connexion initiée ici : lien nostrconnect:// à ouvrir dans l'application de signature
  const linkBox = el('div');
  const gen = el('button', { type: 'button', class: 'btn' }, t('login.nc.button'));
  gen.addEventListener('click', async () => {
    gen.disabled = true; setMsg('');
    try {
      const relays = pool.status().filter((r) => r.write).map((r) => r.url);
      const mine = await startNostrConnect({ relays, name: 'Client Nostr Libestria', url: location.origin });
      const open = el('a', { class: 'btn', href: mine.uri }, t('login.nc.open'));
      const copy = el('button', { type: 'button', class: 'btn' }, t('login.nc.copy'));
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(mine.uri); setMsg(t('profile.copied')); } catch { setMsg(t('profile.copyFail'), true); } });
      const cancel = el('button', { type: 'button', class: 'btn' }, t('login.nc.cancel'));
      cancel.addEventListener('click', () => { mine.cancel(); linkBox.replaceChildren(); gen.disabled = false; setMsg(''); });
      linkBox.replaceChildren(el('p', { class: 'hint' }, t('login.nc.hint')), el('div', { class: 'row' }, open, copy, cancel));
      setMsg(t('login.nc.waiting'));
      const info = await mine.wait();
      if (!linkBox.isConnected) { info.close?.(); return; } // annulé ou page quittée entre-temps
      setRemoteSession(info);
      location.hash = '#/feed';
    } catch (err) {
      if (err?.code !== 'cancelled') { linkBox.replaceChildren(); setMsg(t(errKey(err)), true); }
      gen.disabled = false;
    }
  });
  return el('div', {}, form, el('p', { class: 'hint' }, t('login.nc.or')), gen, linkBox);
}
