// Recherche : interprétation de la saisie (fonctions pures).
import { decode } from './nip19.js';
import { parseIdentifier } from './nip05.js';

const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_QUERY = 200;

// → { type: 'profile', pubkey } | { type: 'note', id } | { type: 'nip05', identifier } | { type: 'text', text } | { type: 'empty' }
export function parseQuery(input) {
  const q = String(input ?? '').trim().replace(/^nostr:/i, '').slice(0, MAX_QUERY);
  if (!q) return { type: 'empty' };
  if (HEX64.test(q.toLowerCase())) return { type: 'profile', pubkey: q.toLowerCase(), alsoNote: true };
  if (/^(npub|nprofile|note|nevent)1[023456789acdefghjklmnpqrstuvwxyz]+$/i.test(q)) {
    try {
      const d = decode(q);
      if (d.type === 'npub') return { type: 'profile', pubkey: d.data };
      if (d.type === 'nprofile') return { type: 'profile', pubkey: d.data.pubkey };
      if (d.type === 'note') return { type: 'note', id: d.data };
      if (d.type === 'nevent') return { type: 'note', id: d.data.id };
    } catch { /* saisie invalide : recherche texte */ }
  }
  if (q.includes('@') && parseIdentifier(q)) return { type: 'nip05', identifier: q };
  return { type: 'text', text: q };
}
