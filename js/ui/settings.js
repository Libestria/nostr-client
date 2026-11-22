import { t } from '../i18n.js';
import { state } from '../state.js';
import { updateSettings } from '../storage/settings.js';
import { pool } from '../relays/pool.js';
import { normalizeRelayUrl } from '../nostr/relayurl.js';
import { el, pageTitle } from './common.js';

function select(id, labelKey, options, value, onChange) {
  const sel = el('select', { id, name: id },
    ...options.map(([v, labelK]) => el('option', { value: v, selected: v === value }, t(labelK))));
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'field' }, el('label', { for: id }, t(labelKey)), sel);
}

function checkbox(id, labelKey, hintKey, checked, onChange) {
  const box = el('input', { type: 'checkbox', id, name: id, checked, 'aria-describedby': `${id}-hint` });
  box.addEventListener('change', () => onChange(box.checked));
  return el('div', { class: 'field check' }, box, el('label', { for: id }, t(labelKey)),
    el('p', { class: 'hint', id: `${id}-hint` }, t(hintKey)));
}

const saveRelays = (relays) => state.set('settings', updateSettings({ relays }));

function relaysSection() {
  const list = el('ul', { class: 'relays' });
  const msg = el('p', { class: 'status', role: 'status' });
  const input = el('input', { type: 'text', id: 'relay-url', name: 'relay-url', placeholder: 'wss://', inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
  const add = el('button', { type: 'submit', class: 'btn' }, t('settings.relays.add'));
  const form = el('form', { class: 'form' }, el('div', { class: 'field' },
    el('label', { for: 'relay-url' }, t('settings.relays.label')), el('div', { class: 'row' }, input, add)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = normalizeRelayUrl(input.value);
    const current = state.get('settings').relays;
    msg.classList.toggle('status-error', !url || current.some((r) => r.url === url));
    if (!url) { msg.textContent = t('settings.relays.invalid'); return; }
    if (current.some((r) => r.url === url)) { msg.textContent = t('settings.relays.exists'); return; }
    msg.textContent = '';
    input.value = '';
    saveRelays([...current, { url, read: true, write: true }]);
  });

  const row = (r) => {
    const rm = el('button', { type: 'button', class: 'btn', 'aria-label': t('settings.relays.remove', { url: r.url }) }, '×');
    rm.addEventListener('click', () => saveRelays(state.get('settings').relays.filter((x) => x.url !== r.url)));
    const meta = [t(`relay.${r.state}`)];
    if (r.state === 'open' && r.latency != null) meta.push(`${r.latency} ms`);
    meta.push(t('relay.stats', { events: r.events, invalid: r.invalid }));
    return el('li', { class: 'relay' },
      el('span', { class: `dot dot-${r.state}`, 'aria-hidden': 'true' }),
      el('div', { class: 'relay-body' },
        el('span', { class: 'ident' }, r.url.replace(/^wss:\/\//, '')),
        el('span', { class: 'relay-meta' }, meta.join(' · ')),
        r.notice ? el('span', { class: 'relay-meta' }, r.notice) : null),
      rm);
  };
  const draw = () => {
    const items = pool.status();
    list.replaceChildren(...(items.length ? items.map(row) : [el('li', {}, t('settings.relays.none'))]));
  };
  const stop = pool.onChange(draw);
  draw();
  return { node: el('section', {}, el('h2', { class: 'section-title' }, t('settings.relays')), list, form, msg), stop };
}

export function renderSettings(main) {
  const s = state.get('settings');
  const status = el('p', { class: 'status', role: 'status' });
  const save = (patch) => {
    state.set('settings', updateSettings(patch));
    status.textContent = t('settings.saved');
  };
  const form = el('form', { class: 'form' },
    select('theme', 'settings.theme', [['auto', 'theme.auto'], ['light', 'theme.light'], ['dark', 'theme.dark']], s.theme, (v) => save({ theme: v })),
    select('lang', 'settings.lang', [['fr', 'lang.fr'], ['en', 'lang.en']], s.lang, (v) => save({ lang: v })),
    checkbox('loadMedia', 'settings.media', 'settings.media.hint', s.loadMedia, (v) => save({ loadMedia: v })),
    checkbox('readOnly', 'settings.readOnly', 'settings.readOnly.hint', s.readOnly, (v) => save({ readOnly: v })),
    status);
  form.addEventListener('submit', (e) => e.preventDefault());
  const relays = relaysSection();
  main.replaceChildren(pageTitle('nav.settings'), form, relays.node);
  return relays.stop;
}
