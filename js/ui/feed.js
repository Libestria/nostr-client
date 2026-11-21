import { pageTitle, stateBlock } from './common.js';

export function renderFeed(main) {
  main.replaceChildren(pageTitle('nav.feed'), stateBlock('empty', 'feed.empty'));
}

export function placeholder(titleKey) {
  return (main) => main.replaceChildren(pageTitle(titleKey), stateBlock('empty', 'state.soon'));
}
