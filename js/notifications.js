// Centre de notifications : mentions, réponses, réactions, reposts, zaps (vérifiés). Un seul abonnement continu.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getCached, requestProfile } from './profiles.js';
import { classify, NOTIF_KINDS } from './nostr/notif.js';
import { checkReceipt } from './nostr/nip57.js';
import { lnurlInfo } from './zap.js';
import { muteReason } from './nostr/mute.js';
import { t } from './i18n.js';

const MAX_ITEMS = 200;
const WEEK = 7 * 86400;
const seenKey = (pk) => `nostr-client:notif-seen:${pk}`;
const readSeen = (pk) => { try { const v = Number(localStorage.getItem(seenKey(pk))); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
const writeSeen = (pk, v) => { try { localStorage.setItem(seenKey(pk), String(v)); } catch { /* indisponible */ } };

let me = null, sub = null, items = new Map(), lastSeen = 0, live = false, startedAt = 0, gen = 0;
state.set('notif', { items: [], unread: 0 });

const publish = () => {
  const list = [...items.values()].sort((a, b) => b.created_at - a.created_at).slice(0, MAX_ITEMS);
  state.set('notif', { items: list, unread: list.filter((n) => n.created_at > lastSeen).length });
};

async function verifyZap(ev) {
  const lud16 = getCached(me)?.lud16;
  if (!lud16) return null;
  try { return checkReceipt(ev, { recipient: me, nostrPubkey: (await lnurlInfo(lud16)).nostrPubkey }); } catch { return null; }
}

async function take(ev, run) {
  if (items.has(ev.id)) return;
  const c = classify(ev, me);
  if (!c) return;
  const mute = state.get('mute');
  let n = { id: ev.id, ...c, created_at: ev.created_at, content: String(ev.content ?? '').slice(0, 300) };
  if (c.type === 'zap') {
    const z = await verifyZap(ev);
    if (!z || run !== gen) return;
    n = { ...n, actor: z.from, sats: z.sats, content: z.comment };
  }
  if (run !== gen || muteReason({ pubkey: n.actor, id: ev.id, kind: ev.kind, tags: [], content: '' }, mute)) return;
  items.set(ev.id, n);
  requestProfile(n.actor);
  publish();
  if (live && n.created_at >= startedAt - 30) browserNotify(n);
}

function browserNotify(n) {
  try {
    if (!state.get('settings')?.browserNotify || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
    const p = getCached(n.actor);
    const name = p?.displayName || p?.name || '…';
    new Notification(t(`notif.${n.type}`, { name, emoji: n.emoji ?? '', n: n.sats ?? '' }), { body: n.content.slice(0, 120), tag: n.id });
  } catch { /* indisponible */ }
}

export function startNotifications() {
  stopNotifications(false);
  const s = state.get('session');
  if (!s || state.get('lists').status !== 'ready') return;
  const run = ++gen;
  me = s.pubkey; startedAt = Math.floor(Date.now() / 1000); live = false;
  const seen = readSeen(me);
  if (seen == null) { writeSeen(me, startedAt); lastSeen = startedAt; } else lastSeen = seen;
  sub = pool.subscribe([{ kinds: NOTIF_KINDS, '#p': [me], since: startedAt - WEEK, limit: 150 }], {
    onevent: (ev) => { take(ev, run); }, oneose: () => { live = true; },
  });
}

export function stopNotifications(clear = true) {
  gen++; sub?.close(); sub = null;
  if (clear) { items = new Map(); me = null; lastSeen = 0; state.set('notif', { items: [], unread: 0 }); }
}

// Appelé à l'ouverture de la page : tout ce qui est affiché est considéré comme vu.
export function markNotificationsSeen() {
  if (!me) return;
  lastSeen = Math.max(lastSeen, Math.floor(Date.now() / 1000));
  writeSeen(me, lastSeen);
  publish();
}
export const seenAt = () => lastSeen;

export function initNotifications() {
  let lastStatus = '', owner = null;
  const refresh = () => {
    const s = state.get('session');
    if (!s) { stopNotifications(); owner = null; return; }
    if (owner !== s.pubkey) { owner = s.pubkey; stopNotifications(); }
    startNotifications();
  };
  state.on('session', refresh);
  state.on('lists', (l) => { if (l.status !== lastStatus) { lastStatus = l.status; refresh(); } });
  refresh();
}
