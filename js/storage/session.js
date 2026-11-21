// Session : méthode + clé PUBLIQUE uniquement. Aucune clé privée n'est jamais stockée.
const KEY = 'nostr-client:session';
const METHODS = ['nip07', 'readonly'];

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && METHODS.includes(s.method) && /^[0-9a-f]{64}$/.test(s.pubkey)) return { method: s.method, pubkey: s.pubkey };
  } catch { /* session absente ou illisible */ }
  return null;
}

export function saveSession(session) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify({ method: session.method, pubkey: session.pubkey }));
    else localStorage.removeItem(KEY);
  } catch { /* stockage indisponible */ }
}
