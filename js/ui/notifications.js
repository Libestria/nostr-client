import { t } from '../i18n.js';
import { state } from '../state.js';
import { npubEncode } from '../nostr/nip19.js';
import { noteHref } from '../nostr/content.js';
import { getCached, onProfiles, requestProfile } from '../profiles.js';
import { unreadTotal } from '../dms.js';
import { seenAt, markNotificationsSeen } from '../notifications.js';
import { formatSats } from '../nostr/nip57.js';
import { el, pageTitle, stateBlock, shortNpub, timeAgo } from './common.js';

const nameOf = (pk) => { const p = getCached(pk); return p?.displayName || p?.name || shortNpub(pk); };

export function renderNotifications(main) {
  const seenBefore = seenAt();
  const list = el('ul', { class: 'notif-list' });
  const dmLine = el('p', {});
  const paint = () => {
    const { items } = state.get('notif');
    items.forEach((n) => requestProfile(n.actor));
    const n = unreadTotal();
    dmLine.replaceChildren(n ? el('a', { class: 'btn', href: '#/messages' }, t('notif.dms', { n })) : '');
    if (!items.length) { list.replaceChildren(el('li', {}, stateBlock('empty', 'notif.empty'))); return; }
    list.replaceChildren(...items.map((n) => {
      const href = n.type === 'mention' || n.type === 'reply' ? noteHref(n.id) : n.target ? noteHref(n.target) : `#/profile/${npubEncode(n.actor)}`;
      return el('li', { class: `card notif notif-${n.type}${n.created_at > seenBefore ? ' notif-new' : ''}` },
        el('a', { href }, el('strong', {}, t(`notif.${n.type}`, { name: nameOf(n.actor), emoji: n.emoji ?? '', n: n.sats != null ? formatSats(n.sats) : '' }))),
        n.content ? el('p', { class: 'notif-text' }, n.content.length > 160 ? `${n.content.slice(0, 160)}…` : n.content) : null,
        el('time', { datetime: new Date(n.created_at * 1000).toISOString() }, timeAgo(n.created_at)));
    }));
  };
  main.replaceChildren(pageTitle('nav.notifications'), dmLine, list);
  paint();
  markNotificationsSeen();
  const stops = [state.on('notif', () => { paint(); markNotificationsSeen(); }), state.on('dm', paint), onProfiles(paint)];
  return () => stops.forEach((s) => s());
}
