import { t } from '../i18n.js';
import { state } from '../state.js';
import { decode, npubEncode } from '../nostr/nip19.js';
import { resolveNip05, parseIdentifier } from '../nostr/nip05.js';
import { getCached, onProfiles, requestProfile } from '../profiles.js';
import { conversations, conversationMessages, markRead, sendDm, startDms, dmStats } from '../dms.js';
import { pool } from '../relays/pool.js';
import { partnersOf } from '../nostr/dm.js';
import { el, pageTitle, stateBlock, shortNpub, timeAgo } from './common.js';

const HEX64 = /^[0-9a-f]{64}$/;
const nameOf = (pk) => { const p = getCached(pk); return p?.displayName || p?.name || shortNpub(pk); };
const label = (participants, me) => {
  const others = participants.filter((p) => p !== me);
  if (!others.length) return t('dm.self');
  return others.map(nameOf).join(', ');
};
const preview = (text) => { const s = text.replace(/\s+/g, ' ').trim(); return s.length > 90 ? `${s.slice(0, 90)}…` : s; };

async function resolveRecipient(input) {
  const v = String(input).trim();
  if (HEX64.test(v)) return v;
  if (parseIdentifier(v)) return (await resolveNip05(v)).pubkey;
  const d = decode(v.replace(/^nostr:/i, ''));
  if (d.type === 'npub') return d.data;
  if (d.type === 'nprofile') return d.data.pubkey;
  throw new Error('invalid');
}

// Page Messages : #/messages (liste), #/messages/<npub|nprofile|hex> (conversation), #/messages/group/<conv>
export function renderDms(main, params) {
  const me = state.get('session').pubkey;
  const title = pageTitle('nav.messages');
  const status = () => state.get('dm').status;
  const banner = () => {
    const s = status();
    if (s === 'nosigner' || s === 'norelays' || s === 'denied' || s === 'syncing') {
      const box = el('p', { class: `status${s === 'syncing' ? '' : ' warn'}`, role: 'status' }, t(`dm.status.${s}`));
      if (s === 'denied') { const b = el('button', { type: 'button', class: 'btn btn-small' }, t('dm.retry')); b.addEventListener('click', () => startDms()); box.append(' ', b); }
      return box;
    }
    return null;
  };
  // Diagnostic : relais de messagerie et progression du déchiffrement
  const diag = () => {
    const d = dmStats();
    const relays = pool.status().filter((r) => r.dm);
    const lines = relays.map((r) => `${r.url} — ${r.state}${r.authenticated ? ', authentifié' : ''}${r.notice ? ` (${String(r.notice).slice(0, 80)})` : ''}`);
    return el('details', { class: 'dm-diag' }, el('summary', {}, t('dm.diag.title')),
      el('p', {}, t('dm.diag.stats', { received: d.received, opened: d.opened, skipped: d.skipped, pending: d.pending, eose: d.eose ? t('dm.diag.yes') : t('dm.diag.no') })),
      d.error ? el('p', {}, t('dm.diag.error', { code: d.error })) : null,
      el('ul', {}, ...(lines.length ? lines : [t('dm.diag.norelay')]).map((l) => el('li', {}, l))));
  };
  const stops = [];

  // ---- Conversation
  const openConversation = (conv, readOnlyGroup) => {
    const participants = conv.split(',');
    const partner = readOnlyGroup ? null : partnersOf(participants, me)[0];
    participants.forEach(requestProfile);
    const heading = el('h2', {}, label(participants, me));
    const back = el('a', { href: '#/messages' }, t('dm.back'));
    const list = el('ul', { class: 'dm-thread', 'aria-live': 'polite' });
    const paint = () => {
      const msgs = conversationMessages(conv);
      heading.textContent = label(participants, me);
      list.replaceChildren(...msgs.map((m) => el('li', { class: m.mine ? 'dm-msg dm-mine' : 'dm-msg' },
        readOnlyGroup && !m.mine ? el('strong', {}, nameOf(m.from)) : null,
        el('p', {}, m.content),
        el('time', { datetime: new Date(m.created_at * 1000).toISOString() }, timeAgo(m.created_at)))));
      if (!msgs.length) list.replaceChildren(el('li', { class: 'state' }, t('dm.empty')));
      markRead(conv);
    };
    const parts = [title, el('p', {}, back), heading, el('div', { class: 'dm-banner' }, banner()), list];
    if (readOnlyGroup) parts.push(el('p', { class: 'status' }, t('dm.group')));
    else {
      const ta = el('textarea', { id: 'dm-text', rows: 3, maxlength: 20000, 'aria-label': t('dm.input') });
      const send = el('button', { type: 'submit', class: 'btn' }, t('dm.send'));
      const result = el('p', { class: 'compose-result', role: 'status' });
      const form = el('form', { class: 'composer' }, ta, el('div', {}, send), result);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        send.disabled = true; result.textContent = t('dm.sending');
        try {
          const res = await sendDm(partner, text);
          if (res.ok) { ta.value = ''; result.textContent = t('dm.sent', { ok: res.ok, total: res.partner.length }); }
          else result.textContent = t('dm.error.FAILED');
        } catch (err) {
          const code = err?.code === 'signer' ? 'SIGNER' : err?.message;
          result.textContent = t(`dm.error.${['NO_DM_RELAYS', 'NO_NIP44', 'READ_ONLY', 'SIGNER', 'INVALID'].includes(code) ? code : 'FAILED'}`);
        }
        send.disabled = false; paint();
      });
      parts.push(form);
    }
    parts.push(el('p', { class: 'status' }, t('dm.privacy')));
    main.replaceChildren(...parts);
    paint();
    stops.push(state.on('dm', () => { const keep = document.activeElement; paint(); const b = main.querySelector('.dm-banner'); b?.replaceChildren(...[banner()].filter(Boolean)); if (keep?.focus) keep.focus(); }));
    stops.push(onProfiles(paint));
  };

  // ---- Liste
  const openList = () => {
    const list = el('ul', { class: 'dm-list' });
    const input = el('input', { type: 'text', id: 'dm-new', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const go = el('button', { type: 'submit', class: 'btn' }, t('dm.new.go'));
    const err = el('p', { class: 'compose-result', role: 'alert' });
    const form = el('form', { class: 'add-relay' }, el('label', { for: 'dm-new' }, t('dm.new.label')), input, go, err);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = ''; go.disabled = true;
      try { location.hash = `#/messages/${npubEncode(await resolveRecipient(input.value))}`; }
      catch { err.textContent = t('dm.new.invalid'); }
      go.disabled = false;
    });
    const banner0 = el('div', { class: 'dm-banner' }, banner());
    const diagBox = el('div', {}, diag());
    const paint = () => {
      const convs = conversations();
      convs.forEach((c) => c.participants.forEach(requestProfile));
      if (!convs.length) { list.replaceChildren(el('li', {}, stateBlock('empty', 'dm.empty'))); return; }
      list.replaceChildren(...convs.map((c) => {
        const group = c.participants.length > 2;
        const href = group ? `#/messages/group/${encodeURIComponent(c.conv)}` : `#/messages/${npubEncode(partnersOf(c.participants, me)[0])}`;
        return el('li', { class: 'card dm-item' },
          el('a', { href }, el('strong', {}, label(c.participants, me)), c.unread ? el('span', { class: 'badge' }, t('dm.unread', { n: c.unread })) : null),
          el('p', {}, `${c.last.mine ? `${t('dm.me')} : ` : ''}${preview(c.last.content)}`),
          el('time', { datetime: new Date(c.last.created_at * 1000).toISOString() }, timeAgo(c.last.created_at)));
      }));
    };
    main.replaceChildren(title, banner0, diagBox, form, list, el('p', { class: 'status' }, t('dm.privacy')));
    paint();
    stops.push(state.on('dm', () => { banner0.replaceChildren(...[banner()].filter(Boolean)); if (!diagBox.querySelector('details[open]')) diagBox.replaceChildren(diag()); if (!list.contains(document.activeElement)) paint(); }));
    stops.push(onProfiles(() => { if (!list.contains(document.activeElement)) paint(); }));
  };

  if (params[0] === 'group' && params[1]) { openConversation(params[1], true); return () => stops.forEach((s) => s()); }
  if (params[0]) {
    main.replaceChildren(title, stateBlock('loading', 'state.loading'));
    let alive = true;
    resolveRecipient(params[0]).then((pk) => {
      if (!alive) return;
      const conv = [...new Set([me, pk])].sort().join(',');
      openConversation(conv, false);
    }).catch(() => { if (alive) main.replaceChildren(title, stateBlock('error', 'dm.new.invalid')); });
    return () => { alive = false; stops.forEach((s) => s()); };
  }
  openList();
  return () => stops.forEach((s) => s());
}
