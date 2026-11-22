// verifyEvent(event) → Promise<boolean> : Web Worker, avec repli sur le fil principal.
let worker = null;
let mode = 'init';
let seq = 0;
let lib = null;
const pending = new Map();

async function mainVerify(event) {
  try {
    lib ||= await import('./lib.js');
    return typeof lib.verifyEvent === 'function' && lib.verifyEvent(event) === true;
  } catch { return false; }
}

function start() {
  try {
    worker = new Worker(new URL('./verify-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (p) { pending.delete(data.id); p.resolve(data.ok === true); }
    };
    worker.onerror = () => {
      mode = 'main';
      worker?.terminate();
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); mainVerify(p.event).then(p.resolve); }
    };
    mode = 'worker';
  } catch { mode = 'main'; }
}

export function verifyEvent(event) {
  if (mode === 'init') start();
  if (mode === 'main') return mainVerify(event);
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve, event });
    worker.postMessage({ id, event });
  });
}
