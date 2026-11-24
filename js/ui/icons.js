// Icônes SVG (tracé simple, couleur héritée). Créées avec createElementNS : jamais d'innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  reply: ['M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.4-.7L3 21l1.9-5A8.2 8.2 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z'],
  repost: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
  like: ['M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z'],
  zap: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  mute: ['M17.9 17.9A10.1 10.1 0 0 1 12 20c-6.5 0-10-8-10-8a17.7 17.7 0 0 1 4.1-5.4', 'M9.9 4.2A9.7 9.7 0 0 1 12 4c6.5 0 10 8 10 8a17.9 17.9 0 0 1-2.2 3.2', 'M14.1 14.1a3 3 0 1 1-4.2-4.2', 'M1 1l22 22'],
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
};

export function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 16.5, height: 16.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `icon icon-${name}` })) svg.setAttribute(k, String(v));
  for (const d of PATHS[name] ?? []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
