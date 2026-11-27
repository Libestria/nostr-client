// Sous-menus des fenêtres « verre » : une rubrique ouvre une page qui glisse depuis la droite, avec retour « < » et fermeture « ✕ ».
// Les pages sont empilées dans la même fenêtre native (<dialog>) ; Échap revient d'abord à la page précédente.
import { t } from '../i18n.js';
import { el, closeButton } from './common.js';
import { icon } from './icons.js';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  stack.append(page);
  if (!reduced()) page.classList.add('sheet-enter');
  below.setAttribute('inert', '');
  below.classList.add('sheet-under');
  back.focus({ preventScroll: true });
  return { page, pop: () => popPage(dlg) };
}

export function popPage(dlg) {
  const stack = dlg.querySelector(':scope > .sheet-pages');
  const subs = stack ? stack.querySelectorAll('.sheet-sub') : [];
  const page = [...subs].filter((p) => !p.classList.contains('sheet-leave')).pop();
  if (!page) return false;
  const below = page.previousElementSibling;
  const done = () => { page.remove(); };
  below.removeAttribute('inert');
  below.classList.remove('sheet-under');
  if (page._opener?.isConnected) page._opener.focus({ preventScroll: true });
  if (reduced()) done();
  else { page.classList.remove('sheet-enter'); page.classList.add('sheet-leave'); page.addEventListener('animationend', done, { once: true }); setTimeout(done, 400); }
  return true;
}
