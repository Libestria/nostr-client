// Favoris : liste NIP-51 (kind 10003) chargée à l'ouverture, modifiée par un événement signé et publié aussitôt.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getSigner } from './auth.js';
import { getReplaceable, putEvent } from './storage/db.js';
import { latestEvent } from './nostr/relaylists.js';
import { parseBookmarks, bookmarksTemplate } from './nostr/bookmarks.js';
import { publishEvent } from './publish.js';

const blank = () => ({ ids: [], event: null, loaded: false });
state.set('bookmarks', blank());

export const bookmarkIds = () => state.get('bookmarks').ids;
export const isBookmarked = (id) => state.get('bookmarks').ids.includes(id);
const apply = (event) => state.set('bookmarks', { ids: parseBookmarks(event), event, loaded: true });

let token = 0, sub = null;
export async function loadBookmarks(pubkey) {
  const my = ++token;
  sub?.close(); sub = null;
  const cached = await getReplaceable(10003, pubkey);
  if (my !== token) return;
  if (cached) apply(cached);
  const found = [];
  sub = pool.subscribe([{ kinds: [10003], authors: [pubkey], limit: 5 }], {
    closeOnEose: true, onevent: (ev) => { if (ev.kind === 10003 && ev.pubkey === pubkey) found.push(ev); },
    oneose: () => {
      if (my !== token) return;
      const best = latestEvent([cached, ...found].filter(Boolean), 10003);
      if (best && best !== state.get('bookmarks').event) { apply(best); putEvent(best); }
      else state.set('bookmarks', { ...state.get('bookmarks'), loaded: true });
    },
  });
}

// Ajoute ou retire un favori. → résultat de publication { event, results, ok, total }
export async function setBookmark(id, on) {
  if (!getSigner()) throw new Error('NO_SIGNER');
  // pas de liste connue : on attend la fin du chargement pour ne jamais écraser une liste existante
  if (!state.get('bookmarks').loaded) throw new Error('NOT_LOADED');
  const tpl = bookmarksTemplate(state.get('bookmarks').event, { type: on ? 'add' : 'remove', id });
  const res = await publishEvent(tpl, { alsoBoot: true });
  if (res.ok) apply(res.event);
  return res;
}

export function initBookmarks() {
  let owner = null, lastStatus = '';
  const refresh = () => {
    const s = state.get('session');
    if (!s) { token++; sub?.close(); sub = null; owner = null; state.set('bookmarks', blank()); return; }
    if (owner !== s.pubkey) { owner = s.pubkey; state.set('bookmarks', blank()); }
    if (state.get('lists').status === 'ready') loadBookmarks(s.pubkey);
  };
  state.on('session', refresh);
  state.on('lists', (l) => { if (l.status !== lastStatus) { lastStatus = l.status; refresh(); } });
  refresh();
}
