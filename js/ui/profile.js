import { t } from '../i18n.js';
import { state } from '../state.js';
import { el, pageTitle, stateBlock } from './common.js';
import { decode, npubEncode } from '../nostr/nip19.js';
import { resolveNip05 } from '../nostr/nip05.js';

export async function renderProfile(main, params) {
  const startHash = location.hash;
  const title = pageTitle('nav.profile');
  // N'écrit que si l'utilisateur n'a pas changé de page pendant l'attente.
  const show = (...nodes) => { if (location.hash === startHash) main.replaceChildren(title, ...nodes); };

  let id = params[0];
  if (!id) {
    const session = state.get('session');
    if (!session) return show(stateBlock('empty', 'profile.none'), el('p', {}, el('a', { class: 'btn', href: '#/login' }, t('login.cta'))));
    id = npubEncode(session.pubkey);
  }
  // Aucune clé privée n'est jamais acceptée, même en lecture.
  if (/^(nsec|ncryptsec)1/i.test(id)) return show(stateBlock('error', 'profile.nsecRefused'));

  let pubkey, relays = [];
  try {
    if (/^(npub|nprofile)1/i.test(id)) {
      const d = decode(id);
      if (d.type === 'npub') pubkey = d.data; else ({ pubkey, relays } = d.data);
    } else {
      show(stateBlock('loading', 'profile.resolving'));
      ({ pubkey, relays } = await resolveNip05(id));
    }
  } catch {
    return show(stateBlock('error', 'profile.invalid'));
  }
  show(
    el('p', { class: 'ident' }, npubEncode(pubkey)),
    ...(relays.length ? [el('h2', { class: 'section-title' }, t('profile.relays')),
      el('ul', { class: 'list' }, ...relays.slice(0, 8).map((r) => el('li', { class: 'ident' }, r)))] : []),
    stateBlock('empty', 'profile.pending'));
}
