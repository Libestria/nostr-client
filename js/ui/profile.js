import { el, pageTitle, stateBlock } from './common.js';

export function renderProfile(main, params) {
  const id = params[0];
  const title = pageTitle('nav.profile');
  if (!id) return main.replaceChildren(title, stateBlock('empty', 'profile.none'));
  // Aucune clé privée n'est jamais acceptée, même en lecture.
  if (/^nsec1/i.test(id)) return main.replaceChildren(title, stateBlock('error', 'profile.nsecRefused'));
  // L'analyse NIP-19 / NIP-05 arrive avec le module nostr/nip19.js.
  main.replaceChildren(title, el('p', { class: 'ident' }, id), stateBlock('empty', 'profile.pending'));
}
