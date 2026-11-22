// Signature puis publication d'un événement sur les relais d'écriture connectés.
import { state } from './state.js';
import { getSigner } from './auth.js';
import { pool } from './relays/pool.js';
import { putEvent } from './storage/db.js';
import { bootRelays } from './account.js';
import { publishToMany } from './relays/oneshot.js';

const summarize = (event, results) => ({ event, results, ok: results.filter((r) => r.ok).length, total: results.length });

// → { event, results, ok, total }. Lève NO_SIGNER / SIGN_FAILED.
// L'événement n'entre dans le cache et l'interface que si au moins un relais l'a accepté.
// alsoBoot : publie aussi sur les relais d'amorçage (profil, listes : ce que la découverte va chercher).
export async function publishEvent(template, opts) {
  const signer = getSigner();
  if (!signer) throw new Error('NO_SIGNER');
  let signed;
  try { signed = await signer.signEvent(template); } catch { throw new Error('SIGN_FAILED'); }
  return republishEvent(signed, opts);
}

export async function republishEvent(signed, { alsoBoot = false } = {}) {
  const results = await pool.publish(signed);
  if (alsoBoot) {
    let boots = [];
    try { boots = await bootRelays(); } catch { /* amorçage indisponible */ }
    const known = new Set(results.map((r) => r.url));
    results.push(...await publishToMany(boots.filter((u) => !known.has(u)), signed));
  }
  const res = summarize(signed, results);
  if (res.ok) { putEvent(signed); state.set('published', signed); }
  return res;
}
