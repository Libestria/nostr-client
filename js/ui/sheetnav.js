// Sous-menus des fenêtres « verre » : une rubrique ouvre une page ; le menu se ferme (animation), puis le sous-menu apparaît, avec retour « < » et fermeture « ✕ ».
// Les pages sont empilées dans la même fenêtre native (<dialog>) ; Échap revient d'abord à la page précédente.
import { t } from '../i18n.js';
import { el, closeButton, keyboardActive } from './common.js';
import { icon } from './icons.js';
import { reduced, playIn, playOut } from './sheetanim.js';

// Enveloppe le contenu actuel de la fenêtre dans une pile de pages (une seule fois)
function stackOf(dlg) {
  let stack = dlg.querySelector(':scope > .sheet-pages');
  if (stack) return stack;
  stack = el('div', { class: 'sheet-pages' });
  const root = el('div', { class: 'sheet-page sheet-root' });
  root.append(...dlg.childNodes);
  stack.append(root);
  dlg.append(stack);
  dlg.addEventListener('cancel', (e) => {
    if (stack.querySelectorAll('.sheet-sub').length) { e.preventDefault(); popPage(dlg); }
  });
  return stack;
}

// Ligne de menu qui ouvre un sous-menu (chevron à droite) : à ajouter dans une liste .nm-list
export function subMenuRow(ic, label, open) {
  const b = el('button', { type: 'button', class: 'nm-sub', 'aria-haspopup': 'true' }, ic ? icon(ic, 20) : null, el('span', {}, label), el('span', { class: 'nm-chev', 'aria-hidden': 'true' }, icon('chevron', 18)));
  b.addEventListener('click', () => open(b));
  return b;
}

// Ouvre une page : { title, body (Node|Node[]), opener (bouton à refocaliser au retour) } → { page, pop }
export function pushPage(dlg, { title, body, opener = null }) {
  const stack = stackOf(dlg);
  const back = el('button', { type: 'button', class: 'sheet-x sheet-back', 'aria-label': t('menu.back') }, icon('back', 18));
  const close = closeButton(t('shell.menu.close'));
  const page = el('div', { class: 'sheet-page sheet-sub', role: 'group', 'aria-label': title });
  page.append(el('div', { class: 'sd-head sheet-subhead' }, back, el('h2', {}, title), close), ...(Array.isArray(body) ? body : [body]));
  page._opener = opener;
  back.addEventListener('click', () => popPage(dlg));
  close.addEventListener('click', () => dlg.close());
  const below = stack.lastElementChild;
  if (dlg._navBusy) return { page, pop: () => popPage(dlg) };
  const show = () => {
    stack.append(page);
    below.setAttribute('inert', '');
    below.hidden = true;
    // Au clavier : focus sur « retour » ; au toucher : sur la page elle-même, sans anneau visible
    if (keyboardActive()) back.focus({ preventScroll: true });
    else { page.tabIndex = -1; page.focus({ preventScroll: true }); }
  };
  if (reduced()) show();
  else { dlg._navBusy = true; playOut(dlg).then(() => { show(); return playIn(dlg); }).finally(() => { dlg._navBusy = false; }); }
  return { page, pop: () => popPage(dlg) };
}

export function popPage(dlg) {
  const stack = dlg.querySelector(':scope > .sheet-pages');
  const subs = stack ? stack.querySelectorAll('.sheet-sub') : [];
  const page = [...subs].pop();
  if (!page || dlg._navBusy) return !!page;
  const below = page.previousElementSibling;
  const show = () => {
    page.remove();
    below.hidden = false;
    below.removeAttribute('inert');
    if (page._opener?.isConnected && keyboardActive()) page._opener.focus({ preventScroll: true });
  };
  if (reduced()) show();
  else { dlg._navBusy = true; playOut(dlg).then(() => { show(); return playIn(dlg); }).finally(() => { dlg._navBusy = false; }); }
  return true;
}
