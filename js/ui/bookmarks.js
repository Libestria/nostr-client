// Page « Favoris » : notes enregistrées par l'utilisateur (NIP-51, kind 10003).
import { t } from '../i18n.js';
import { state } from '../state.js';
import { pool } from '../relays/pool.js';
import { getEvent, putEvent } from '../storage/db.js';
import { onProfiles } from '../profiles.js';
import { bookmarkIds } from '../bookmarks.js';
import { el, pageTitle, stateBlock } from './common.js';
import { noteCard, updateAuthors } from './note.js';

const SHOWN = 100;

export function renderBookmarks(main) {
  const notes = new Map();
  const asked = new Set();
  let alive = true, timer = null, sub = null;
  const holder = el('div');
  const list = el('div', { class: 'notes' });
  main.replaceChildren(pageTitle('nav.bookmarks'), el('p', {}, el('a', { class: 'btn', href: '#/feed' }, t('thread.back'))), holder, list);

  function draw() {
    timer = null;
    if (!alive) return;
    const ids = bookmarkIds().slice(0, SHOWN);
    const state_ = state.get('bookmarks');
    if (!ids.length) { holder.replaceChildren(stateBlock(state_.loaded ? 'empty' : 'loading', state_.loaded ? 'bookmarks.empty' : 'state.loading')); list.replaceChildren(); return; }
    holder.replaceChildren();
    const cards = ids.map((id) => (notes.has(id) ? noteCard(notes.get(id)) : el('article', { class: 'note' }, el('p', { class: 'hint' }, t('bookmarks.missing')))));
    list.replaceChildren(...cards);
    updateAuthors(list);
    fetchMissing(ids);
  }
  const schedule = () => { timer ||= setTimeout(draw, 150); };

  function fetchMissing(ids) {
    const want = ids.filter((id) => !notes.has(id) && !asked.has(id));
    if (!want.length) return;
    want.forEach((id) => asked.add(id));
    Promise.all(want.map((id) => getEvent(id).then((ev) => { if (ev?.kind === 1) notes.set(id, ev); }).catch(() => {}))).then(() => {
      schedule();
      const rest = want.filter((id) => !notes.has(id));
      if (!rest.length || !alive) return;
      sub?.close();
      sub = pool.subscribe([{ ids: rest, limit: rest.length }], { closeOnEose: true, maxEvents: rest.length, onevent: (ev) => {
        if (ev.kind === 1 && rest.includes(ev.id)) { notes.set(ev.id, ev); putEvent(ev); schedule(); } } });
    });
  }

  const off = [state.on('bookmarks', schedule), onProfiles(() => list.isConnected && updateAuthors(list))];
  draw();
  return () => { alive = false; clearTimeout(timer); sub?.close(); off.forEach((f) => f?.()); };
}
