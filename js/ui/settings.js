import { t } from '../i18n.js';
import { state } from '../state.js';
import { updateSettings } from '../storage/settings.js';
import { pool } from '../relays/pool.js';
import { loadAccountLists } from '../account.js';
import { LIST_KEYS } from '../nostr/relaylists.js';
import { npubEncode } from '../nostr/nip19.js';
import { logout } from '../auth.js';
import { el, pageTitle } from './common.js';

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

const fmtDate = (ts) => new Intl.DateTimeFormat(document.documentElement.lang || 'fr', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(ts * 1000));

// Listes de relais du compte (10002 / 10007 / 10050) : affichage de la version la plus récente et de sa date.
function listsSection() {
  const body = el('div');
  const refresh = el('button', { type: 'button', class: 'btn' }, t('lists.refresh'));
  refresh.addEventListener('click', () => { const s = state.get('session'); if (s) loadAccountLists(s.pubkey, { force: true }); });
  const status = el('p', { class: 'status', role: 'status' });

  const row = (r, live, showRole) => {
    const meta = [];
    if (showRole) meta.push(t(r.read && r.write ? 'role.rw' : r.read ? 'role.r' : 'role.w'));
    if (live) {
      meta.push(t(`relay.${live.state}`));
      if (live.state === 'open' && live.latency != null) meta.push(`${live.latency} ms`);
    }
    return el('li', { class: 'relay' },
      live ? el('span', { class: `dot dot-${live.state}`, 'aria-hidden': 'true' }) : null,
      el('div', { class: 'relay-body' }, el('span', { class: 'ident' }, r.url.replace(/^wss:\/\//, '')),
        meta.length ? el('span', { class: 'relay-meta' }, meta.join(' · ')) : null));
  };
  const draw = () => {
    const lists = state.get('lists');
    const prog = state.get('listsProgress');
    const live = new Map(pool.status().map((r) => [r.url, r]));
    status.textContent = prog.running ? (prog.total ? t('lists.progress', { done: prog.done, total: prog.total }) : t('lists.checking')) : '';
    refresh.disabled = prog.running;
    body.replaceChildren(...LIST_KEYS.map((key) => {
      const info = lists[key];
      return el('div', { class: 'relay-list' },
        el('h3', { class: 'list-title' }, t(`lists.${key}`)),
        info ? el('p', { class: 'hint' }, t('lists.date', { date: fmtDate(info.created_at) })) : el('p', { class: 'hint' }, t(lists.status === 'loading' || prog.running ? 'lists.checking' : 'lists.none')),
        info?.relays.length ? el('ul', { class: 'relays' }, ...info.relays.map((r) => row(r, key === 'pub' ? live.get(r.url) : null, key === 'pub'))) : null);
    }));
  };
  const offs = [state.on('lists', draw), state.on('listsProgress', draw), pool.onChange(draw)];
  draw();
  return { node: el('section', {}, el('h2', { class: 'section-title' }, t('settings.lists')), body, el('div', { class: 'row' }, refresh), status), stop: () => offs.forEach((f) => f()) };
}

function accountSection() {
  const s = state.get('session');
  if (!s) return el('section', {}, el('h2', { class: 'section-title' }, t('settings.account')), el('p', {}, t('settings.account.none')),
    el('a', { class: 'btn', href: '#/login' }, t('login.cta')));
  const out = el('button', { type: 'button', class: 'btn' }, t('login.logout'));
  out.addEventListener('click', () => { logout(); location.hash = '#/login'; });
  return el('section', {}, el('h2', { class: 'section-title' }, t('settings.account')),
    el('p', {}, t(`login.connected.${s.method}`)), el('p', { class: 'ident' }, npubEncode(s.pubkey)), out);
}

export function renderSettings(main) {
  const s = state.get('settings');
  const status = el('p', { class: 'status', role: 'status' });
  const save = (patch) => {
    state.set('settings', updateSettings(patch));
    status.textContent = t('settings.saved');
  };
  const form = el('form', { class: 'form' },
    select('theme', 'settings.theme', [['auto', 'theme.auto'], ['light', 'theme.light'], ['dark', 'theme.dark']], s.theme, (v) => save({ theme: v })),
    select('lang', 'settings.lang', [['fr', 'lang.fr'], ['en', 'lang.en']], s.lang, (v) => save({ lang: v })),
    checkbox('loadMedia', 'settings.media', 'settings.media.hint', s.loadMedia, (v) => save({ loadMedia: v })),
    checkbox('readOnly', 'settings.readOnly', 'settings.readOnly.hint', s.readOnly, (v) => save({ readOnly: v })),
    status);
  form.addEventListener('submit', (e) => e.preventDefault());
  const lists = state.get('session') ? listsSection() : null;
  main.replaceChildren(pageTitle('nav.settings'), accountSection(), form, ...(lists ? [lists.node] : []));
  return lists?.stop;
}
