// Signature puis publication d'un événement sur les relais d'écriture connectés.
import { state } from './state.js';
import { getSigner } from './auth.js';
import { pool } from './relays/pool.js';
import { putEvent } from './storage/db.js';

const summarize = (event, results) => ({ event, results, ok: results.filter((r) => r.ok).length, total: results.length });

// → { event, results, ok, total }. Lève NO_SIGNER / SIGN_FAILED.
// L'événement n'entre dans le cache et l'interface que si au moins un relais l'a accepté.
export async function publishEvent(template) {
  const signer = getSigner();
  if (!signer) throw new Error('NO_SIGNER');
  let signed;
  try { signed = await signer.signEvent(template); } catch { throw new Error('SIGN_FAILED'); }
  return republishEvent(signed);
}

export async function republishEvent(signed) {
  const res = summarize(signed, await pool.publish(signed));
  if (res.ok) { putEvent(signed); state.set('published', signed); }
  return res;
}
