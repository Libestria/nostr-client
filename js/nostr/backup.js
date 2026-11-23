// Export / import JSON (réglages locaux, listes de relais, sourdine). Fonctions pures.
// Aucune clé privée n'est jamais exportée ; un fichier qui en contient une est refusé à l'import.
import { normalizeRelayUrl } from './relayurl.js';
import { normalizeValue, emptyMute, MAX_ENTRIES } from './mute.js';
import { MAX_LIST_RELAYS } from './relaylists.js';

export const BACKUP_APP = 'nostr-client';
export const MAX_BACKUP_BYTES = 300000;
const THEMES = ['auto', 'light', 'dark'], LANGS = ['fr', 'en'];
export class BackupError extends Error { constructor(code) { super(code); this.code = code; } }   // TOO_BIG | INVALID | PRIVATE_KEY | WRONG_APP

const relayRows = (list, key) => (list?.relays ?? []).map((r) => (key === 'dm' ? { url: r.url } : key === 'search' ? { url: r.url, read: r.read !== false } : { url: r.url, read: r.read !== false, write: r.write !== false }));

export function buildBackup({ settings, lists, mute }, now = Math.floor(Date.now() / 1000)) {
  return {
    app: BACKUP_APP, version: 1, exported_at: now,
    settings: { theme: settings.theme, lang: settings.lang, loadMedia: settings.loadMedia, browserNotify: !!settings.browserNotify },
    relays: { pub: relayRows(lists.pub, 'pub'), search: relayRows(lists.search, 'search'), dm: relayRows(lists.dm, 'dm') },
    muted: { pubkeys: [...mute.pubkeys], words: [...mute.words], events: [...mute.events], hashtags: [...mute.hashtags] },
  };
}

// Texte JSON → { settings, relays, muted, skipped } nettoyés. Erreurs : BackupError.
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) throw new BackupError('TOO_BIG');
  if (/nsec1[02-9ac-hj-np-z]{20,}/i.test(text)) throw new BackupError('PRIVATE_KEY');
  let j;
  try { j = JSON.parse(text); } catch { throw new BackupError('INVALID'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new BackupError('INVALID');
  if (j.app !== BACKUP_APP) throw new BackupError('WRONG_APP');
  if (j.version !== 1) throw new BackupError('INVALID');
  let skipped = 0;
  const s = j.settings && typeof j.settings === 'object' ? j.settings : {};
  const settings = {};
  if (THEMES.includes(s.theme)) settings.theme = s.theme;
  if (LANGS.includes(s.lang)) settings.lang = s.lang;
  if (typeof s.loadMedia === 'boolean') settings.loadMedia = s.loadMedia;
  if (typeof s.browserNotify === 'boolean') settings.browserNotify = s.browserNotify;
  const relays = { pub: [], search: [], dm: [] };
  for (const key of Object.keys(relays)) {
    const rows = Array.isArray(j.relays?.[key]) ? j.relays[key] : [];
    const seen = new Set();
    for (const r of rows.slice(0, 50)) {
      const url = normalizeRelayUrl(r?.url);
      if (!url || seen.has(url) || seen.size >= MAX_LIST_RELAYS) { skipped++; continue; }
      seen.add(url);
      const read = r.read !== false, write = key === 'pub' ? r.write !== false : undefined;
      if (key === 'pub' && !read && !write) { skipped++; seen.delete(url); continue; }
      relays[key].push(key === 'pub' ? { url, read, write } : key === 'search' ? { url, read } : { url });
    }
  }
  const muted = emptyMute();
  const kinds = { pubkeys: 'pubkey', words: 'word', events: 'event', hashtags: 'hashtag' };
  for (const [field, kind] of Object.entries(kinds)) {
    const arr = Array.isArray(j.muted?.[field]) ? j.muted[field] : [];
    for (const v of arr.slice(0, MAX_ENTRIES)) { try { muted[field].push(normalizeValue(kind, v)); } catch { skipped++; } }
    muted[field] = [...new Set(muted[field])];
  }
  return { settings, relays, muted, skipped };
}

// Ce qu'il faut ajouter à l'état actuel : { relayOps: [{ key, op }], muteOps: [...], settings }
export function importPlan(parsed, { lists, mute }) {
  const relayOps = [];
  for (const key of ['pub', 'search', 'dm']) {
    const have = new Set((lists[key]?.relays ?? []).map((r) => r.url));
    for (const r of parsed.relays[key]) if (!have.has(r.url)) relayOps.push({ key, op: { type: 'add', ...r } });
  }
  const muteOps = [];
  const kinds = { pubkeys: 'pubkey', words: 'word', events: 'event', hashtags: 'hashtag' };
  for (const [field, kind] of Object.entries(kinds)) for (const v of parsed.muted[field]) if (!mute[field].includes(v)) muteOps.push({ type: 'add', kind, value: v });
  return { relayOps, muteOps, settings: parsed.settings };
}
