// Notifications : classement des événements qui visent l'utilisateur (fonctions pures).
const HEX64 = /^[0-9a-f]{64}$/;
const lastE = (tags) => [...tags].reverse().find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1] ?? null;
const rootOrReply = (tags) => {
  const e = tags.filter((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''));
  return (e.find((t) => t[3] === 'reply') ?? e.at(-1))?.[1] ?? null;
};

export const NOTIF_KINDS = [1, 6, 7, 16, 9735];

// → { type: 'mention'|'reply'|'repost'|'reaction'|'zap', actor, target, emoji? } ou null
// (les zaps doivent encore être vérifiés auprès du fournisseur Lightning).
export function classify(ev, me) {
  if (!ev || ev.pubkey === me || !Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === 'p' && t[1] === me)) return null;
  switch (ev.kind) {
    case 1: { const target = rootOrReply(ev.tags); return { type: target ? 'reply' : 'mention', actor: ev.pubkey, target }; }
    case 6: case 16: return { type: 'repost', actor: ev.pubkey, target: lastE(ev.tags) };
    case 7: {
      if (ev.content === '-') return null;
      const emoji = ev.content === '+' || ev.content === '' ? '❤️' : String(ev.content).slice(0, 24);
      return { type: 'reaction', actor: ev.pubkey, target: lastE(ev.tags), emoji };
    }
    case 9735: return { type: 'zap', actor: ev.pubkey, target: lastE(ev.tags) };
    default: return null;
  }
}
