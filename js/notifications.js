// Centre de notifications : mentions, réponses, réactions, reposts, zaps (vérifiés). Un seul abonnement continu.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getCached, requestProfile } from './profiles.js';
import { classify, NOTIF_KINDS, GROUPS, groupOf } from './nostr/notif.js';
import { checkReceipt } from './nostr/nip57.js';
import { lnurlInfo } from './zap.js';
import { muteReason } from './nostr/mute.js';
import { t } from './i18n.js';

const MAX_ITEMS = 200;
const WEEK = 7 * 86400;
const seenKey = (pk, g) => `nostr-client:notif-seen:${pk}${g ? `:${g}` : ''}`;
const readSeen = (pk, g) => { try { const v = Number(localStorage.getItem(seenKey(pk, g))); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
const writeSeen = (pk, g, v) => { try { localStorage.setItem(seenKey(pk, g), String(v)); } catch { /* indisponible */ } };

let me = null, sub = null, items = new Map(), seen = {}, live = false, startedAt = 0, gen = 0;
const zeroBy = () => Object.fromEntries(GROUPS.map((g) => [g, 0]));
state.set('notif', { items: [], unread: 0, by: zeroBy() });

const publish = () => {
  const list = [...items.values()].sort((a, b) => b.created_at - a.created_at).slice(0, MAX_ITEMS);
  const by = zeroBy();
  for (const n of list) if (n.created_at > (seen[groupOf(n.type)] ?? 0)) by[groupOf(n.type)]++;
  state.set('notif', { items: list, unread: GROUPS.reduce((a, g) => a + by[g], 0), by });
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
  if (c.type === 'follow') {   // un seul « nouvel abonné » par compte (la liste de suivis est republiée à chaque modification)
    const key = `follow-${c.actor}`;
    if (items.has(key) && items.get(key).created_at >= ev.created_at) return;
    if (run !== gen || muteReason({ pubkey: c.actor, id: ev.id, kind: 3, tags: [], content: '' }, state.get('mute'))) return;
    items.set(key, { id: key, ...c, created_at: ev.created_at, content: '' });
    requestProfile(c.actor); publish();
    return;
  }
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
  // « vu » par onglet ; au premier lancement tout ce qui existe déjà est considéré comme vu
  const legacy = readSeen(me);
  seen = {};
  for (const g of GROUPS) {
    const v = readSeen(me, g) ?? legacy ?? startedAt;
    seen[g] = v;
    if (readSeen(me, g) == null) writeSeen(me, g, v);
  }
  sub = pool.subscribe([{ kinds: NOTIF_KINDS, '#p': [me], since: startedAt - WEEK, limit: 150 }], {
    onevent: (ev) => { take(ev, run); }, oneose: () => { live = true; },
  });
}

export function stopNotifications(clear = true) {
  gen++; sub?.close(); sub = null;
  if (clear) { items = new Map(); me = null; seen = {}; state.set('notif', { items: [], unread: 0, by: zeroBy() }); }
}

// Appelé quand un onglet est affiché : ses notifications sont considérées comme vues.
export function markNotificationsSeen(group) {
  if (!me || !GROUPS.includes(group)) return;
  seen[group] = Math.max(seen[group] ?? 0, Math.floor(Date.now() / 1000));
  writeSeen(me, group, seen[group]);
  publish();
}
export const seenAt = (group) => seen[group] ?? 0;

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
