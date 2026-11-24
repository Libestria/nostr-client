// Icônes SVG (tracé simple, couleur héritée). Créées avec createElementNS : jamais d'innerHTML.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  reply: ['M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-3.4-.7L3 21l1.9-5A8.2 8.2 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z'],
  repost: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
  like: ['M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.8l8.8-8.8a5.2 5.2 0 0 0 0-7.4z'],
  zap: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  mute: ['M17.9 17.9A10.1 10.1 0 0 1 12 20c-6.5 0-10-8-10-8a17.7 17.7 0 0 1 4.1-5.4', 'M9.9 4.2A9.7 9.7 0 0 1 12 4c6.5 0 10 8 10 8a17.9 17.9 0 0 1-2.2 3.2', 'M14.1 14.1a3 3 0 1 1-4.2-4.2', 'M1 1l22 22'],
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
  home: ['M3 10.5L12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  mail: ['M3 5h18v14H3z', 'M3 7l9 6 9-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  wallet: ['M3 7a2 2 0 0 1 2-2h14v4', 'M3 7v11a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2z', 'M16 14.5h.01'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  copy: ['M9 9h11v11H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  chevron: ['M9 6l6 6-6 6'],
  send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
};

export function icon(name, size = 16.5) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'more' ? 3 : 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `icon icon-${name}` })) svg.setAttribute(k, String(v));
  for (const d of PATHS[name] ?? []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
