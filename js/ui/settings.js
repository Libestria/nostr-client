import { validTemplate } from '../nostr/linkpreview.js';
import { t } from '../i18n.js';
import { state } from '../state.js';
import { updateSettings } from '../storage/settings.js';
import { pool } from '../relays/pool.js';
import { loadAccountLists, editList, publishListEvent } from '../account.js';
import { LIST_KEYS } from '../nostr/relaylists.js';
import { npubEncode } from '../nostr/nip19.js';
import { logout, getSigner, signerCapabilities } from '../auth.js';
import { walletSection } from './wallet.js';
import { muteSection } from './mute.js';
import { backupSection } from './backup.js';
import { el, pageTitle, publishKind } from './common.js';
import { icon } from './icons.js';

function select(id, labelKey, options, value, onChange) {
  const sel = el('select', { id, name: id },
    ...options.map(([v, labelK]) => el('option', { value: v, selected: v === value }, t(labelK))));
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'field' }, el('label', { for: id }, t(labelKey)), sel);
}

function checkbox(id, labelKey, hintKey, checked, onChange) {
  const box = el('input', { type: 'checkbox', id, name: id, checked, 'aria-describedby': `${id}-hint` });
  box.addEventListener('change', () => onChange(box.checked));
  return el('div', { class: 'field check' }, box, el('label', { for: id }, t(labelKey)),
    el('p', { class: 'hint', id: `${id}-hint` }, t(hintKey)));
}

function previewServiceField(s, save, status) {
  const input = el('input', { type: 'url', id: 'previewService', name: 'previewService', value: s.previewService, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'previewService-hint' });
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (!validTemplate(v)) { status.className = 'status status-error'; status.textContent = t('settings.previewService.invalid'); input.value = s.previewService; return; }
    s = { ...s, previewService: v }; save({ previewService: v });
  });
  return el('div', { class: 'field' }, el('label', { for: 'previewService' }, t('settings.previewService')), input,
    el('p', { class: 'hint', id: 'previewService-hint' }, t('settings.previewService.hint')));
}

const fmtDate = (ts) => new Intl.DateTimeFormat(document.documentElement.lang || 'fr', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(ts * 1000));

// Listes de relais du compte (10002 / 10007 / 10050) : version la plus récente, sa date, et édition.
// Chaque modification est signée puis publiée tout de suite (relais d'amorçage + relais de la liste).
const EDIT_ERRORS = { INVALID_URL: 'lists.err.url', DUPLICATE: 'lists.err.dup', MAX: 'lists.err.max', LAST: 'lists.err.last',
  NOT_FOUND: 'lists.err.url', INVALID_ROLE: 'lists.err.role', NO_SIGNER: 'lists.err.signer', SIGN_FAILED: 'lists.err.sign' };

function listsSection() {
  const refresh = el('button', { type: 'button', class: 'btn' }, t('lists.refresh'));
  refresh.addEventListener('click', () => { const s = state.get('session'); if (s) loadAccountLists(s.pubkey); });
  const status = el('p', { class: 'status', role: 'status' });
  let busy = false;
  const boxes = new Map();

  const roleSelect = (id, read, write) => el('select', { id, name: id },
    ...[['rw', 'role.rw'], ['r', 'role.r'], ['w', 'role.w']].map(([v, k]) =>
      el('option', { value: v, selected: v === (read && write ? 'rw' : read ? 'r' : 'w') }, t(k))));
  const roleOf = (v) => ({ read: v !== 'w', write: v !== 'r' });

  const run = async (key, op, box) => {
    if (busy) return;
    busy = true;
    box.msg.className = 'status';
    box.msg.replaceChildren(t('lists.publishing'));
    drawAll();
    try {
      const res = await editList(key, op, {
        signer: getSigner(),
        onProgress: (p) => box.msg.replaceChildren(t('lists.progress.pub', { done: p.done, total: p.total })),
      });
      showResult(box, key, res, null);
    } catch (e) {
      box.msg.className = 'status status-error';
      box.msg.replaceChildren(t(EDIT_ERRORS[e.message] ?? 'lists.err.generic'));
    } finally { busy = false; drawAll(true); }
  };

  const showResult = (box, key, res) => {
    box.msg.className = `status status-${publishKind(res)}`;
    const detail = el('details', {}, el('summary', {}, t('lists.details')),
      el('ul', { class: 'relays' }, ...res.results.map((r) => el('li', { class: 'relay' },
        el('span', { class: `dot dot-${r.ok ? 'open' : 'closed'}`, 'aria-hidden': 'true' }),
        el('div', { class: 'relay-body' }, el('span', { class: 'ident' }, r.url.replace(/^wss:\/\//, '')),
          el('span', { class: 'relay-meta' }, r.ok ? t('lists.accepted') : `${t('lists.refused')}${r.message ? ` : ${r.message}` : ''}`))))));
    const nodes = [el('span', {}, t(res.ok ? 'lists.published' : 'lists.publish.failed', { ok: res.ok, total: res.total })), detail];
    if (!res.ok) {
      const again = el('button', { type: 'button', class: 'btn' }, t('lists.retry'));
      again.addEventListener('click', async () => {
        if (busy) return;
        busy = true; again.disabled = true;
        try { showResult(box, key, await publishListEvent(key, res.event, null)); } finally { busy = false; drawAll(true); }
      });
      nodes.push(again);
    }
    box.msg.replaceChildren(...nodes);
  };

  const row = (key, box, r, live, editable) => {
    const meta = [];
    if (live) {
      meta.push(t(`relay.${live.state}`));
      if (live.state === 'open' && live.latency != null) meta.push(`${live.latency} ms`);
      if (live.authenticated) meta.push(t('relay.auth'));
    }
    const body = el('div', { class: 'relay-body' }, el('span', { class: 'ident' }, r.url.replace(/^wss:\/\//, '')));
    if (key === 'pub' && !editable) meta.unshift(t(r.read && r.write ? 'role.rw' : r.read ? 'role.r' : 'role.w'));
    if (meta.length) body.append(el('span', { class: 'relay-meta' }, meta.join(' · ')));
    const li = el('li', { class: 'relay' }, live ? el('span', { class: `dot dot-${live.state}`, 'aria-hidden': 'true' }) : null, body);
    if (editable) {
      if (key === 'pub') {
        const sel = roleSelect(`role-${key}-${r.url}`, r.read, r.write);
        sel.setAttribute('aria-label', t('lists.role.of', { relay: r.url.replace(/^wss:\/\//, '') }));
        sel.disabled = busy;
        sel.addEventListener('change', () => run(key, { type: 'role', url: r.url, ...roleOf(sel.value) }, box));
        li.append(sel);
      }
      const del = el('button', { type: 'button', class: 'btn btn-small', 'aria-label': t('lists.remove.of', { relay: r.url.replace(/^wss:\/\//, '') }) }, t('lists.remove'));
      del.disabled = busy;
      del.addEventListener('click', () => run(key, { type: 'remove', url: r.url }, box));
      li.append(del);
    }
    return li;
  };

  const makeBox = (key) => {
    const box = { key, date: el('p', { class: 'hint' }), ul: el('ul', { class: 'relays' }), msg: el('p', { class: 'status', role: 'status' }), sig: '' };
    const input = el('input', { type: 'text', id: `add-${key}`, name: `add-${key}`, placeholder: 'wss://relais.exemple.com', inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
    const sel = key === 'pub' ? roleSelect(`add-role-${key}`, true, true) : null;
    const add = el('button', { type: 'submit', class: 'btn' }, t('lists.add'));
    box.form = el('form', { class: 'add-relay' }, el('label', { for: `add-${key}` }, t('lists.add.label')), input, sel, add);
    box.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      await run(key, { type: 'add', url: v, ...(sel ? roleOf(sel.value) : {}) }, box);
      if (!box.msg.classList.contains('status-error')) input.value = '';
    });
    box.add = add;
    box.input = input;
    box.node = el('div', { class: 'relay-list' }, el('h3', { class: 'list-title' }, t(`lists.${key}`)), box.date, box.ul, box.form, box.msg);
    return box;
  };
  for (const key of LIST_KEYS) boxes.set(key, makeBox(key));

  function drawAll(force = false) {
    const lists = state.get('lists');
    const prog = state.get('listsProgress');
    const editable = !!getSigner();
    const live = new Map(pool.status().map((r) => [r.url, r]));
    status.textContent = prog.running ? (prog.total ? t('lists.progress', { done: prog.done, total: prog.total }) : t('lists.checking')) : '';
    refresh.disabled = prog.running;
    for (const [key, box] of boxes) {
      const info = lists[key];
      box.date.textContent = info ? t('lists.date', { date: fmtDate(info.created_at) }) : t(lists.status === 'loading' || prog.running ? 'lists.checking' : 'lists.none');
      box.form.hidden = !editable;
      box.add.disabled = busy;
      box.input.disabled = busy;
      const sig = JSON.stringify([info?.event?.id, editable, busy, key === 'pub' || key === 'dm' ? [...live.values()].map((r) => [r.url, r.state, r.latency, r.authenticated]) : 0]);
      if (sig === box.sig || (!force && box.ul.contains(document.activeElement))) continue; // pas de reconstruction pendant une saisie (sauf fin d'édition)
      box.sig = sig;
      box.ul.replaceChildren(...(info?.relays ?? []).map((r) => row(key, box, r, key === 'pub' || key === 'dm' ? live.get(r.url) : null, editable)));
    }
  }
  const offs = [state.on('lists', () => drawAll()), state.on('listsProgress', () => drawAll()), pool.onChange(() => drawAll())];
  drawAll();
  const hint = getSigner() ? el('p', { class: 'hint' }, t('lists.edit.hint')) : el('p', { class: 'hint' }, t('lists.readonly.hint'));
  return { node: el('section', {}, el('h2', { class: 'section-title' }, t('settings.lists')), hint, ...[...boxes.values()].map((b) => b.node), el('div', { class: 'row' }, refresh), status), stop: () => offs.forEach((f) => f()) };
}

function accountSection() {
  const s = state.get('session');
  if (!s) return el('section', {}, el('h2', { class: 'section-title' }, t('settings.account')), el('p', {}, t('settings.account.none')),
    el('a', { class: 'btn', href: '#/login' }, t('login.cta')));
  const caps = signerCapabilities(s);
  const out = el('button', { type: 'button', class: 'btn' }, t('login.logout'));
  out.addEventListener('click', () => { logout(); location.hash = '#/login'; });
  return el('section', {}, el('h2', { class: 'section-title' }, t('settings.account')),
    el('p', {}, t(`login.connected.${s.method}`)), el('p', { class: 'ident' }, npubEncode(s.pubkey)),
    ...(s.method === 'readonly' ? [] : [el('p', { class: 'hint' }, t('settings.signer.nip44', { state: t(`settings.signer.${caps.nip44}`) })),
      ...(caps.nip44 === 'no' ? [el('p', { class: 'hint' }, t('settings.signer.nip44.missing'))] : [])]), out);
}

// Rubriques des réglages (comme Nostur) : une liste, puis une page par rubrique.
const SECTIONS = [
  { id: 'account', icon: 'user', needs: null },
  { id: 'appearance', icon: 'settings', needs: null },
  { id: 'general', icon: 'search', needs: null },
  { id: 'relays', icon: 'repost', needs: 'session' },
  { id: 'mute', icon: 'mute', needs: 'session' },
  { id: 'wallet', icon: 'wallet', needs: 'signer' },
  { id: 'backup', icon: 'copy', needs: 'session' },
];
const available = (sec) => sec.needs === null || (sec.needs === 'session' ? !!state.get('session') : !!getSigner());

export function renderSettings(main, params = []) {
  const s = state.get('settings');
  const sec = SECTIONS.find((x) => x.id === params[0] && available(x));
  if (!sec) {
    main.replaceChildren(pageTitle('nav.settings'), el('ul', { class: 'drawer-list settings-menu' },
      ...SECTIONS.filter(available).map((x) => el('li', {}, el('a', { href: `#/settings/${x.id}` }, icon(x.icon, 20), el('span', {}, t(`settings.sec.${x.id}`)), icon('chevron', 18))))));
    return undefined;
  }
  const status = el('p', { class: 'status', role: 'status' });
  const save = (patch) => {
    state.set('settings', updateSettings(patch));
    status.className = 'status status-ok'; status.textContent = t('settings.saved');
  };
  const form = (...fields) => { const f = el('form', { class: 'form' }, ...fields, status); f.addEventListener('submit', (e) => e.preventDefault()); return f; };
  let stop = null;
  let body;
  if (sec.id === 'account') body = accountSection();
  else if (sec.id === 'appearance') body = form(
    select('theme', 'settings.theme', [['auto', 'theme.auto'], ['light', 'theme.light'], ['dark', 'theme.dark']], s.theme, (v) => save({ theme: v })),
    select('lang', 'settings.lang', [['fr', 'lang.fr'], ['en', 'lang.en']], s.lang, (v) => save({ lang: v })),
    select('threadMode', 'settings.threadMode', [['flat', 'threadMode.flat'], ['nested', 'threadMode.nested']], s.threadMode ?? 'flat', (v) => save({ threadMode: v })));
  else if (sec.id === 'general') {
    const f = form(
      checkbox('loadMedia', 'settings.media', 'settings.media.hint', s.loadMedia, (v) => save({ loadMedia: v })),
      checkbox('linkPreviews', 'settings.previews', 'settings.previews.hint', s.linkPreviews !== false, (v) => save({ linkPreviews: v })),
      previewServiceField(s, save, status),
      checkbox('readOnly', 'settings.readOnly', 'settings.readOnly.hint', s.readOnly, (v) => save({ readOnly: v })),
      ...(typeof Notification !== 'undefined' ? [checkbox('browserNotify', 'settings.notify', 'settings.notify.hint', s.browserNotify, async (v) => {
        if (v && Notification.permission !== 'granted') {
          let perm = 'denied';
          try { perm = await Notification.requestPermission(); } catch { /* refusé */ }
          if (perm !== 'granted') { status.className = 'status status-error'; status.textContent = t('settings.notify.denied'); const box = f.querySelector('input[name=browserNotify]'); if (box) box.checked = false; return; }
        }
        save({ browserNotify: v });
      })] : []));
    body = f;
  } else if (sec.id === 'relays') { const l = listsSection(); body = l.node; stop = l.stop; }
  else if (sec.id === 'mute') { const m = muteSection(); body = m.node; stop = m.stop; }
  else if (sec.id === 'wallet') body = walletSection();
  else body = backupSection();
  main.replaceChildren(pageTitle(`settings.sec.${sec.id}`), el('p', {}, el('a', { class: 'btn', href: '#/settings' }, t('settings.back'))), body);
  return () => stop?.();
}
