// Menu « … » d'une note (fenêtre native) : auteur, note (citer, partager, détails), modération, suppression.
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

// opts : { via, opener, onHidden(), onDeleted() }
export function openNoteMenu(ev, { via = null, opener = null, onHidden, onDeleted } = {}) {
  const signer = getSigner();
  const mine = !!signer && signer.pubkey === ev.pubkey;
  const dlg = el('dialog', { class: 'note-menu', 'aria-label': t('menu.note'), tabindex: '-1', autofocus: '' });
  const msg = el('div', { class: 'note-msg', role: 'status' });
  const close = closeButton(t('shell.menu.close'));
  close.addEventListener('click', () => dlg.close());
  const list = el('ul', { class: 'drawer-list nm-list' });
  const author = ev.pubkey;
  const stops = [];
  requestProfile(author);

  const say = (key, kind = 'info') => setStatus(msg, t(key), kind);
  // Action réussie : le message passe dans la fenêtre du bas et le menu se ferme ; en cas d'échec, le menu reste ouvert avec l'erreur
  const done = (text, kind = 'ok') => { toast(text, { kind }); dlg.close(); };
  const copied = async (text) => { if (await copy(text)) done(t('note.copied')); else say('compose.err.generic', 'error'); };

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

  const hints = relaysOf(ev, via).filter((r) => /^wss:\/\//.test(r)).slice(0, 2);
  const nevent = () => neventEncode({ id: ev.id, relays: hints, author: ev.pubkey, kind: ev.kind });

  // ── Auteur (note d'un autre compte) ──
  if (!mine) {
    const name = nameOf(author);
    add('user', t('note.viewProfile', { name }), null, { href: `#/profile/${npubEncode(author)}`, group: 1 });
    if (signer) {
      let contacts = null, ready = false, busy = false;
      const isFollowing = () => !!contacts && parseContacts(contacts).includes(author);
      const follow = add('users', '', async () => {
        if (busy || !contacts) return;
        busy = true; paint(); say('lists.publishing');
        try {
          const tpl = buildContactsTemplate(contacts, isFollowing() ? 'unfollow' : 'follow', author);
          if (!tpl) { say('profile.follow.nochange'); return; }
          const signed = await signer.signEvent(tpl);
          const results = await pool.publish(signed);
          const ok = results.filter((r) => r.ok).length;
          if (!ok) { setStatus(msg, t('profile.follow.failed', { reason: results[0]?.message || t('compose.norelay') }), 'error'); return; }
          contacts = signed; putEvent(signed);
          done(t('profile.follow.done', { ok, total: results.length }), ok < results.length ? 'warn' : 'ok');
        } catch { say('profile.follow.signFail', 'error'); } finally { busy = false; paint(); }
      }, { group: 1 });
      const paint = () => {
        follow.disabled = busy || !contacts;
        follow.querySelector('span').textContent = ready && !contacts ? t('profile.follow.unavailable')
          : t(isFollowing() ? 'note.unfollow' : 'note.follow', { name });
      };
      paint();
      const sub = loadReplaceable(3, signer.pubkey, (e) => { contacts = e; paint(); }, () => { ready = true; paint(); });
      stops.push(() => sub.close());
    }
    const nip05 = nip05Of(author);
    if (nip05) addValue(t('note.author.nip05'), nip05, 1);
    addValue(t('note.author.npub'), npubEncode(author), 1);
    addValue(t('note.author.hex'), author, 1);
  }

  // ── Note ──
  if (signer) add('reply', t('note.quote'), () => {
    dlg.close();
    openCompose({ quote: { id: ev.id, text: `\n\nnostr:${nevent()}` }, opener });
  }, { group: 2 });
  add('thread', t('note.thread'), null, { href: noteHref(ev.id), group: 2 });
  add('copy', t('note.copyText'), () => copied(ev.content), { group: 2 });

  add('repost', t('note.share'), (node) => {
    const ul = el('ul', { class: 'drawer-list nm-list' }, valueRow(t('note.share.id'), nevent()), valueRow(t('note.share.link'), linkOf(ev)));
    if (typeof navigator.share === 'function') {
      const b = el('button', { type: 'button' }, icon('repost', 20), el('span', {}, t('note.share.action')));
      b.addEventListener('click', async () => { try { await navigator.share({ url: linkOf(ev), text: `nostr:${nevent()}` }); dlg.close(); } catch { /* annulé : le menu reste ouvert */ } });
      ul.append(el('li', { class: 'nm-gap', role: 'presentation' }), el('li', {}, b));
    }
    pushPage(dlg, { title: t('note.share'), body: ul, opener: node });
  }, { group: 2, sub: true });

  add('settings', t('note.details'), (node) => {
    const ul = el('ul', { class: 'drawer-list nm-list' }, valueRow(t('note.d.nevent'), nevent()), valueRow(t('note.d.note1'), noteEncode(ev.id)), valueRow(t('note.d.hex'), ev.id));
    const row = (k, v) => [el('dt', {}, t(k)), el('dd', {}, v)];
    const dl = el('dl', { class: 'nm-details' }, ...row('note.d.date', new Date(ev.created_at * 1000).toLocaleString(document.documentElement.lang || 'fr')), ...row('note.d.kind', String(ev.kind)));
    const act = (ic, label, run, sub = false) => {
      const b = el('button', { type: 'button', ...(sub ? { 'aria-haspopup': 'true' } : {}) }, icon(ic, 20), el('span', {}, label), sub ? el('span', { class: 'nm-chev', 'aria-hidden': 'true' }, icon('chevron', 18)) : null);
      b.addEventListener('click', () => run(b));
      return el('li', {}, b);
    };
    const json = JSON.stringify(ev, null, 2);
    const items = [el('li', { class: 'nm-gap', role: 'presentation' }),
      act('eye', t('note.json.view'), (b) => pushPage(dlg, { title: t('note.json.title'), body: el('pre', { class: 'nm-json' }, json), opener: b }), true),
      act('copy', t('note.copyJson'), () => copied(JSON.stringify(ev)))];
    if (mine) items.push(act('send', t('note.republish'), (b) => openRepublish(b), true));
    ul.append(...items);
    const seen = relaysOf(ev, via);
    const body = [ul, dl];
    if (seen.length) body.push(el('div', { class: 'nm-seen' }, el('strong', {}, t('note.d.seen')), el('ul', {}, ...seen.map((r) => el('li', {}, r.replace(/^wss:\/\//, ''))))));
    pushPage(dlg, { title: t('note.details'), body, opener: node });
  }, { group: 2, sub: true });

  // Republier : renvoie la note signée telle quelle (sans nouvelle signature), à tous les relais d'écriture ou à un seul
  const openRepublish = (opener2) => {
    const relays = (state.get('lists')?.pub?.relays ?? []).filter((r) => r.write).map((r) => r.url);
    const ul = el('ul', { class: 'drawer-list nm-list' });
    const run = async (label, job) => {
      say('lists.publishing');
      try {
        const res = await job();
        if (res.queued) { done(t('compose.queued'), 'info'); return; }
        const kind = !res.ok ? 'error' : res.ok < res.total ? 'warn' : 'ok';
        if (res.ok) done(t('note.republish.done', { ok: res.ok, total: res.total }), kind);
        else setStatus(msg, t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error');
      } catch { say('compose.err.generic', 'error'); }
    };
    if (!relays.length) ul.append(el('li', {}, el('p', { class: 'hint' }, t('note.republish.none'))));
    else {
      const all = el('button', { type: 'button' }, icon('send', 20), el('span', {}, t('note.republish.all')));
      all.addEventListener('click', () => run('all', () => republishEvent(ev)));
      ul.append(el('li', {}, all), el('li', { class: 'nm-gap', role: 'presentation' }));
      for (const url of relays) {
        const b = el('button', { type: 'button' }, icon('globe', 20), el('span', {}, url.replace(/^wss:\/\//, '')));
        b.addEventListener('click', () => run(url, async () => { const results = await publishToMany([url], ev, { sign: signer.signEvent }); return { ok: results.filter((r) => r.ok).length, total: results.length }; }));
        ul.append(el('li', {}, b));
      }
    }
    pushPage(dlg, { title: t('note.republish.title'), body: ul, opener: opener2 });
  };

  // ── Modération (compte connecté, note d'un autre) ──
  if (signer && !mine) {
    const name = nameOf(author);
    const muted = () => muteList().pubkeys.includes(author);
    add('mute', t(muted() ? 'mute.unmuteNamed' : 'mute.accountNamed', { name }), async (b) => {
      b.disabled = true; say('lists.publishing');
      const wasMuted = muted();
      try {
        const res = await editMute([{ type: wasMuted ? 'remove' : 'add', kind: 'pubkey', value: author }]);
        if (res.ok) { if (wasMuted) done(t('mute.unmuted')); else { dlg.close(); onHidden?.('mute.done'); } }
        else { b.disabled = false; setStatus(msg, t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error'); }
      } catch { b.disabled = false; say('compose.err.generic', 'error'); }
    }, { group: 3 });
    add('mute', t('note.muteThread'), async (b) => {
      b.disabled = true; say('lists.publishing');
      try {
        const res = await editMute([{ type: 'add', kind: 'event', value: ev.id }]);
        if (res.ok) { dlg.close(); onHidden?.('mute.threadDone'); } else { b.disabled = false; setStatus(msg, t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error'); }
      } catch { b.disabled = false; say('compose.err.generic', 'error'); }
    }, { group: 3 });
    add('lock', t('note.report'), (node) => {
      const ul = el('ul', { class: 'drawer-list nm-list' });
      for (const type of REPORT_TYPES) {
        const b = el('button', { type: 'button' }, el('span', {}, t(`note.report.${type}`)));
        b.addEventListener('click', async () => {
          b.disabled = true; say('lists.publishing');
          try {
            const res = await publishEvent(buildReport(ev, type));
            if (res.ok) done(t('note.report.done', { ok: res.ok, total: res.total }), res.ok < res.total ? 'warn' : 'ok');
            else { b.disabled = false; setStatus(msg, t('lists.publish.failed', { ok: res.ok, total: res.total }), 'error'); }
          } catch (e) { b.disabled = false; setStatus(msg, t(errorKey(e)), 'error'); }
        });
        ul.append(el('li', {}, b));
      }
      pushPage(dlg, { title: t('note.report.title'), body: [ul, el('p', { class: 'hint nm-hint' }, t('note.report.hint'))], opener: node });
    }, { group: 3, sub: true });
  }

  // ── Ma note ──
  if (mine) {
    let armed = false, busy = false;
    add('trash', t('note.deleteMine'), async (b) => {
      if (!armed) { armed = true; b.querySelector('span').textContent = t('note.delete.confirm'); say('note.delete.hint', 'warn'); return; }
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

  dlg.append(el('div', { class: 'sd-head' }, el('h2', {}, t('menu.note')), close), list, msg);
  dlg.addEventListener('close', () => { stops.forEach((s) => s()); dlg.remove(); returnFocus(opener); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal?.() ?? dlg.setAttribute('open', '');
}
