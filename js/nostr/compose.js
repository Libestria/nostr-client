// Construction des événements à publier (notes, réponses, réactions, reposts, suppressions).
// Module sans DOM ni réseau : il ne produit que des modèles d'événements non signés.
import { decode } from './nip19.js';

export const MAX_NOTE_CHARS = 10000;
const MAX_HASHTAGS = 10;
const MAX_MENTIONS = 20;
const HEX64 = /^[0-9a-f]{64}$/;
const REF = /(^|[^a-z0-9])(nostr:)?((?:npub|nprofile|nevent|note)1[02-9ac-hj-np-z]{20,})/g;   // sans « lookbehind » : compatible avec les anciens Safari
const PRIVATE_KEY = /nsec1[02-9ac-hj-np-z]{40,}/i;
const HASHTAG = /(^|[\s(])#([\p{L}\p{N}_]{1,60})/gu;

const now = () => Math.floor(Date.now() / 1000);

// Analyse du texte : contenu normalisé (nostr:…), mentions et hashtags.
export function parseNoteText(text) {
  const mentions = []; // { type: 'p' | 'q', ... }
  const content = text.replace(REF, (all, before, _prefix, ref) => {
    let d;
    try { d = decode(ref); } catch { return all; }
    if (d.type === 'npub') mentions.push({ type: 'p', pubkey: d.data });
    else if (d.type === 'nprofile') mentions.push({ type: 'p', pubkey: d.data.pubkey });
    else if (d.type === 'note') mentions.push({ type: 'q', id: d.data });
    else if (d.type === 'nevent') mentions.push({ type: 'q', id: d.data.id, author: d.data.author });
    else return all;
    return `${before}nostr:${ref}`;
  });
  const hashtags = [];
  for (const m of content.matchAll(HASHTAG)) {
    const tag = m[2].toLowerCase();
    if (!hashtags.includes(tag) && hashtags.length < MAX_HASHTAGS) hashtags.push(tag);
  }
  return { content, mentions, hashtags };
}

export function rootOf(parent) {
  const es = (parent.tags ?? []).filter((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''));
  const marked = es.find((t) => t[3] === 'root');
  if (marked) return { id: marked[1], pubkey: HEX64.test(marked[4] ?? '') ? marked[4] : undefined };
  if (es.length) return { id: es[0][1] };   // ancien format : la première référence est la racine
  return null;
}

// text : saisie de l'utilisateur ; reply : événement auquel on répond (facultatif).
// Erreurs : EMPTY, TOO_LONG, PRIVATE_KEY
export const CLIENT_NAME = 'Libestria Web';
// client : nom à publier dans la balise « client » (NIP-89), ou null pour ne rien indiquer
export function buildNote(text, { reply, client = null, created_at = now() } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('EMPTY');
  if (raw.length > MAX_NOTE_CHARS) throw new Error('TOO_LONG');
  if (PRIVATE_KEY.test(raw)) throw new Error('PRIVATE_KEY');
  const { content, mentions, hashtags } = parseNoteText(raw);
  const tags = [];
  const people = [];
  const addPerson = (pk) => { if (HEX64.test(pk ?? '') && !people.includes(pk) && people.length < MAX_MENTIONS) people.push(pk); };

  if (reply) {
    const root = rootOf(reply);
    if (root && root.id !== reply.id) {
      tags.push(['e', root.id, '', 'root', ...(root.pubkey ? [root.pubkey] : [])]);
      tags.push(['e', reply.id, '', 'reply', reply.pubkey]);
    } else tags.push(['e', reply.id, '', 'root', reply.pubkey]);
    addPerson(reply.pubkey);
    for (const t of reply.tags ?? []) if (t[0] === 'p') addPerson(t[1]);
  }
  for (const m of mentions) if (m.type === 'p') addPerson(m.pubkey);
  for (const pk of people) tags.push(['p', pk]);
  const quoted = new Set();
  for (const m of mentions) {
    if (m.type !== 'q' || quoted.has(m.id)) continue;
    quoted.add(m.id);
    tags.push(['q', m.id, '', ...(m.author ? [m.author] : [])]);
  }
  for (const h of hashtags) tags.push(['t', h]);
  if (client) tags.push(['client', String(client).slice(0, 40)]);
  return { kind: 1, created_at, tags, content };
}

export function buildReaction(target, symbol = '+', created_at = now()) {
  return { kind: 7, created_at, content: symbol, tags: [['e', target.id], ['p', target.pubkey], ['k', String(target.kind)]] };
}

// NIP-18 : kind 6 pour une note (kind 1), kind 16 pour les autres types ; le contenu est la note citée.
export function buildRepost(target, created_at = now()) {
  const kind = target.kind === 1 ? 6 : 16;
  return { kind, created_at, content: JSON.stringify(target),
    tags: [['e', target.id, ''], ['p', target.pubkey], ...(kind === 16 ? [['k', String(target.kind)]] : [])] };
}

// NIP-09 : on ne demande que la suppression de ses propres événements. Erreur : NOT_OWN
// Signalement (NIP-56, kind 1984). Types : spam, impersonation, illegal, nudity, malware, other. Public : il est publié sur les relais.
export const REPORT_TYPES = ['spam', 'impersonation', 'illegal', 'nudity', 'malware', 'other'];
export function buildReport(target, type, created_at = now()) {
  if (!REPORT_TYPES.includes(type)) throw new Error('invalid-type');
  return { kind: 1984, created_at, tags: [['e', target.id, type], ['p', target.pubkey]], content: '' };
}

export function buildDeletion(target, pubkey, created_at = now()) {
  if (!pubkey || target.pubkey !== pubkey) throw new Error('NOT_OWN');
  return { kind: 5, created_at, content: '', tags: [['e', target.id], ['k', String(target.kind)]] };
}
