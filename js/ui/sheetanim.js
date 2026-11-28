// Animation des fenêtres « verre » (menus, sous-menus, statistiques, QR) : apparition et disparition sur place.
// Apparition : la fenêtre se déplie (ressort) et son contenu passe de flou à net. Disparition : même mouvement, inversé et plus court.
// Un sous-menu s'enchaîne : le menu se ferme, puis le sous-menu apparaît (voir sheetnav.js).
// Les fenêtres natives <dialog> se ferment d'un coup : ce module retarde close() le temps de l'animation.
export const SHEET = '.note-menu, .stats-dialog';
export const T_IN = 380;
export const T_OUT = 160;

export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function play(dlg, cls, ms) {
  return new Promise((resolve) => {
    dlg.classList.remove('sheet-in', 'sheet-out');
    if (reduced() || !dlg.isConnected) { resolve(); return; }
    void dlg.offsetWidth;   // relance l'animation
    dlg.classList.add(cls);
    let done = false;
    const end = () => { if (done) return; done = true; if (cls === 'sheet-in') dlg.classList.remove(cls); resolve(); };
    dlg.addEventListener('animationend', (e) => { if (e.target === dlg) end(); });
    setTimeout(end, ms + 80);
  });
}
export const playIn = (dlg) => play(dlg, 'sheet-in', T_IN);
export const playOut = (dlg) => play(dlg, 'sheet-out', T_OUT);

export function initSheetAnim() {
  if (typeof HTMLDialogElement === 'undefined' || HTMLDialogElement.prototype.__sheetAnim) return;
  const proto = HTMLDialogElement.prototype;
  const nativeShow = proto.showModal;
  const nativeClose = proto.close;
  proto.__sheetAnim = true;
  proto.showModal = function showModal(...args) {
    nativeShow.apply(this, args);
    if (this.matches(SHEET)) playIn(this);
  };
  proto.close = function close(...args) {
    if (!this.open || !this.matches(SHEET) || reduced()) return nativeClose.apply(this, args);
    if (this._closing) return undefined;
    this._closing = true;
    playOut(this).then(() => { this._closing = false; this.classList.remove('sheet-out'); nativeClose.apply(this, args); });
    return undefined;
  };
  // Échap : même animation (sauf s'il y a un sous-menu : sheetnav.js revient d'abord à la page précédente)
  document.addEventListener('cancel', (e) => {
    const dlg = e.target;
    if (!(dlg instanceof HTMLDialogElement) || !dlg.matches(SHEET) || reduced() || dlg.querySelector('.sheet-sub')) return;
    e.preventDefault();
    dlg.close();
  }, true);
}
