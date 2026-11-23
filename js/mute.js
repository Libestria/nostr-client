// Sourdine : liste NIP-51 (kind 10000) du compte, chargée à l'ouverture et modifiée par un événement signé.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getSigner } from './auth.js';
import { getReplaceable, putEvent } from './storage/db.js';
import { latestEvent } from './nostr/relaylists.js';
import { parseMute, muteTemplate, muteReason, emptyMute } from './nostr/mute.js';
import { publishEvent } from './publish.js';

const blank = () => ({ ...emptyMute(), event: null });
state.set('mute', blank());

export const muteList = () => state.get('mute');
// Raison du masquage ('pubkey' | 'thread' | 'word' | 'hashtag') ou null. Ses propres notes ne sont jamais masquées.
export function isMuted(ev) {
  const me = state.get('session')?.pubkey;
  return me && ev?.pubkey === me ? null : muteReason(ev, state.get('mute'));
}
const apply = (event) => state.set('mute', { ...parseMute(event), event });

let token = 0, sub = null;
export async function loadMute(pubkey) {
  const my = ++token;
  sub?.close(); sub = null;
  const cached = await getReplaceable(10000, pubkey);
  if (my !== token) return;
  if (cached) apply(cached);
  const found = [];
  sub = pool.subscribe([{ kinds: [10000], authors: [pubkey], limit: 5 }], {
    closeOnEose: true, onevent: (ev) => { if (ev.kind === 10000 && ev.pubkey === pubkey) found.push(ev); },
    oneose: () => {
      if (my !== token) return;
      const best = latestEvent([cached, ...found].filter(Boolean), 10000);
      if (best && best !== state.get('mute').event) { apply(best); putEvent(best); }
    },
  });
}

// ops : voir muteTemplate. → résultat de publication { event, results, ok, total }
export async function editMute(ops) {
  if (!getSigner()) throw new Error('NO_SIGNER');
  const tpl = muteTemplate(state.get('mute').event, ops);
  const res = await publishEvent(tpl, { alsoBoot: true });
  if (res.ok) apply(res.event);
  return res;
}

export function initMute() {
  let owner = null, lastStatus = '';
  const refresh = () => {
    const s = state.get('session');
    if (!s) { token++; sub?.close(); sub = null; owner = null; state.set('mute', blank()); return; }
    if (owner !== s.pubkey) { owner = s.pubkey; state.set('mute', blank()); }
    if (state.get('lists').status === 'ready') loadMute(s.pubkey);
  };
  state.on('session', refresh);
  state.on('lists', (l) => { if (l.status !== lastStatus) { lastStatus = l.status; refresh(); } });
  refresh();
}
