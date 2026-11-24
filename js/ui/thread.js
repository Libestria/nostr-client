// Page d'un fil de discussion : racine, réponses en arbre, note ciblée mise en évidence.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { pool } from '../relays/pool.js';
import { getEvent, putEvent, latest } from '../storage/db.js';
import { decode } from '../nostr/nip19.js';
import { buildThread, rootId } from '../nostr/thread.js';
import { onProfiles } from '../profiles.js';
import { el, pageTitle, stateBlock } from './common.js';
import { noteCard, updateAuthors } from './note.js';

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_EVENTS = 400;

function parseRef(ref) {
  if (HEX64.test(ref)) return ref;
  try {
    const d = decode(ref);
    if (d.type === 'note') return d.data;
    if (d.type === 'nevent') return d.data.id;
  } catch { /* référence invalide */ }
  return null;
}

export function renderThread(main, params) {
  const title = pageTitle('nav.note');
  const focusId = parseRef(params[0] ?? '');
  if (!focusId) { main.replaceChildren(title, stateBlock('error', 'thread.invalid')); return undefined; }

  const events = new Map();
  const subs = [];
  let alive = true, drawTimer = null, asked = null;
  const holder = el('div');
  const tree = el('div', { class: 'thread' });
  const status = el('p', { class: 'status', role: 'status' });
  main.replaceChildren(title, el('p', {}, el('a', { class: 'btn', href: '#/feed' }, t('thread.back'))), holder, tree, status);
  holder.replaceChildren(stateBlock('loading', 'state.loading'));

  const schedule = () => { drawTimer ||= setTimeout(draw, 150); };
  function draw() {
    drawTimer = null;
    if (!alive) return;
    const { roots } = buildThread([...events.values()], focusId);
    if (!roots.length) return;
    holder.replaceChildren();
    const render = (node) => {
      const card = noteCard(node.event, { detail: node.event.id === focusId });
      if (node.event.id === focusId) card.classList.add('note-focus');
      const li = el('li', { class: 'thread-item', 'data-depth': node.depth }, card);
      if (node.children.length) {
        // au-delà de la profondeur maximale, les réponses restent au même niveau (plus de décalage)
        li.append(el('ul', { class: node.depth >= 6 ? 'thread-flat' : 'thread-children' }, ...node.children.map(render)));
      }
      return li;
    };
    tree.replaceChildren(el('ul', { class: 'thread-root' }, ...roots.map(render)));
    updateAuthors(tree);
    if (!events.has(focusId)) status.textContent = t('thread.missing');
    else status.textContent = '';
  }

  function add(ev) {
    if (!alive || (ev.kind !== 1 && !(ev.kind === 30023 && ev.id === focusId)) || events.has(ev.id) || events.size >= MAX_EVENTS) return;
    events.set(ev.id, ev);
    if (ev.id === focusId) askThread(ev);
    schedule();
  }

  // Une fois la note ciblée connue, on charge sa racine et toutes les réponses au fil.
  function askThread(focus) {
    const root = rootId(focus) ?? focus.id;
    if (asked === root) return;
    asked = root;
    const ids = [...new Set([root, focus.id])];
    latest({ kinds: [1], limit: 500 }).then((evs) => evs.filter((e) => e.tags.some((tg) => tg[0] === 'e' && ids.includes(tg[1]))).forEach(add));
    subs.push(pool.subscribe([
      ...(root !== focus.id ? [{ ids: [root] }] : []),
      { kinds: [1], '#e': ids, limit: 200 },
    ], { closeOnEose: true, onevent: add, maxEvents: MAX_EVENTS,
      oneose: () => { if (!events.has(root)) status.textContent = t('thread.rootMissing'); } }));
  }

  getEvent(focusId).then((ev) => ev && add(ev));
  subs.push(pool.subscribe([{ ids: [focusId] }], { closeOnEose: true, onevent: (ev) => { add(ev); if (ev.kind === 1) putEvent(ev); },
    oneose: () => { if (!events.has(focusId)) holder.replaceChildren(stateBlock('error', 'thread.notFound')); } }));

  const stopProfiles = onProfiles(() => updateAuthors(tree));
  const stopPublished = state.on('published', (ev) => { if (ev?.kind === 1) add(ev); });
  return () => { alive = false; clearTimeout(drawTimer); stopProfiles(); stopPublished(); subs.forEach((s) => s.close()); };
}
