// Code QR : bibliothèque qrcode-generator (MIT, vendor/qrcode.js), chargée à la demande comme script classique (CSP : 'self').
// Le dessin est construit avec createElementNS (jamais d'innerHTML). Noir sur blanc quel que soit le thème, zone de silence incluse.
let loading = null;

function loadLib() {
  if (globalThis.qrcode) return Promise.resolve(globalThis.qrcode);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/qrcode.js', import.meta.url).href;
    s.onload = () => (globalThis.qrcode ? resolve(globalThis.qrcode) : reject(new Error('qrcode')));
    s.onerror = () => { loading = null; reject(new Error('qrcode')); };
    document.head.append(s);
  });
  return loading;
}

// Retourne un <svg> ; rejette si la bibliothèque est absente ou si le texte est trop long pour un code QR.
export async function qrSvg(text, label = '') {
  const lib = await loadLib();
  if (lib.stringToBytesFuncs?.['UTF-8']) lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];
  const qr = lib(0, 'L');            // taille automatique, correction d'erreur faible : liens longs
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet},${r + quiet}h1v1h-1z`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'qr');
  svg.setAttribute('role', 'img');
  if (label) svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d); path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}
