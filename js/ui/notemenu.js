// Menu « … » d'une note (fenêtre native) : 4 rubriques à sous-menus — Auteur, Note, Modération — et Supprimer (mes notes).
import { t } from '../i18n.js';
import { state } from '../state.js';
import { getSigner } from '../auth.js';
import { pool } from '../relays/pool.js';
import { seenOn } from '../relays/seen.js';
import { publishToMany } from '../relays/oneshot.js';
import { npubEncode, noteEncode, neventEncode } from '../nostr/nip19.js';
import { noteHref } from '../nostr/content.js';
import { buildDeletion, buildReport, REPORT_TYPES } from '../nostr/compose.js';
import { parseContacts, buildContactsTemplate } from '../nostr/contacts.js';
import { publishEvent, republishEvent } from '../publish.js';
import { putEvent, deleteEvent } from '../storage/db.js';
import { loadReplaceable } from '../replaceable.js';
import { getCached, requestProfile } from '../profiles.js';
import { muteList, editMute } from '../mute.js';
import { el, returnFocus, closeButton, setStatus, shortNpub } from './common.js';
import { icon } from './icons.js';
import { pushPage } from './sheetnav.js';
import { showResult, errorKey } from './composer.js';
import { openCompose } from './composedialog.js';
import { toast } from './toast.js';

const linkOf = (ev) => `${location.origin}${location.pathname}${noteHref(ev.id)}`;

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const nameOf = (pk) => { const p = getCached(pk); return p?.displayName || p?.name || shortNpub(pk); };
const nip05Of = (pk) => String(getCached(pk)?.nip05 ?? '').trim().replace(/^_@/, '');

// Relais qui ont livré la note (tous ceux vus ; à défaut, celui indiqué par le fil)
const relaysOf = (ev, via) => { const seen = seenOn(ev.id); return seen.length ? seen : via ? [via] : []; };

// opts : { via, opener, onHidden(key), onDeleted() }
export function openNoteMenu(ev, { via = null, opener = null, onHidden, onDeleted } = {}) {
  const signer = getSigner();
  const mine = !!signer && signer.pubkey === ev.pubkey;
  const dlg = el('dialog', { class: 'note-menu', 'aria-label': t('menu.note'), tabindex: '-1', autofocus: '' });
  const close = closeButton(t('shell.menu.close'));
  close.addEventListener('click', () => dlg.close());
  const author = ev.pubkey;
  const stops = [];
  requestProfile(author);

  // Un message d'état par page : le message s'affiche dans la page visible (la plus récente encore ouverte)
  const msgs = [];
  const newMsg = () => { const m = el('div', { class: 'note-msg', role: 'status' }); msgs.push(m); return m; };
  const live = () => [...msgs].reverse().find((m) => m.isConnected) ?? msgs[0];
  const say = (key, kind = 'info') => setStatus(live(), t(key), kind);
  const sayText = (text, kind = 'info') => setStatus(live(), text, kind);
  // Action réussie : le message passe dans la fenêtre du bas et le menu se ferme ; en cas d'échec, le menu reste ouvert avec l'erreur
  const done = (text, kind = 'ok') => { toast(text, { kind }); dlg.close(); };
  const copied = async (text) => { if (await copy(text)) done(t('note.copied')); else say('compose.err.generic', 'error'); };

  const hints = relaysOf(ev, via).filter((r) => /^wss:\/\//.test(r)).slice(0, 2);
  const nevent = () => neventEncode({ id: ev.id, relays: hints, author: ev.pubkey, kind: ev.kind });

  // Liste de rubriques (une par page)
  const makeList = () => {
    const list = el('ul', { class: 'drawer-list nm-list' });
    let lastGroup = null;
    const sep = (group) => {
      if (lastGroup !== null && group !== lastGroup) list.append(el('li', { class: 'nm-gap', role: 'presentation' }));
      lastGroup = group;
    };
    // Rubrique : href → lien ; sub → chevron (sous-menu) ; warn → rouge
    const add = (ic, label, run, { href = null, warn = false, group = 0, sub = false } = {}) => {
      sep(group);
      const chev = sub ? el('span', { class: 'nm-chev', 'aria-hidden': 'true' }, icon('chevron', 18)) : null;
      const node = href ? el('a', { href }, icon(ic, 20), el('span', {}, label))
        : el('button', { type: 'button', class: warn ? 'nm-warn' : '', ...(sub ? { 'aria-haspopup': 'true' } : {}) }, icon(ic, 20), el('span', {}, label), chev);
      if (!href) node.addEventListener('click', () => run(node));
      else node.addEventListener('click', () => dlg.close());
      list.append(el('li', {}, node));
      return node;
    };
    // Valeur à copier : intitulé en petit, valeur tronquée et icône de copie à droite
    const valueRow = (label, value) => {
      const b = el('button', { type: 'button', class: 'nm-value', 'aria-label': `${t('note.copyOne')} : ${label}` }, el('span', { class: 'nm-vtext' }, value), icon('copy', 18));
      b.addEventListener('click', () => copied(value));
      return el('li', { class: 'nm-valuerow' }, el('span', { class: 'nm-vlabel' }, label), b);
    };
    const addValue = (label, value, group) => { sep(group); list.append(valueRow(label, value)); };
    return { list, add, addValue, valueRow, sep };
  };
  const openPage = (title, body, op) => pushPage(dlg, { title, body, opener: op });

  // ── Auteur ──
  const authorPage = (node) => {
    const { list, add, addValue } = makeList();
    const name = nameOf(author);
    add('user', t('note.viewProfile', { name }), null, { href: `#/profile/${npubEncode(author)}`, group: 1 });
    if (signer) {
      const follow = add('users', '', async () => {
        if (busy || !contacts) return;
        busy = true; paint(); say('lists.publishing');
        try {
          const tpl = buildContactsTemplate(contacts, isFollowing() ? 'unfollow' : 'follow', author);
          if (!tpl) { say('profile.follow.nochange'); return; }
          const signed = await signer.signEvent(tpl);
          const results = await pool.publish(signed);
          const ok = results.filter((r) => r.ok).length;
          if (!ok) { sayText(t('profile.follow.failed', { reason: results[0]?.message || t('compose.norelay') }), 'error'); return; }
          contacts = signed; putEvent(signed);
          done(t('profile.follow.done', { ok, total: results.length }), ok < results.length ? 'warn' : 'ok');
        } catch { say('profile.follow.signFail', 'error'); } finally { busy = false; paint(); }
      }, { group: 1 });
      paintFollow = paint;
      function paint() {
        follow.disabled = busy || !contacts;
        follow.querySelector('span').textContent = followReady && !contacts ? t('profile.follow.unavailable')
          : t(isFollowing() ? 'note.unfollow' : 'note.follow', { name });
      }
      paint();
    }
    const nip05 = nip05Of(author);
    if (nip05) addValue(t('note.author.nip05'), nip05, 2);
    addValue(t('note.author.npub'), npubEncode(author), 2);
    addValue(t('note.author.hex'), author, 2);
    openPage(t('note.sec.author'), [list, newMsg()], node);
  };
  // Ma liste d'abonnements : chargée dès l'ouverture du menu pour que « Suivre » soit prêt à l'ouverture de la page
  let contacts = null, followReady = false, busy = false, paintFollow = null;
  const isFollowing = () => !!contacts && parseContacts(contacts).includes(author);
  if (signer && !mine) {
    const sub = loadReplaceable(3, signer.pubkey, (e) => { contacts = e; paintFollow?.(); }, () => { followReady = true; paintFollow?.(); });
    stops.push(() => sub.close());
  }

  // ── Note ──
  const notePage = (node) => {
    const { list, add } = makeList();
    if (signer) add('reply', t('note.quote'), () => {
      dlg.close();
      openCompose({ quote: { id: ev.id, text: `\n\nnostr:${nevent()}` }, opener });
    }, { group: 1 });
    add('thread', t('note.thread'), null, { href: noteHref(ev.id), group: 1 });
    add('copy', t('note.copyText'), () => copied(ev.content), { group: 1 });
    add('repost', t('note.share'), (b) => sharePage(b), { group: 2, sub: true });
    add('settings', t('note.details'), (b) => detailsPage(b), { group: 2, sub: true });
    openPage(t('note.sec.note'), [list, newMsg()], node);
  };

  const sharePage = (node) => {
    const { list, valueRow, sep, add } = makeList();
    list.append(valueRow(t('note.share.id'), nevent()), valueRow(t('note.share.link'), linkOf(ev)));
    if (typeof navigator.share === 'function') {
      sep(1);
      add('repost', t('note.share.action'), async () => {
        try { await navigator.share({ url: linkOf(ev), text: `nostr:${nevent()}` }); dlg.close(); } catch { /* annulé : le menu reste ouvert */ }
      }, { group: 1 });
    }
    openPage(t('note.share'), [list, newMsg()], node);
  };

  const detailsPage = (node) => {
    const { list, valueRow, add } = makeList();
    list.append(valueRow(t('note.d.nevent'), nevent()), valueRow(t('note.d.note1'), noteEncode(ev.id)), valueRow(t('note.d.hex'), ev.id));
    const row = (k, v) => [el('dt', {}, t(k)), el('dd', {}, v)];
    const dl = el('dl', { class: 'nm-details' }, ...row('note.d.date', new Date(ev.created_at * 1000).toLocaleString(document.documentElement.lang || 'fr')), ...row('note.d.kind', String(ev.kind)));
    add('eye', t('note.json.view'), (b) => openPage(t('note.json.title'), el('pre', { class: 'nm-json' }, JSON.stringify(ev, null, 2)), b), { group: 1, sub: true });
    add('copy', t('note.copyJson'), () => copied(JSON.stringify(ev)), { group: 1 });
    if (mine) add('send', t('note.republish'), (b) => republishPage(b), { group: 1, sub: true });
    const body = [list, dl];
    const seen = relaysOf(ev, via);
    if (seen.length) body.push(el('div', { class: 'nm-seen' }, el('strong', {}, t('note.d.seen')), el('ul', {}, ...seen.map((r) => el('li', {}, r.replace(/^wss:\/\//, ''))))));
    body.push(newMsg());
    openPage(t('note.details'), body, node);
  };

  // Republier : renvoie la note signée telle quelle (sans nouvelle signature), à tous les relais d'écriture ou à un seul
  const republishPage = (node) => {
    const { list } = makeList();
    const relays = (state.get('lists')?.pub?.relays ?? []).filter((r) => r.write).map((r) => r.url);
    const run = async (job) => {
      say('lists.publishing');
      try {
        const res = await job();
        if (res.queued) { done(t('compose.queued'), 'info'); return; }
        const kind = res.ok < res.total ? 'warn' : 'ok';
        if (res.ok) done(t('note.republish.done', { ok: res.ok, total: res.total }), kind);
        else sayText(t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error');
      } catch { say('compose.err.generic', 'error'); }
    };
    if (!relays.length) list.append(el('li', {}, el('p', { class: 'hint nm-hint' }, t('note.republish.none'))));
    else {
      const all = el('button', { type: 'button' }, icon('send', 20), el('span', {}, t('note.republish.all')));
      all.addEventListener('click', () => run(() => republishEvent(ev)));
      list.append(el('li', {}, all), el('li', { class: 'nm-gap', role: 'presentation' }));
      for (const url of relays) {
        const b = el('button', { type: 'button' }, icon('globe', 20), el('span', {}, url.replace(/^wss:\/\//, '')));
        b.addEventListener('click', () => run(async () => { const results = await publishToMany([url], ev); return { ok: results.filter((r) => r.ok).length, total: results.length }; }));
        list.append(el('li', {}, b));
      }
    }
    openPage(t('note.republish.title'), [list, newMsg()], node);
  };

  // ── Modération (compte connecté, note d'un autre) ──
  const moderationPage = (node) => {
    const { list, add } = makeList();
    const name = nameOf(author);
    const muted = () => muteList().pubkeys.includes(author);
    add('mute', t(muted() ? 'mute.unmuteNamed' : 'mute.accountNamed', { name }), async (b) => {
      b.disabled = true; say('lists.publishing');
      const wasMuted = muted();
      try {
        const res = await editMute([{ type: wasMuted ? 'remove' : 'add', kind: 'pubkey', value: author }]);
        if (res.ok) { if (wasMuted) done(t('mute.unmuted')); else { dlg.close(); onHidden?.('mute.done'); } }
        else { b.disabled = false; sayText(t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error'); }
      } catch { b.disabled = false; say('compose.err.generic', 'error'); }
    }, { group: 1 });
    add('mute', t('note.muteThread'), async (b) => {
      b.disabled = true; say('lists.publishing');
      try {
        const res = await editMute([{ type: 'add', kind: 'event', value: ev.id }]);
        if (res.ok) { dlg.close(); onHidden?.('mute.threadDone'); } else { b.disabled = false; sayText(t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error'); }
      } catch { b.disabled = false; say('compose.err.generic', 'error'); }
    }, { group: 1 });
    add('lock', t('note.report'), (b) => reportPage(b), { group: 2, sub: true });
    openPage(t('note.sec.moderation'), [list, newMsg()], node);
  };

  const reportPage = (node) => {
    const ul = el('ul', { class: 'drawer-list nm-list' });
    for (const type of REPORT_TYPES) {
      const b = el('button', { type: 'button' }, el('span', {}, t(`note.report.${type}`)));
      b.addEventListener('click', async () => {
        b.disabled = true; say('lists.publishing');
        try {
          const res = await publishEvent(buildReport(ev, type));
          if (res.ok) done(t('note.report.done', { ok: res.ok, total: res.total }), res.ok < res.total ? 'warn' : 'ok');
          else { b.disabled = false; sayText(t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error'); }
        } catch (e) { b.disabled = false; sayText(t(errorKey(e)), 'error'); }
      });
      ul.append(el('li', {}, b));
    }
    openPage(t('note.report.title'), [ul, el('p', { class: 'hint nm-hint' }, t('note.report.hint')), newMsg()], node);
  };

  // ── Racine : 4 rubriques ──
  const root = makeList();
  if (!mine) root.add('user', t('note.sec.author'), authorPage, { sub: true });
  root.add('thread', t('note.sec.note'), notePage, { sub: true });
  if (signer && !mine) root.add('lock', t('note.sec.moderation'), moderationPage, { sub: true });
  if (mine) {
    let armed = false, deleting = false;
    root.add('trash', t('note.deleteMine'), async (b) => {
      const label = b.querySelector('span');
      if (!armed) { armed = true; label.textContent = t('note.delete.confirm'); say('note.delete.hint', 'warn'); return; }
      if (deleting) return;
      deleting = true; b.disabled = true; say('lists.publishing');
      const reset = () => { armed = false; b.disabled = false; label.textContent = t('note.deleteMine'); };
      try {
        const build = () => buildDeletion(ev, signer.pubkey);
        const res = await publishEvent(build());
        showResult(live(), res, () => publishEvent(build()));
        if (res.ok) { deleteEvent(ev.id); dlg.close(); onDeleted?.(); } else reset();
      } catch (e) { sayText(t(errorKey(e)), 'error'); reset(); } finally { deleting = false; }
    }, { warn: true, group: 1 });
  }

  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, t('menu.note')), close), root.list, newMsg());
  dlg.addEventListener('close', () => { stops.forEach((s) => s()); dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}
