import { t } from '../i18n.js';
import { state } from '../state.js';
import { el, pageTitle, stateBlock } from './common.js';

export function renderFeed(main) {
  const login = state.get('session') ? [] : [el('p', {}, el('a', { class: 'btn', href: '#/login' }, t('login.cta')))];
  main.replaceChildren(pageTitle('nav.feed'), stateBlock('empty', 'feed.empty'), ...login);
}

export function placeholder(titleKey) {
  return (main) => main.replaceChildren(pageTitle(titleKey), stateBlock('empty', 'state.soon'));
}
