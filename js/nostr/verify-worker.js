// Vérification id + signature Schnorr hors du fil principal.
import * as lib from './lib.js';

self.onmessage = ({ data: { id, event } }) => {
  let ok = false;
  try { ok = typeof lib.verifyEvent === 'function' && lib.verifyEvent(event) === true; } catch { ok = false; }
  self.postMessage({ id, ok });
};
