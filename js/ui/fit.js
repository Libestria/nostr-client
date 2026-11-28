// Raccourcit une longue valeur (clé publique…) au milieu pour qu'elle tienne sur une seule ligne, quelle que soit la largeur de l'écran.
// Police à chasse fixe : le nombre de caractères visibles se déduit de la largeur mesurée.

// Texte de `max` caractères au plus : début, « … », fin (la moitié chacun). Pur, sans DOM.
export function middle(full, max) {
  const text = String(full ?? '');
  if (!Number.isFinite(max) || text.length <= max) return text;
  if (max < 3) return '…';
  const keep = max - 1, head = Math.ceil(keep / 2), tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

// `node` : élément bloc (overflow masqué, une ligne) qui reçoit le texte ; il est recalculé quand sa largeur change.
export function fitLine(node, full) {
  const fit = () => {
    node.textContent = full;
    const w = node.clientWidth;
    if (!w || node.scrollWidth <= w) return;
    const per = node.scrollWidth / full.length;
    let max = Math.floor(w / per);
    node.textContent = middle(full, max);
    while (node.scrollWidth > node.clientWidth && max > 3) node.textContent = middle(full, --max);   // arrondis d'espacement entre lettres
  };
  fit();
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => { if (!node.isConnected) { ro.disconnect(); return; } fit(); });
    ro.observe(node);
  }
  node.title = full;
}
