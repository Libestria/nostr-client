import { t } from '../i18n.js';
import { state } from '../state.js';
import { loadAccountLists } from '../account.js';
import { el, pageTitle, stateBlock } from './common.js';
import { renderSetup } from './setup.js';

// Page affichée à la place d'une page de contenu tant que les relais du compte ne sont pas connus.
export function renderGate(main, routeName) {
  const title = pageTitle('nav.login');   // tant que le compte se connecte (chargement des listes), le titre reste « Connexion »
  const st = state.get('lists').status;
  if (st === 'empty') { renderSetup(main); return undefined; }
  if (st === 'error') {
    const retry = el('button', { type: 'button', class: 'btn' }, t('lists.retry'));
    retry.addEventListener('click', () => { retry.disabled = true; loadAccountLists(state.get("session").pubkey); });
    main.replaceChildren(title, stateBlock(st === 'empty' ? 'empty' : 'error', st === 'empty' ? 'lists.empty' : 'lists.error'), el('p', {}, retry));
    return undefined;
  }
  // Message d'avancement affiché dans la fenêtre du bas (toast) ; la page ne garde que l'indicateur d'attente
  const progress = el('p', { class: 'status', role: 'status' });
  const paint = (p) => { progress.textContent = p.total ? `${t('lists.loading')} ${t('lists.progress', { done: p.done, total: p.total })}` : t('lists.loading'); };
  paint(state.get('listsProgress'));
  main.replaceChildren(title, el('div', { class: 'state state-loading', 'aria-hidden': 'true' }, el('span', { class: 'spinner' })), progress);
  return state.on('listsProgress', paint);
}
