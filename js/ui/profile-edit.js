// Édition du profil (kind 0) : on part de la dernière version publiée, les champs inconnus sont conservés.
import { t } from '../i18n.js';
import { pool } from '../relays/pool.js';
import { getReplaceable } from '../storage/db.js';
import { getSigner } from '../auth.js';
import { buildProfileTemplate } from '../nostr/profile.js';
import { publishEvent, republishEvent } from '../publish.js';
import { acceptProfileEvent } from '../profiles.js';
import { el } from './common.js';
import { showResult, errorKey } from './composer.js';

const FIELDS = [
  ['name', 'text'], ['display_name', 'text'], ['about', 'textarea'], ['picture', 'url'],
  ['banner', 'url'], ['website', 'url'], ['lud16', 'text'], ['nip05', 'text'],
];

// → { node, stop }
export function profileEditor(pubkey, { onSaved } = {}) {
  const box = el('form', { class: 'form profile-edit' });
  const out = el('div', { class: 'compose-result', role: 'status' });
  let current = null, ready = false, alive = true;
  box.replaceChildren(el('p', {}, t('state.loading')));

  const draw = () => {
    if (!alive) return;
    let prev = {};
    try { prev = current ? JSON.parse(current.content) : {}; } catch { prev = {}; }
    const inputs = {};
    const rows = FIELDS.map(([key, type]) => {
      const id = `pe-${key}`;
      const input = type === 'textarea' ? el('textarea', { id, name: key, rows: 4, maxlength: 1000 }) : el('input', { id, name: key, type: type === 'url' ? 'url' : 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 500 });
      input.value = typeof prev[key] === 'string' ? prev[key] : '';
      inputs[key] = input;
      return el('div', { class: 'field' }, el('label', { for: id }, t(`pe.${key}`)), input, el('p', { class: 'hint' }, t(`pe.${key}.hint`)));
    });
    const save = el('button', { type: 'submit', class: 'btn' }, t('pe.save'));
    box.replaceChildren(el('p', { class: 'hint' }, t(current ? 'pe.intro' : 'pe.intro.new')), ...rows, el('div', { class: 'row' }, save), out);
    let busy = false;
    box.onsubmit = async (e) => {
      e.preventDefault();
      if (busy || !getSigner()) return;
      let tpl;
      try { tpl = buildProfileTemplate(current, Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); }
      catch (err) {
        const m = /^(INVALID|TOO_LONG)_(\w+)$/.exec(err.message);
        out.replaceChildren(el('span', { class: 'status status-error' }, m ? t(m[1] === 'INVALID' ? 'pe.err.invalid' : 'pe.err.long', { field: t(`pe.${m[2]}`) }) : t('compose.err.generic')));
        return;
      }
      busy = true; save.disabled = true; out.replaceChildren(t('lists.publishing'));
      try {
        const res = await publishEvent(tpl, { alsoBoot: true });
        showResult(out, res, () => republishEvent(res.event, { alsoBoot: true }));
        if (res.ok) { current = res.event; acceptProfileEvent(res.event); onSaved?.(res.event); }
      } catch (err) { out.replaceChildren(el('span', { class: 'status status-error' }, t(errorKey(err)))); }
      finally { busy = false; save.disabled = false; }
    };
  };

  // Dernière version : cache, puis relais. Le formulaire n'apparaît qu'une fois la recherche terminée,
  // pour ne pas écraser un profil existant avec un formulaire vide.
  getReplaceable(0, pubkey).then((ev) => { if (ev && !current) current = ev; });
  const sub = pool.subscribe([{ kinds: [0], authors: [pubkey], limit: 2 }], {
    closeOnEose: true,
    onevent: (ev) => { if (ev.kind === 0 && ev.pubkey === pubkey && (!current || ev.created_at > current.created_at)) current = ev; },
    oneose: async () => {
      if (ready || !alive) return;
      ready = true;
      const open = pool.status().filter((r) => r.state === 'open').length;
      if (!current) current = await getReplaceable(0, pubkey);
      if (!current && !open) { box.replaceChildren(el('p', { class: 'status status-error' }, t('pe.unavailable'))); return; }
      draw();
    },
  });
  return { node: box, stop: () => { alive = false; sub.close(); } };
}
