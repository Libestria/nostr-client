// Compteurs d'interactions d'une note (réponses, reposts, réactions, citations). Module sans DOM, sans réseau.
import { parentId } from './thread.js';

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_LIST = 500;
export const emptyStats = () => ({ replies: 0, reposts: 0, reactions: 0, quotes: 0, reacted: false, reposted: false, seen: new Set(), reactors: [], reposters: [], quoted: [] });

const refs = (ev, name) => (ev.tags ?? []).filter((t) => t[0] === name && HEX64.test(t[1] ?? '')).map((t) => t[1]);

// Identifiants de notes concernées par un événement (balises e et q).
export const targetsOf = (ev) => [...new Set([...refs(ev, 'e'), ...refs(ev, 'q')])];

// Ajoute un événement aux compteurs de la note targetId. Retourne true si les compteurs ont changé.
// Un même événement n'est jamais compté deux fois ; « -  » (réaction négative) n'est pas un j'aime.
export function addInteraction(stats, ev, targetId, me = null) {
  if (!ev || stats.seen.has(ev.id) || ev.pubkey === undefined) return false;
  const mine = !!me && ev.pubkey === me;
  let changed = true;
  if (ev.kind === 7) {
    if (!refs(ev, 'e').includes(targetId) || ev.content === '-') return false;
    stats.reactions++; if (mine) stats.reacted = true;
    if (stats.reactors.length < MAX_LIST) stats.reactors.push({ from: ev.pubkey, emoji: String(ev.content ?? '').slice(0, 20) || '+', at: ev.created_at });
  } else if (ev.kind === 6 || ev.kind === 16) {
    if (!refs(ev, 'e').includes(targetId)) return false;
    stats.reposts++; if (mine) stats.reposted = true;
    if (stats.reposters.length < MAX_LIST) stats.reposters.push({ from: ev.pubkey, at: ev.created_at });
  } else if (ev.kind === 1) {
    if (ev.id === targetId) return false;
    if (parentId(ev) === targetId) stats.replies++;
    else if (refs(ev, 'q').includes(targetId)) { stats.quotes++; if (stats.quoted.length < MAX_LIST) stats.quoted.push(ev); }
    else changed = false;
  } else return false;
  if (changed) stats.seen.add(ev.id);
  return changed;
}

const byDate = (a, b) => (b.at ?? b.created_at) - (a.at ?? a.created_at);
export const snapshot = (s) => ({ replies: s.replies, reposts: s.reposts, reactions: s.reactions, quotes: s.quotes, reacted: s.reacted, reposted: s.reposted,
  reactors: [...s.reactors].sort(byDate), reposters: [...s.reposters].sort(byDate), quoted: [...s.quoted].sort(byDate) });

// Nombre compact : 1 234 → « 1,2 k ».
export function compact(n, lang = 'fr') {
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
