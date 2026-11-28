// Réglages sans compte : menu « verre » ouvert par l'engrenage de la barre du haut (thème et langue).
// Une rubrique ouvre un sous-menu avec les choix (coche sur le choix actuel) ; un choix s'applique, ferme le menu et confirme en vert.
import { t, setLang } from '../i18n.js';
import { state } from '../state.js';
import { updateSettings } from '../storage/settings.js';
import { el, closeButton, returnFocus } from './common.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { pushPage } from './sheetnav.js';

const THEMES = [['auto', 'theme.auto'], ['light', 'theme.light'], ['dark', 'theme.dark']];
const LANGS = [['fr', 'lang.fr'], ['en', 'lang.en']];

export function openSettingsMenu(opener) {
  const dlg = el('dialog', { class: 'note-menu settings-menu', 'aria-label': t('nav.settings'), tabindex: '-1', autofocus: '' });
  const close = closeButton(t('shell.menu.close'));
  close.addEventListener('click', () => dlg.close());

  const apply = async (labelKey, choices, key, value) => {
    // Une nouvelle langue redessine la page (message « Chargement… ») : le bandeau de confirmation s'affiche après ce rendu
    let rendered = Promise.resolve();
    if (key === 'lang') {
      await setLang(value);
      rendered = new Promise((resolve) => {
        const done = () => { document.removeEventListener('app:rendered', done); resolve(); };
        document.addEventListener('app:rendered', done);
        setTimeout(done, 2000);
      });
    }
    state.set('settings', updateSettings({ [key]: value }));
    dlg.close();
    await rendered;
    toast(t('settings.chosen', { label: t(labelKey), value: t(choices.find((c) => c[0] === value)[1]) }), { kind: 'ok' });
  };

  const rubrics = [
    { ic: 'eye', labelKey: 'settings.theme', choices: THEMES, key: 'theme' },
    { ic: 'globe', labelKey: 'settings.lang', choices: LANGS, key: 'lang' },
  ];
  const list = el('ul', { class: 'drawer-list nm-list' });
  for (const r of rubrics) {
    const current = state.get('settings')?.[r.key];
    const label = t(r.choices.find((c) => c[0] === current)?.[1] ?? r.choices[0][1]);
    const b = el('button', { type: 'button', 'aria-haspopup': 'true' }, icon(r.ic, 20), el('span', {}, t(r.labelKey)),
      el('span', { class: 'nm-chev' }, el('span', { class: 'nm-val' }, label), icon('chevron', 18)));
    b.addEventListener('click', () => {
      const sub = el('ul', { class: 'drawer-list nm-list' });
      for (const [value, textKey] of r.choices) {
        const on = value === state.get('settings')?.[r.key];
        const o = el('button', { type: 'button', ...(on ? { 'aria-current': 'true' } : {}) }, el('span', {}, t(textKey)), on ? el('span', { class: 'nm-check', 'aria-hidden': 'true' }, icon('check', 18)) : null);
        o.addEventListener('click', () => { apply(r.labelKey, r.choices, r.key, value); });
        sub.append(el('li', {}, o));
      }
      pushPage(dlg, { title: t(r.labelKey), body: sub, opener: b });
    });
    list.append(el('li', {}, b));
  }
  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, t('nav.settings')), close), list);
  dlg.addEventListener('close', () => { dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}
