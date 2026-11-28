// Fenêtre « Liquid » simple : titre, bouton de fermeture, corps libre. Ouverture/fermeture animées (voir sheetanim.js).
import { el, closeButton, returnFocus } from './common.js';
import { t } from '../i18n.js';

// → le <dialog> ; onClose() est appelé à la fermeture (arrêt des abonnements du corps)
export function openSheet({ title, body, opener = null, onClose = null, cls = '' }) {
  const close = closeButton(t('shell.menu.close'));
  const dlg = el('dialog', { class: `note-menu ${cls}`.trim(), 'aria-label': title, tabindex: '-1', autofocus: '' });
  close.addEventListener('click', () => dlg.close());
  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, title), close), body);
  dlg.addEventListener('close', () => { onClose?.(); dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
  return dlg;
}
