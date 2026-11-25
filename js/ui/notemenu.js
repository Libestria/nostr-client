// Menu « … » d'une note (fenêtre native) : copier, partager, détails, ouvrir le fil, masquer, supprimer.
import { t } from '../i18n.js';
import { getSigner } from '../auth.js';
import { npubEncode, noteEncode } from '../nostr/nip19.js';
import { noteHref } from '../nostr/content.js';
import { buildDeletion } from '../nostr/compose.js';
import { publishEvent } from '../publish.js';
import { deleteEvent } from '../storage/db.js';
import { editMute } from '../mute.js';
import { el } from './common.js';
import { icon } from './icons.js';
import { showResult, errorKey } from './composer.js';

const linkOf = (ev) => `${location.origin}${location.pathname}${noteHref(ev.id)}`;

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// opts : { via, opener, onHidden(), onDeleted() }
export function openNoteMenu(ev, { via = null, opener = null, onHidden, onDeleted } = {}) {
  const signer = getSigner();
  const mine = !!signer && signer.pubkey === ev.pubkey;
  const dlg = el('dialog', { class: 'note-menu', 'aria-label': t('menu.note'), tabindex: '-1', autofocus: '' });
  const msg = el('div', { class: 'note-msg', role: 'status' });
  const close = el('button', { type: 'button', class: 'sheet-x', 'aria-label': t('shell.menu.close') }, '✕');
  close.addEventListener('click', () => dlg.close());
  const list = el('ul', { class: 'drawer-list nm-list' });
  const detailsBox = el('dl', { class: 'nm-details', hidden: true });

  let lastGroup = null;
  const add = (ic, label, run, { href = null, warn = false, group = 0 } = {}) => {
    if (lastGroup !== null && group !== lastGroup) list.append(el('li', { class: 'nm-gap', role: 'presentation' }));
    lastGroup = group;
    const node = href ? el('a', { href }, icon(ic, 20), el('span', {}, label)) : el('button', { type: 'button', class: warn ? 'nm-warn' : '' }, icon(ic, 20), el('span', {}, label));
    if (!href) node.addEventListener('click', () => run(node));
    else node.addEventListener('click', () => dlg.close());
    list.append(el('li', {}, node));
    return node;
  };
  const say = (key) => msg.replaceChildren(t(key));

  add('copy', t('note.copyText'), async () => say((await copy(ev.content)) ? 'note.copied' : 'compose.err.generic'), { group: 1 });
  add('copy', t('note.copyLink'), async () => say((await copy(linkOf(ev))) ? 'note.copied' : 'compose.err.generic'), { group: 1 });
  if (typeof navigator.share === 'function') add('repost', t('note.share'), async () => { try { await navigator.share({ url: linkOf(ev), text: `nostr:${noteEncode(ev.id)}` }); } catch { /* annulé */ } }, { group: 1 });
  add('copy', t('note.copyId'), async () => say((await copy(noteEncode(ev.id))) ? 'note.copied' : 'compose.err.generic'), { group: 1 });
  add('copy', t('note.copyJson'), async () => say((await copy(JSON.stringify(ev))) ? 'note.copied' : 'compose.err.generic'), { group: 1 });
  add('reply', t('note.thread'), null, { href: noteHref(ev.id), group: 2 });
  add('settings', t('note.details'), () => {
    if (!detailsBox.hidden) { detailsBox.hidden = true; return; }
    const row = (k, v) => [el('dt', {}, t(k)), el('dd', {}, v)];
    detailsBox.replaceChildren(...row('note.d.id', noteEncode(ev.id)), ...row('note.d.author', npubEncode(ev.pubkey)),
      ...row('note.d.date', new Date(ev.created_at * 1000).toLocaleString(document.documentElement.lang || 'fr')), ...row('note.d.kind', String(ev.kind)),
      ...(via ? row('note.d.relay', via.replace(/^wss:\/\//, '')) : []));
    detailsBox.hidden = false;
  }, { group: 2 });

  if (signer && !mine) {
    add('mute', t('mute.account'), async (b) => {
      b.disabled = true; say('lists.publishing');
      try {
        const res = await editMute([{ type: 'add', kind: 'pubkey', value: ev.pubkey }]);
        if (res.ok) { dlg.close(); onHidden?.('mute.done'); } else { b.disabled = false; msg.replaceChildren(t('lists.publish.failed', { ok: res.ok, total: res.total })); }
      } catch { b.disabled = false; say('compose.err.generic'); }
    }, { group: 3 });
    add('mute', t('note.muteThread'), async (b) => {
      b.disabled = true; say('lists.publishing');
      try {
        const res = await editMute([{ type: 'add', kind: 'event', value: ev.id }]);
        if (res.ok) { dlg.close(); onHidden?.('mute.threadDone'); } else { b.disabled = false; msg.replaceChildren(t('lists.publish.failed', { ok: res.ok, total: res.total })); }
      } catch { b.disabled = false; say('compose.err.generic'); }
    }, { group: 3 });
  }
  if (mine) {
    let armed = false, busy = false;
    add('trash', t('note.deleteMine'), async (b) => {
      if (!armed) { armed = true; b.querySelector('span').textContent = t('note.delete.confirm'); say('note.delete.hint'); return; }
      if (busy) return;
      busy = true; b.disabled = true; say('lists.publishing');
      try {
        const build = () => buildDeletion(ev, signer.pubkey);
        const res = await publishEvent(build());
        showResult(msg, res, () => publishEvent(build()));
        if (res.ok) { deleteEvent(ev.id); dlg.close(); onDeleted?.(); } else { armed = false; b.disabled = false; b.querySelector('span').textContent = t('note.deleteMine'); }
      } catch (e) { msg.replaceChildren(el('span', { class: 'status status-error' }, t(errorKey(e)))); armed = false; b.disabled = false; b.querySelector('span').textContent = t('note.deleteMine'); } finally { busy = false; }
    }, { warn: true, group: 4 });
  }

  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, t('menu.note')), close), list, detailsBox, msg);
  dlg.addEventListener('close', () => { dlg.remove(); opener?.focus?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}
