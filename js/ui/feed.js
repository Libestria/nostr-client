import { t } from '../i18n.js';
import { state } from '../state.js';
import { pool } from '../relays/pool.js';
import { latest } from '../storage/db.js';
import { el, pageTitle, stateBlock, shortNpub, timeAgo } from './common.js';

const PAGE = 30;
const MAX_SHOWN = 150;

function noteCard(ev, relay) {
  const text = ev.content.length > 600 ? `${ev.content.slice(0, 600)}…` : ev.content;
  return el('article', { class: 'note' },
    el('div', { class: 'note-head' },
      el('span', { class: 'ident' }, shortNpub(ev.pubkey)),
      el('time', { datetime: new Date(ev.created_at * 1000).toISOString() }, timeAgo(ev.created_at))),
    el('p', { class: 'note-text' }, text),
    relay ? el('p', { class: 'note-via' }, t('note.relay', { relay: relay.replace(/^wss:\/\//, '') })) : null);
}

// Flux global brut : notes (kind 1) de tous les comptes, sur les relais de lecture.
export function renderFeed(main) {
  const notes = new Map();
  const via = new Map();
  const subs = [];
  let oldest = Infinity;
  let got = false;
  let queued = false;

  const status = el('p', { class: 'status', role: 'status' });
  const holder = el('div');
  const list = el('div', { class: 'notes' });
  const more = el('button', { type: 'button', class: 'btn' }, t('feed.more'));
  more.hidden = true;
  const login = state.get('session') ? [] : [el('p', {}, el('a', { class: 'btn', href: '#/login' }, t('login.cta')))];
  main.replaceChildren(pageTitle('nav.feed'), el('p', {}, t('feed.global')), status, holder, list, more, ...login);

  const setHolder = (kind, key) => holder.replaceChildren(...(kind ? [stateBlock(kind, key)] : []));
  const draw = () => {
    queued = false;
    const arr = [...notes.values()].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)).slice(0, MAX_SHOWN);
    list.replaceChildren(...arr.map((ev) => noteCard(ev, via.get(ev.id))));
  };
  const add = (ev, relay) => {
    if (ev.kind !== 1 || notes.has(ev.id)) return;
    notes.set(ev.id, ev);
    if (relay) via.set(ev.id, relay);
    oldest = Math.min(oldest, ev.created_at);
    got = true;
    setHolder(null);
    more.hidden = false;
    if (!queued) { queued = true; requestAnimationFrame(draw); }
  };
  const open = (filter, once) => subs.push(pool.subscribe([filter], {
    closeOnEose: once,
    onevent: add,
    oneose: () => { if (!got) setHolder('empty', 'feed.empty'); more.disabled = false; },
  }));

  more.addEventListener('click', () => {
    if (!Number.isFinite(oldest)) return;
    more.disabled = true;
    open({ kinds: [1], limit: PAGE, until: oldest - 1 }, true);
  });

  const refresh = () => {
    const st = pool.status();
    status.textContent = t('feed.relays', { open: st.filter((r) => r.state === 'open').length, total: st.length });
  };
  const stop = pool.onChange(refresh);
  refresh();
  setHolder('loading', 'state.loading');
  latest({ kinds: [1], limit: PAGE }).then((evs) => evs.forEach((ev) => add(ev)));
  open({ kinds: [1], limit: PAGE }, false);
  const timer = setTimeout(() => {
    if (!got && pool.status().every((r) => r.state !== 'open')) setHolder('error', 'feed.noRelays');
  }, 10000);

  return () => { stop(); clearTimeout(timer); subs.forEach((s) => s.close()); };
}

export function placeholder(titleKey) {
  return (main) => main.replaceChildren(pageTitle(titleKey), stateBlock('empty', 'state.soon'));
}
