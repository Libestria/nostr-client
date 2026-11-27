// Médias d'une note (images, vidéos) : visionneuse plein écran et menu « … » (fenêtres natives <dialog>).
// Aucun contenu externe n'est inséré en HTML : le média est un élément <img> / <video> créé par el().
import { t } from '../i18n.js';
import { el, returnFocus, closeButton, setStatus } from './common.js';
import { toast } from './toast.js';
import { icon } from './icons.js';

const MAX_SAVE_BYTES = 200 * 1024 * 1024;   // au-delà, on n'essaie pas de télécharger en mémoire : ouverture dans un onglet

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Visionneuse : le média occupe tout l'écran, ✕ en haut à droite, Échap ou appui sur le fond pour fermer.
export function openViewer(url, kind, opener = null) {
  const dlg = el('dialog', { class: 'media-viewer', 'aria-label': t('media.viewer.label'), tabindex: '-1', autofocus: '' });
  const close = closeButton(t('shell.menu.close'), { cls: 'media-viewer-x' });
  close.addEventListener('click', () => dlg.close());
  const media = kind === 'video'
    ? el('video', { class: 'mv-media', src: url, controls: true, autoplay: true, playsinline: true })
    : el('img', { class: 'mv-media', src: url, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
  const stage = el('div', { class: 'mv-stage' }, media);
  media.addEventListener('error', () => stage.replaceChildren(el('a', { class: 'mv-fail', href: url, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, t('media.loadFailed'))));
  dlg.append(close, stage);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target === stage) dlg.close(); });
  dlg.addEventListener('close', () => { if (media instanceof HTMLVideoElement) media.pause(); dlg.remove(); returnFocus(opener); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}

// Enregistrer : télécharge le média puis le propose à l'appareil (feuille de partage, sinon téléchargement).
// Si le site refuse la copie (CORS), le média est ouvert dans un nouvel onglet pour un enregistrement manuel.
async function saveMedia(url, say, done) {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'media') || 'media';
  say('media.saving');
  let blob;
  try {
    const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('http');
    if (Number(res.headers.get('content-length')) > MAX_SAVE_BYTES) throw new Error('size');
    blob = await res.blob();
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    say('media.saveFallback', 'warn');
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); done('media.shared'); return; }
  } catch (e) { if (e?.name === 'AbortError') { say(null); return; } /* autre erreur : repli sur le téléchargement */ }
  const href = URL.createObjectURL(blob);
  const a = el('a', { href, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
  done('media.downloaded');
}

// Menu « … » d'un média : visionneuse, nouvel onglet, copier l'URL, enregistrer.
export function openMediaMenu(url, kind, opener = null) {
  const dlg = el('dialog', { class: 'note-menu', 'aria-label': t('media.menu'), tabindex: '-1', autofocus: '' });
  const msg = el('div', { class: 'note-msg', role: 'status' });
  const close = closeButton(t('shell.menu.close'));
  close.addEventListener('click', () => dlg.close());
  const list = el('ul', { class: 'drawer-list nm-list' });
  const say = (key, kind = 'info') => setStatus(msg, key ? t(key) : '', kind);
  // Action réussie : le message passe dans la fenêtre du bas et le menu se ferme
  const done = (key) => { toast(t(key), { kind: 'ok' }); dlg.close(); };
  const row = (ic, label, run) => {
    const b = el('button', { type: 'button' }, icon(ic, 20), el('span', {}, label));
    b.addEventListener('click', () => run(b));
    list.append(el('li', {}, b));
  };
  row('expand', t('media.viewer'), () => { dlg.close(); openViewer(url, kind, opener); });
  row('external', t('media.newTab'), () => { window.open(url, '_blank', 'noopener,noreferrer'); dlg.close(); });
  row('copy', t('media.copyUrl'), async () => (await copy(url)) ? done('note.copied') : say('compose.err.generic', 'error'));
  row('download', t('media.save'), async (b) => { b.disabled = true; try { await saveMedia(url, say, done); } finally { b.disabled = false; } });
  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, t('media.menu')), close), list, msg);
  dlg.addEventListener('close', () => { dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}

// Média d'une note avec son bouton « … » en haut à droite. `fallback` : le lien en texte, remis si le média ne se charge pas.
export function mediaBox(url, kind, fallback) {
  const more = el('button', { type: 'button', class: 'note-more media-more', 'aria-haspopup': 'dialog', 'aria-label': t('media.more'), title: t('media.more') }, icon('more', 18));
  let node;
  if (kind === 'video') {
    // « #t=0.1 » : Safari charge alors une première image fixe, qui sert d'aperçu et délimite la vidéo
    node = el('video', { class: 'note-video', src: `${url.split('#')[0]}#t=0.1`, controls: true, playsinline: true, preload: 'metadata' });
  } else {
    const img = el('img', { class: 'note-img', src: url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    node = el('div', { class: 'note-media' }, img);   // un appui sur l'image ne fait rien : tout passe par le menu « … »
  }
  const box = el('div', { class: 'media-box' }, node, more);
  node.addEventListener('error', () => box.replaceWith(fallback), true);   // erreur de l'<img>/<video> (l'événement ne remonte pas : phase de capture)
  more.addEventListener('click', () => openMediaMenu(url, kind, more));
  return box;
}
