// État global (clé → valeur) et petit bus d'événements.
export function createStore(initial = {}) {
  const data = { ...initial };
  const subs = new Map();
  return {
    get: (key) => data[key],
    set(key, value) {
      if (data[key] === value) return;
      data[key] = value;
      (subs.get(key) || []).forEach((fn) => fn(value));
    },
    on(key, fn) {
      if (!subs.has(key)) subs.set(key, new Set());
      subs.get(key).add(fn);
      return () => subs.get(key).delete(fn);
    },
  };
}

const target = new EventTarget();
export const bus = {
  on: (name, fn) => target.addEventListener(name, (e) => fn(e.detail)),
  emit: (name, detail) => target.dispatchEvent(new CustomEvent(name, { detail })),
};

export const state = createStore({ settings: null, session: null, online: navigator.onLine });
