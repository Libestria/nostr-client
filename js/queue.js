// File d'attente des publications hors ligne : des événements DÉJÀ SIGNÉS, republiés dès le retour du réseau.
import { state } from './state.js';
import { republishEvent } from './publish.js';

const KEY = 'nostr-client:queue';
const MAX = 30;
let flushing = false;

const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* indisponible */ } state.set('queue', list.length); };
state.set('queue', 0);

export const queuedCount = () => read().length;
export function enqueue(signed) {
  const list = read().filter((e) => e.id !== signed.id);
  list.push(signed);
  write(list.slice(-MAX));
}

// Republie ce qui est en attente ; ne retire de la file que les événements acceptés par au moins un relais.
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const ev of read()) {
      const res = await republishEvent(ev, { noQueue: true });
      if (res.ok) write(read().filter((e) => e.id !== ev.id));
    }
  } finally { flushing = false; }
}

export function initQueue() {
  state.set('queue', read().length);
  window.addEventListener('online', () => setTimeout(flushQueue, 2000));
  setTimeout(flushQueue, 8000);
}
