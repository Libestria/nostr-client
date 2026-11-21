let dict = {};
export const SUPPORTED = ['fr', 'en'];

export async function setLang(lang) {
  const code = SUPPORTED.includes(lang) ? lang : 'en';
  const res = await fetch(new URL(`../data/i18n/${code}.json`, import.meta.url));
  if (!res.ok) throw new Error(`i18n ${code}: HTTP ${res.status}`);
  dict = await res.json();
  document.documentElement.lang = code;
}

export function t(key, vars = {}) {
  let s = dict[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
}
