// Fenêtre de composition d'une note (bouton « + » et « Citer la note »).
import { t } from '../i18n.js';
import { state } from '../state.js';
import { el, returnFocus } from './common.js';
import { composer } from './composer.js';
import { avatarNode } from './note.js';

// quote : { id, text } pour citer une note ; opener : élément à refocaliser à la fermeture
export function openCompose({ quote = null, opener = null } = {}) {
  const dlg = el('dialog', { class: 'compose-dialog', 'aria-label': t(quote ? 'note.quote' : 'shell.newPost') });
  const cancel = el('button', { type: 'button', class: 'btn btn-small' }, t('shell.cancel'));
  cancel.addEventListener('click', () => dlg.close());
  const form = composer({ quote });
  const publish = el('button', { type: 'submit', class: 'btn btn-small btn-primary', form: form.id }, t('compose.send'));
  const me = state.get('session')?.pubkey;
  dlg.append(el('div', { class: 'sd-head' }, cancel, publish), el('div', { class: 'compose-row' }, me ? avatarNode(me) : null, form));
  dlg.addEventListener('close', () => { dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
  dlg.querySelector('textarea')?.focus();
}
