import { t } from '../i18n.js';
import { state } from '../state.js';
import { updateSettings } from '../storage/settings.js';
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
  main.replaceChildren(pageTitle('nav.settings'), form);
}
