// Page Notifications : une rangée d'icônes (mentions, réactions, reposts, zaps, abonnés) avec pastilles de non-lus.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { npubEncode } from '../nostr/nip19.js';
import { noteHref } from '../nostr/content.js';
import { getCached, onProfiles, requestProfile } from '../profiles.js';
import { unreadTotal } from '../dms.js';
import { seenAt, markNotificationsSeen } from '../notifications.js';
import { GROUPS, groupOf } from '../nostr/notif.js';
import { formatSats } from '../nostr/nip57.js';
import { el, pageTitle, stateBlock, shortNpub, timeAgo } from './common.js';
import { icon } from './icons.js';

const nameOf = (pk) => { const p = getCached(pk); return p?.displayName || p?.name || shortNpub(pk); };
const TAB_ICON = { mentions: 'reply', reactions: 'like', reposts: 'repost', zaps: 'zap', follows: 'users' };
const TYPE_ICON = { mention: 'reply', reply: 'reply', reaction: 'like', repost: 'repost', zap: 'zap', follow: 'users' };

export function renderNotifications(main, params = []) {
  const first = GROUPS.find((g) => state.get('notif').by?.[g] > 0) ?? GROUPS[0];
  const group = GROUPS.includes(params[0]) ? params[0] : first;
  const seenBefore = seenAt(group);   // pour surligner ce qui est nouveau dans cet onglet
  const tabs = el('nav', { class: 'tabs tabs-icons', 'aria-label': t('notif.tabs') });
  const list = el('ul', { class: 'notif-list' });
  const dmLine = el('p', {});

  const paintTabs = () => {
    const by = state.get('notif').by ?? {};
    tabs.replaceChildren(...GROUPS.map((g) => {
      const n = g === group ? 0 : by[g] ?? 0;
      const label = t(`notif.tab.${g}`);
      return el('a', { class: 'tab tab-icon', href: `#/notifications/${g}`, 'aria-current': g === group ? 'page' : false, 'aria-label': n ? `${label} (${n})` : label, title: label },
        el('span', { class: 'tab-ico' }, icon(TAB_ICON[g], 20), n ? el('span', { class: 'pill' }, n > 99 ? '99+' : String(n)) : null));
    }));
  };
  const paint = () => {
    const items = state.get('notif').items.filter((n) => groupOf(n.type) === group);
    items.forEach((n) => requestProfile(n.actor));
    const dm = unreadTotal();
    dmLine.replaceChildren(dm ? el('a', { class: 'btn', href: '#/messages' }, t('notif.dms', { n: dm })) : '');
    paintTabs();
    if (!items.length) { list.replaceChildren(el('li', {}, stateBlock('empty', 'notif.emptyTab'))); return; }
    list.replaceChildren(...items.map((n) => {
      const href = n.type === 'mention' || n.type === 'reply' ? noteHref(n.id) : n.target ? noteHref(n.target) : `#/profile/${npubEncode(n.actor)}`;
      return el('li', { class: `card notif notif-${n.type}${n.created_at > seenBefore ? ' notif-new' : ''}` },
        el('a', { href, class: 'notif-main' }, icon(TYPE_ICON[n.type] ?? 'bell', 18), el('strong', {}, t(`notif.${n.type}`, { name: nameOf(n.actor), emoji: n.emoji ?? '', n: n.sats != null ? formatSats(n.sats) : '' }))),
        n.content ? el('p', { class: 'notif-text' }, n.content.length > 160 ? `${n.content.slice(0, 160)}…` : n.content) : null,
        el('time', { datetime: new Date(n.created_at * 1000).toISOString() }, timeAgo(n.created_at)));
    }));
  };
  main.replaceChildren(pageTitle('nav.notifications'), tabs, dmLine, list);
  paint();
  markNotificationsSeen(group);
  const stops = [state.on('notif', () => { paint(); markNotificationsSeen(group); }), state.on('dm', paint), onProfiles(paint)];
  return () => stops.forEach((s) => s());
}
