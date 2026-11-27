// Charge un événement remplaçable d'un compte : cache d'abord, puis relais. onChange(ev) à chaque version plus récente ;
// onDone(ev, relaisOuverts) quand les relais ont répondu. Retourne l'abonnement (à fermer avec .close()).
import { pool } from './relays/pool.js';
import { getReplaceable } from './storage/db.js';

export function loadReplaceable(kind, pubkey, onChange, onDone) {
  let cur = null;
  const take = (ev) => {
    if (ev?.kind !== kind || ev.pubkey !== pubkey || (cur && ev.created_at <= cur.created_at)) return;
    cur = ev;
    onChange(ev);
  };
  getReplaceable(kind, pubkey).then(take);
  return pool.subscribe([{ kinds: [kind], authors: [pubkey], limit: 1 }], {
    closeOnEose: true, onevent: take,
    oneose: () => onDone?.(cur, pool.status().filter((r) => r.state === 'open').length),
  });
}
