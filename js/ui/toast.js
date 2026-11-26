// Messages d'avancement, de confirmation et d'erreur : affichés dans une fenêtre en bas de l'écran.
// Les éléments [role=status|alert] des pages et des fenêtres restent dans le DOM (lecteurs d'écran) mais sont masqués à l'écran ;
// leur texte est repris ici. Un élément marqué data-inline garde son affichage dans la page (état permanent, pas un message).
const SELECTOR = '[role="status"], [role="alert"]';
const SKIP = '[data-inline], .state, #offline, #toast';
const ERROR_MS = 8000, NORMAL_MS = 5000, HIDE_MS = 220;

let box = null, timer = null, owner = null, hideTimer = null;
const seen = new WeakMap();   // élément -> { text, error }

const canPopover = () => typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

function ensureBox() {
  if (box) return box;
  box = document.createElement('div');
  box.id = 'toast';
  box.className = 'toast';
  box.setAttribute('aria-hidden', 'true');   // l'élément source est déjà annoncé par les lecteurs d'écran
  if (canPopover()) box.setAttribute('popover', 'manual');   // couche supérieure : au-dessus des fenêtres modales
  box.hidden = true;
  box.addEventListener('click', () => hide());
  document.body.append(box);
  return box;
}

export function hide() {
  clearTimeout(timer); timer = null; owner = null;
  if (!box || box.hidden) return;
  box.dataset.state = 'out';
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (box.dataset.state !== 'out') return;
    try { if (canPopover() && box.matches(':popover-open')) box.hidePopover(); } catch { /* déjà fermé */ }
    box.hidden = true; box.dataset.state = '';
  }, HIDE_MS);
}

// Affiche un message. Progression (texte contenant « … ») : reste jusqu'à ce qu'il soit remplacé ou effacé.
export function toast(text, { error = false, from = null } = {}) {
  const b = ensureBox();
  clearTimeout(timer); clearTimeout(hideTimer);
  owner = from;
  b.textContent = text;
  b.classList.toggle('toast-error', !!error);
  b.hidden = false;
  try { if (canPopover() && !b.matches(':popover-open')) b.showPopover(); } catch { /* ignoré */ }
  b.dataset.state = 'in';
  if (!error && /…|\.\.\./.test(text)) return;
  timer = setTimeout(hide, error ? ERROR_MS : NORMAL_MS);
}

function check(elm) {
  if (!(elm instanceof Element) || elm.closest(SKIP)) return;
  if (!elm.classList.contains('toasted')) elm.classList.add('toasted');
  const text = (elm.textContent || '').replace(/\s+/g, ' ').trim();
  const error = !!(elm.classList.contains('status-error') || elm.querySelector('.status-error') || elm.getAttribute('role') === 'alert');
  const prev = seen.get(elm);
  if (prev && prev.text === text && prev.error === error) return;
  seen.set(elm, { text, error });
  if (text) toast(text, { error, from: elm });
  else if (owner === elm) hide();
}

function scan(node) {
  if (!(node instanceof Element)) return;
  if (node.matches(SELECTOR)) check(node);
  node.querySelectorAll?.(SELECTOR).forEach(check);
}

export function initToast() {
  if (typeof MutationObserver === 'undefined') return;
  const mo = new MutationObserver((records) => {
    const todo = new Set();
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach((n) => scan(n));
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      const host = target?.closest?.(SELECTOR);
      if (host) todo.add(host);
    }
    todo.forEach(check);
    if (owner && !owner.isConnected) hide();   // la page ou la fenêtre d'origine a disparu
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  scan(document.body);
}
