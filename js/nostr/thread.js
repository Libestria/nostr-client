// Fil de discussion NIP-10 : parent d'une note et construction de l'arbre. Module sans DOM.
const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_DEPTH = 6;   // au-delà, l'affichage est aplati

const eTags = (ev) => (ev.tags ?? []).filter((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''));

// Identifiant du parent direct (marqueur « reply », sinon « root », sinon la dernière référence : ancien format).
export function parentId(ev) {
  const es = eTags(ev);
  if (!es.length) return null;
  const marked = es.find((t) => t[3] === 'reply') ?? es.find((t) => t[3] === 'root');
  return (marked ?? es[es.length - 1])[1];
}

// Identifiant de la racine annoncée par la note.
export function rootId(ev) {
  const es = eTags(ev);
  if (!es.length) return null;
  return (es.find((t) => t[3] === 'root') ?? es[0])[1];
}

// events : notes (kind 1) connues. Retourne { roots: [nœud], byId } ; nœud = { event, children, depth }.
// Les notes dont le parent est inconnu sont rattachées à la racine si elle est connue, sinon affichées en tête.
export function buildThread(events, focusId) {
  const byId = new Map();
  for (const ev of events) if (ev.kind === 1 && !byId.has(ev.id)) byId.set(ev.id, { event: ev, children: [], depth: 0 });
  const focus = byId.get(focusId);
  const top = focus ? (rootId(focus.event) ?? focusId) : focusId;
  const roots = [];
  const rootNode = byId.get(top) ?? null;
  const order = (a, b) => a.event.created_at - b.event.created_at || (a.event.id < b.event.id ? -1 : 1);
  for (const node of [...byId.values()].sort(order)) {
    if (node === rootNode) continue;
    const pid = parentId(node.event);
    const parent = pid && pid !== node.event.id ? byId.get(pid) : null;
    if (parent) parent.children.push(node);
    else if (rootNode && (rootId(node.event) === top || pid === top)) rootNode.children.push(node);
    else roots.push(node);
  }
  const list = rootNode ? [rootNode, ...roots] : roots;
  const mark = (node, depth, seen) => {
    if (seen.has(node)) return; // protège d'un cycle forgé
    seen.add(node);
    node.depth = Math.min(depth, MAX_DEPTH);
    node.children.sort(order);
    node.children.forEach((c) => mark(c, depth + 1, seen));
  };
  const seen = new Set();
  list.forEach((n) => mark(n, 0, seen));
  return { roots: list, byId };
}
