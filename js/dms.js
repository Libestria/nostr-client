// Messagerie privée NIP-17 : réception (relais de messagerie du compte), déchiffrement via le signeur, stockage local, envoi.
// Les messages déchiffrés ne sont conservés que sur cet appareil (IndexedDB) et effacés à la déconnexion.
import { state } from './state.js';
import { pool } from './relays/pool.js';
import { getSigner, signerCapabilities } from './auth.js';
import { cryptoFromLib, buildRumor, wrapFor, unwrap, toRecord, legacyGroup, DmError } from './nostr/dm.js';
import { putDm, markDmSeen, isDmSeen, listDms, clearDms, getReplaceable, putEvent } from './storage/db.js';
import { publishToMany } from './relays/oneshot.js';
import { discoverAccount } from './relays/discovery.js';
import { bootRelays } from './account.js';
import { relaysFromEvent } from './nostr/relaylists.js';

const DAY = 86400;
const FIRST_SYNC_DAYS = 30;   // première synchronisation
const OVERLAP = 3 * DAY;      // les enveloppes ont des dates aléatoires jusqu'à 2 jours dans le passé
const HEX64 = /^[0-9a-f]{64}$/;

// status : off | nosigner | norelays | syncing | ready | denied
const set = (patch) => state.set('dm', { ...(state.get('dm') ?? { status: 'off', version: 0 }), ...patch, version: (state.get('dm')?.version ?? 0) + 1 });
state.set('dm', { status: 'off', version: 0 });

const stats = { received: 0, opened: 0, skipped: 0, pending: 0, eose: false, error: '' };
const resetStats = () => Object.assign(stats, { received: 0, opened: 0, skipped: 0, pending: 0, eose: false, error: '' });
export const dmStats = () => ({ ...stats });
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new DmError('signer')), ms))]);
let me = null, sub = null, messages = new Map(), queue = [], working = false, runId = 0, crypto = null;
const syncKey = (pk) => `nostr-client:dm-sync:${pk}`;
const readKey = (pk) => `nostr-client:dm-read:${pk}`;
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* indisponible */ } };

export const allMessages = () => [...messages.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));

// Conversations : [{ conv, participants, partners, last, count, unread }], la plus récente d'abord
export function conversations() {
  const read = lsGet(readKey(me)) ?? {};
  const by = new Map();
  for (const m of messages.values()) {
    const c = by.get(m.conv) ?? { conv: m.conv, participants: m.participants, last: m, count: 0, unread: 0 };
    c.count++;
    if (m.created_at > c.last.created_at) c.last = m;
    if (!m.mine && m.created_at > (read[m.conv] ?? 0)) c.unread++;
    by.set(m.conv, c);
  }
  return [...by.values()].sort((a, b) => b.last.created_at - a.last.created_at);
}
export const conversationMessages = (conv) => allMessages().filter((m) => m.conv === conv);
export function markRead(conv) {
  const last = conversationMessages(conv).at(-1);
  if (!me || !last) return;
  const read = lsGet(readKey(me)) ?? {};
  if ((read[conv] ?? 0) >= last.created_at) return;
  read[conv] = last.created_at;
  lsSet(readKey(me), read);
  set({});
}
export const unreadTotal = () => (me ? conversations().reduce((n, c) => n + c.unread, 0) : 0);

async function getCrypto() { return (crypto ||= cryptoFromLib(await import('./nostr/lib.js'))); }

async function handle(wrap, run) {
  if (await isDmSeen(wrap.id)) return;
  const signer = getSigner();
  try {
    stats.pending++; set({});
    const opened = await withTimeout(unwrap(wrap, me, signer, await getCrypto()), 45000);
    stats.pending--;
    if (run !== runId) return;
    const rec = toRecord(opened, me, wrap.id);
    await putDm(rec);
    messages.set(rec.id, rec);
    await markDmSeen(wrap.id);
    stats.opened++;
    set({});
  } catch (e) {
    stats.pending = Math.max(0, stats.pending - 1);
    stats.error = e?.code ?? 'error';
    if (e instanceof DmError && e.code === 'signer') throw e;          // refus du signeur : on s'arrête, on réessaiera plus tard
    stats.skipped++;
    await markDmSeen(wrap.id);                                          // enveloppe invalide ou étrangère : ne pas réessayer
    set({});
  }
}

async function drain(run) {
  if (working) return;
  working = true;
  try {
    while (queue.length && run === runId) await handle(queue.shift(), run);
  } catch {
    queue = [];
    if (run === runId) { sub?.close(); sub = null; set({ status: 'denied' }); }
  } finally { working = false; }
}

export async function startDms() {
  stopDms(false);
  const session = state.get('session');
  const lists = state.get('lists');
  if (!session || session.method === 'readonly' || state.get('settings')?.readOnly || lists.status !== 'ready') return;
  if (signerCapabilities(session).nip44 === 'no') { set({ status: 'nosigner' }); return; }
  if (!(lists.dm?.relays?.length)) { set({ status: 'norelays' }); return; }
  const run = ++runId;
  resetStats();
  me = session.pubkey;
  for (const r of await listDms(me)) messages.set(r.id, r);
  if (run !== runId) return;
  const startedAt = Math.floor(Date.now() / 1000);
  const last = lsGet(syncKey(me));
  const since = Number.isInteger(last) ? last - OVERLAP : startedAt - FIRST_SYNC_DAYS * DAY;
  set({ status: 'syncing' });
  sub = pool.subscribe([{ kinds: [1059], '#p': [me], since, limit: 500 }], {
    scope: 'dm',
    onevent: (ev) => { if (ev.kind === 1059) { stats.received++; queue.push(ev); drain(run); set({}); } },
    oneose: async () => {
      stats.eose = true; set({});
      // attendre la fin du déchiffrement avant de mémoriser la date de synchronisation
      while ((queue.length || working) && run === runId) await new Promise((r) => setTimeout(r, 100));
      if (run !== runId || state.get('dm').status === 'denied') return;
      lsSet(syncKey(me), startedAt);
      set({ status: 'ready' });
    },
  });
}

export function stopDms(clearMemory = true) {
  runId++;
  sub?.close(); sub = null; queue = [];
  if (clearMemory) { messages = new Map(); me = null; }
  set({ status: 'off' });
}

// Branchement : démarrage / arrêt selon le compte, les listes de relais et le mode lecture seule.
export function initDms() {
  let owner = null;
  const refresh = () => {
    const s = state.get('session');
    if (owner && owner !== s?.pubkey) { clearDms(); try { localStorage.removeItem(syncKey(owner)); localStorage.removeItem(readKey(owner)); } catch { /* indisponible */ } }
    owner = s?.pubkey ?? null;
    if (!s) { stopDms(); return; }
    startDms();
  };
  state.on('session', refresh);
  let lastKey = '';
  state.on('lists', (l) => {
    const key = `${l.status}|${JSON.stringify(l.dm?.relays ?? [])}`;
    if (key === lastKey) return;
    lastKey = key;
    if (state.get('session')) startDms();
  });
  state.on('settings', (s) => { if (state.get('session') && s.readOnly !== initDms.ro) { initDms.ro = s.readOnly; startDms(); } });
  initDms.ro = state.get('settings')?.readOnly;
  owner = state.get('session')?.pubkey ?? null;
  if (owner) startDms();
}

// Relais de messagerie d'un correspondant (kind 10050) : cache, sinon découverte sur les relais d'amorçage.
export async function dmRelaysOf(pubkey) {
  let ev = await getReplaceable(10050, pubkey);
  if (!ev) {
    try {
      const found = await discoverAccount(pubkey, { boot: await bootRelays() });
      ev = found.events[10050];
      if (ev) putEvent(ev);
    } catch { /* indisponible */ }
  }
  return ev ? relaysFromEvent(ev, 'dm').map((r) => r.url) : [];
}

// Envoie un message à UN correspondant. → { record, partner: [résultats], self: [résultats], ok }
// Erreurs : READ_ONLY, NO_SIGNER, NO_NIP44 (DmError 'signer'), NO_DM_RELAYS, INVALID.
export async function sendDm(partner, text) {
  const signer = getSigner();
  if (!signer || !me) throw new Error('READ_ONLY');
  if (!signer.nip44) throw new Error('NO_NIP44');
  if (!HEX64.test(partner ?? '')) throw new Error('INVALID');
  const rcptRelays = await dmRelaysOf(partner);
  if (!rcptRelays.length) throw new Error('NO_DM_RELAYS');
  const c = await getCrypto();
  const rumor = buildRumor({ content: text, pubkey: me, recipients: [partner] }, c);
  const toPartner = await wrapFor(rumor, partner, signer, c);
  const sign = (tpl) => signer.signEvent(tpl);
  const jobs = [publishToMany(rcptRelays, toPartner, { sign })];
  if (partner !== me) {
    const toSelf = await wrapFor(rumor, me, signer, c);
    const own = (state.get('lists').dm?.relays ?? []).map((r) => r.url);
    jobs.push(pool.publishDm(toSelf).then((r) => (r.length ? r : publishToMany(own, toSelf, { sign }))));
  }
  const [partnerRes, selfRes = []] = await Promise.all(jobs);
  const ok = partnerRes.filter((r) => r.ok).length;
  let record = null;
  if (ok) {
    const participants = [...new Set([me, partner])].sort();
    record = toRecord({ rumor, participants, conv: participants.join(',') }, me, toPartner.id);
    await putDm(record);
    messages.set(record.id, record);
    set({});
  }
  return { record, partner: partnerRes, self: selfRes, ok };
}

// ---- Anciens messages NIP-04 (lecture seule, déconseillés : métadonnées visibles des relais)
let legacy = null;   // Map(partner → [{ id, mine, created_at, content }]) chiffrés

// Recherche les kind 4 envoyés et reçus sur les relais de lecture du compte. Ne déchiffre rien.
export function loadLegacy(timeout = 8000) {
  const session = state.get('session');
  if (!session) return Promise.resolve(new Map());
  const pk = session.pubkey;
  return new Promise((resolve) => {
    const events = [];
    let done = false, pending = 2;
    const finish = () => { if (done) return; done = true; legacy = legacyGroup(events, pk); resolve(legacy); };
    const part = () => { if (--pending <= 0) finish(); };
    const take = (ev) => { if (ev.kind === 4) events.push(ev); };
    pool.subscribe([{ kinds: [4], '#p': [pk], limit: 300 }], { closeOnEose: true, onevent: take, oneose: part, maxEvents: 300 });
    pool.subscribe([{ kinds: [4], authors: [pk], limit: 300 }], { closeOnEose: true, onevent: take, oneose: part, maxEvents: 300 });
    setTimeout(finish, timeout);
  });
}
export const legacyPartners = () => legacy ?? new Map();

// Déchiffre à la demande la conversation avec un interlocuteur. → { messages, failed } ; lève NO_NIP04 / READ_ONLY / SIGNER
export async function decryptLegacy(partner) {
  const signer = getSigner();
  if (!signer) throw new Error('READ_ONLY');
  if (!signer.nip04) throw new Error('NO_NIP04');
  const messages = [];
  let failed = 0;
  for (const m of (legacy?.get(partner) ?? []).slice(-100)) {
    try {
      const content = await withTimeout(signer.nip04.decrypt(partner, m.content), 45000);
      if (typeof content === 'string') messages.push({ ...m, content: content.slice(0, 20000) });
      else failed++;
    } catch (e) {
      if (e instanceof DmError && messages.length === 0 && failed === 0) throw e;   // refus dès le premier : on s'arrête
      failed++;
    }
  }
  return { messages, failed };
}
