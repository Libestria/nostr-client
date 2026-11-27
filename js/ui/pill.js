// Pastille de profil (miniature + nom), utilisée au-dessus des notes (« a reposté », « En réponse à ») et dans les menus.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { getCached, requestProfile, onProfiles } from '../profiles.js';
import { el, shortNpub } from './common.js';

const nameOf = (pk) => { const p = getCached(pk); return p?.displayName || p?.name || shortNpub(pk); };

// href → lien ; sans href → simple étiquette (à placer dans un bouton). Le nom se met à jour quand le profil arrive.
export function profilePill(pk, href = null) {
  requestProfile(pk);
  const av = el('span', { class: 'avatar avatar-xs', 'aria-hidden': 'true', 'data-av': pk });
  const who = el('span', { class: 'who', 'data-pk': pk }, nameOf(pk));
  const fill = () => {
    const p = getCached(pk);
    if (p?.picture && state.get('settings')?.loadMedia && !av.firstChild) {
      const img = el('img', { src: p.picture, alt: '', width: 44, height: 44, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      av.append(img);
    }
    who.textContent = nameOf(pk);
  };
  fill();
  const pill = href ? el('a', { class: 'ctx-pill', href }, av, who) : el('span', { class: 'ctx-pill' }, av, who);
  const off = onProfiles(() => { if (!who.isConnected) off(); else fill(); });
  return pill;
}

// Texte avec « {name} » remplacé par la pastille : withPill('note.follow', pk) → [texte, pastille, texte]
export function withPill(key, pk) {
  const [before, after = ''] = t(key, { name: '\u0000' }).split('\u0000');
  return [before, profilePill(pk), after].filter((x) => x !== '');
}
