import { t } from '../i18n.js';
import { state } from '../state.js';
import { pool } from '../relays/pool.js';
import { latest, getReplaceable, putEvent } from '../storage/db.js';
import { decode, npubEncode } from '../nostr/nip19.js';
import { resolveNip05, parseIdentifier } from '../nostr/nip05.js';
import { parseContacts, buildContactsTemplate } from '../nostr/contacts.js';
import { getCached, onProfiles, requestProfile } from '../profiles.js';
import { getSigner } from '../auth.js';
import { el, pageTitle, stateBlock, shortNpub } from './common.js';
import { authorLink, noteCard, updateAuthors } from './note.js';
import { profileEditor } from './profile-edit.js';
import { planFor } from '../relays/outbox.js';
import { zapPanel } from './zap.js';

const PAGE = 30;
const PEOPLE_PAGE = 50;
const HEX64 = /^[0-9a-f]{64}$/;

function nip05Label(text) {
  const id = parseIdentifier(text);
  return id ? (id.name === '_' ? id.domain : `${id.name}@${id.domain}`) : text;
}

// Charge un événement remplaçable d'un compte : cache d'abord, puis relais. onChange(ev) à chaque version plus récente.
function loadReplaceable(kind, pubkey, onChange, onDone) {
  let cur = null;
  const take = (ev) => {
    if (ev?.kind !== kind || ev.pubkey !== pubkey || (cur && ev.created_at <= cur.created_at)) return;
    cur = ev;
    onChange(ev);
  };
  getReplaceable(kind, pubkey).then(take);
  return pool.subscribe([{ kinds: [kind], authors: [pubkey], limit: 1 }], {
    closeOnEose: true, onevent: take,
    oneose: () => onDone?.(cur, pool.status().filter((r) => r.state === 'open').length),
  });
}

export function renderProfile(main, params) {
  const title = pageTitle('nav.profile');
  const session = state.get('session');
  let id = params[0];
  if (!id) {
    if (!session) {
      main.replaceChildren(title, stateBlock('empty', 'profile.none'), el('p', {}, el('a', { class: 'btn', href: '#/login' }, t('login.cta'))));
      return undefined;
    }
    id = npubEncode(session.pubkey);
  }
  if (/^(nsec|ncryptsec)1/i.test(id)) { main.replaceChildren(title, stateBlock('error', 'profile.nsecRefused')); return undefined; }

  let alive = true;
  const stops = [];
  const body = el('div');
  main.replaceChildren(title, body);

  (async () => {
    let pubkey;
    try {
      if (/^(npub|nprofile)1/i.test(id)) {
        const d = decode(id);
        pubkey = d.type === 'npub' ? d.data : d.data.pubkey;
      } else {
        body.replaceChildren(stateBlock('loading', 'profile.resolving'));
        ({ pubkey } = await resolveNip05(id));
      }
    } catch {
      if (alive) body.replaceChildren(stateBlock('error', 'profile.invalid'));
      return;
    }
    if (alive && HEX64.test(pubkey)) build(pubkey);
  })();

  function build(pubkey) {
    const npub = npubEncode(pubkey);
    const me = session?.pubkey;
    const head = el('section', { class: 'p-head' });
    const actions = el('div', { class: 'row' });
    const msg = el('p', { class: 'status', role: 'status' });
    const tabbar = el('div', { class: 'tabs', role: 'group', 'aria-label': t('profile.sections') });
    const panel = el('div');
    body.replaceChildren(head, actions, msg, tabbar, panel);

    // ---- en-tête et NIP-05
    let nip05State = null, nip05For = null, shown = undefined;
    const paintHead = () => {
      const p = getCached(pubkey);
      const media = state.get('settings')?.loadMedia;
      const name = p?.displayName || p?.name || shortNpub(pubkey);
      const av = media && p?.picture
        ? el('img', { class: 'avatar avatar-lg', src: p.picture, alt: '', width: 72, height: 72, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
        : el('span', { class: 'avatar avatar-lg', 'aria-hidden': 'true' });
      av.addEventListener?.('error', () => av.remove());
      const badge = p?.nip05 ? el('p', { class: 'nip05' },
        el('span', { class: `badge badge-${nip05State ?? 'checking'}` }, t(`nip05.${nip05State ?? 'checking'}`)), ' ', el('span', { class: 'ident' }, nip05Label(p.nip05))) : null;
      head.replaceChildren(
        ...(media && p?.banner ? [el('img', { class: 'p-banner', src: p.banner, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })] : []),
        el('div', { class: 'p-id' }, av, el('div', {}, el('h2', { class: 'p-name' }, name), badge)),
        p?.about ? el('p', { class: 'p-about' }, p.about) : null,
        p?.lud16 ? el('p', { class: 'ident' }, `⚡ ${p.lud16}`) : null,
        el('p', { class: 'ident' }, npub));
    };
    const verify = async (p) => {
      if (!p?.nip05 || nip05For === p.nip05) return;
      nip05For = p.nip05; nip05State = 'checking'; paintHead();
      try { nip05State = (await resolveNip05(p.nip05)).pubkey === pubkey ? 'ok' : 'bad'; }
      catch (e) { nip05State = e?.message === 'not-found' ? 'bad' : 'unreachable'; }
      if (alive) paintHead();
    };
    const onProfile = () => {
      const p = getCached(pubkey);
      if (p !== shown) { shown = p; paintHead(); verify(p); }
      updateAuthors(panel);
    };
    stops.push(onProfiles(onProfile));
    requestProfile(pubkey, { force: true });
    onProfile(); paintHead();

    // ---- modification de son propre profil
    if (me && me === pubkey && getSigner()) {
      const edit = el('button', { type: 'button', class: 'btn' }, t('pe.open'));
      const slot = el('div');
      let editor = null;
      edit.addEventListener('click', () => {
        if (editor) { editor.stop(); editor = null; slot.replaceChildren(); edit.textContent = t('pe.open'); return; }
        editor = profileEditor(pubkey, { onSaved: () => {} });
        slot.replaceChildren(editor.node);
        edit.textContent = t('pe.close');
      });
      actions.append(edit);
      head.after(slot);
      stops.push(() => editor?.stop());
    }

    // ---- actions : copier, suivre
    const copy = el('button', { type: 'button', class: 'btn' }, t('profile.copy'));
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(npub); msg.textContent = t('profile.copied'); } catch { msg.textContent = t('profile.copyFail'); }
      msg.classList.remove('status-error');
    });
    actions.append(copy);

    const say = (text, error = false) => { msg.textContent = text; msg.classList.toggle('status-error', error); };
    let mine = null, mineReady = false, mineRelays = 0, confirmEmpty = false, busy = false;
    const follow = el('button', { type: 'button', class: 'btn', disabled: true }, t('state.loading'));
    const isFollowing = () => !!mine && parseContacts(mine).includes(pubkey);
    const paintFollow = () => {
      const signer = getSigner();
      if (!signer) { follow.disabled = true; follow.textContent = t('profile.follow'); return; }
      const unavailable = mineReady && !mine && mineRelays === 0;
      follow.disabled = busy || (!mine && !mineReady) || unavailable;
      follow.textContent = busy ? t('state.loading') : unavailable ? t('profile.follow.unavailable')
        : confirmEmpty ? t('profile.follow.confirm') : isFollowing() ? t('profile.unfollow') : t('profile.follow');
    };
    if (me && me !== pubkey) {
      actions.append(follow);
      if (getSigner()) {
        let panel = null;
        const zap = el('button', { type: 'button', class: 'btn' }, t('profile.zap'));
        zap.addEventListener('click', () => {
          if (panel) { panel.remove(); panel = null; return; }
          panel = zapPanel({ recipient: pubkey, onClose: () => { panel = null; } });
          actions.after(panel);
        });
        actions.append(zap);
      }
      if (!getSigner()) actions.append(el('a', { class: 'btn', href: '#/login' }, t('profile.follow.needSigner')));
      const mineSub = loadReplaceable(3, me, (ev) => { mine = ev; paintFollow(); }, (ev, open) => { mineReady = true; mineRelays = open; paintFollow(); });
      stops.push(() => mineSub.close());
      follow.addEventListener('click', async () => {
        const signer = getSigner();
        if (!signer || busy) return;
        if (!mine && !confirmEmpty) { confirmEmpty = true; say(t('profile.follow.empty'), true); paintFollow(); return; }
        confirmEmpty = false; busy = true; paintFollow(); say('');
        try {
          const tpl = buildContactsTemplate(mine, isFollowing() ? 'unfollow' : 'follow', pubkey);
          if (!tpl) { say(t('profile.follow.nochange')); return; }
          const signed = await signer.signEvent(tpl);
          const results = await pool.publish(signed);
          const ok = results.filter((r) => r.ok).length;
          if (!ok) { say(t('profile.follow.failed', { reason: results[0]?.message || 'aucun relais' }), true); return; }
          mine = signed; putEvent(signed);
          say(t('profile.follow.done', { ok, total: results.length }));
        } catch { say(t('profile.follow.signFail'), true); }
        finally { busy = false; paintFollow(); }
      });
    } else if (!me) actions.append(el('a', { class: 'btn', href: '#/login' }, t('login.cta')));
    paintFollow();

    // ---- liste des abonnements de ce compte (kind 3)
    let theirs = null;
    const tabs = {};
    const countLabel = (key, n) => (n == null ? t(key) : `${t(key)} (${n})`);
    const theirSub = loadReplaceable(3, pubkey, (ev) => { theirs = ev; tabs.follows.textContent = countLabel('profile.tab.follows', parseContacts(ev).length); if (current === 'follows') show('follows'); });
    stops.push(() => theirSub.close());

    // ---- panneaux
    let current = null, stopPanel = null;
    const people = (pks) => {
      let n = 0;
      const ul = el('ul', { class: 'people' });
      const more = el('button', { type: 'button', class: 'btn' }, t('feed.more'));
      const next = () => {
        pks.slice(n, n + PEOPLE_PAGE).forEach((pk) => ul.append(el('li', {}, authorLink(pk))));
        n += PEOPLE_PAGE; more.hidden = n >= pks.length;
      };
      more.addEventListener('click', next); next();
      return el('div', {}, ul, more);
    };
    const panels = {
      notes() {
        const notes = new Map(); const subs = []; let oldest = Infinity, drawTimer = null, live = true;
        const list = el('div', { class: 'notes' });
        const holder = el('div', {}, stateBlock('loading', 'state.loading'));
        const more = el('button', { type: 'button', class: 'btn' }, t('feed.more')); more.hidden = true;
        const draw = () => { drawTimer = null; list.replaceChildren(...[...notes.values()].sort((a, b) => b.created_at - a.created_at).map((ev) => noteCard(ev, { author: false }))); };
        const add = (ev) => {
          if (!live || ev.kind !== 1 || ev.pubkey !== pubkey || notes.has(ev.id)) return;
          notes.set(ev.id, ev); oldest = Math.min(oldest, ev.created_at); holder.replaceChildren(); more.hidden = false;
          drawTimer ||= setTimeout(draw, 150);
        };
        // modèle outbox : les notes d'un compte sont lues sur ses relais d'écriture, en plus des relais du compte connecté
        const page = async (first) => {
          more.disabled = true;
          const mine = pool.status().filter((r) => r.read && r.scope === 'account').map((r) => r.url);
          let urls = [];
          try { urls = [...(await planFor([pubkey], { mine })).byRelay.keys()]; } catch { /* repli : relais du compte */ }
          if (!live) return;
          const filter = [{ kinds: [1], authors: [pubkey], limit: PAGE, ...(first ? {} : { until: oldest - 1 }) }];
          const byRelay = new Map([...new Set([...urls, ...mine])].map((u) => [u, filter]));
          subs.push(pool.subscribe(filter, {
            closeOnEose: true, onevent: add, ...(byRelay.size ? { relayFilters: byRelay } : {}),
            oneose: () => { if (!notes.size) holder.replaceChildren(stateBlock('empty', 'profile.noNotes')); more.disabled = false; },
          }));
        };
        more.addEventListener('click', () => page(false));
        latest({ kinds: [1], limit: 300 }).then((evs) => evs.filter((e) => e.pubkey === pubkey).slice(0, PAGE).forEach(add));
        page(true);
        return { node: el('div', {}, holder, list, more), stop: () => { live = false; clearTimeout(drawTimer); subs.forEach((s) => s.close()); } };
      },
      follows() {
        if (!theirs) return { node: stateBlock('loading', 'state.loading'), stop() {} };
        const pks = parseContacts(theirs);
        return { node: pks.length ? people(pks) : stateBlock('empty', 'profile.noFollows'), stop() {} };
      },
      followers() {
        const found = new Map(); const node = el('div', {}, stateBlock('loading', 'state.loading'));
        let done = false, draw = null, live = true;
        const paint = () => {
          draw = null; if (!live) return;
          const pks = [...found.keys()];
          node.replaceChildren(el('p', { class: 'hint' }, t('profile.followers.note', { n: pks.length })), ...(pks.length ? [people(pks)] : done ? [stateBlock('empty', 'profile.noFollowers')] : [stateBlock('loading', 'state.loading')]));
        };
        const sub = pool.subscribe([{ kinds: [3], '#p': [pubkey], limit: 200 }], {
          closeOnEose: true, maxEvents: 300,
          onevent: (ev) => { if (ev.kind === 3 && !found.has(ev.pubkey) && parseContacts(ev).includes(pubkey)) { found.set(ev.pubkey, ev); draw ||= setTimeout(paint, 200); } },
          oneose: () => { done = true; paint(); },
        });
        return { node, stop: () => { live = false; clearTimeout(draw); sub.close(); } };
      },
    };
    function show(name) {
      stopPanel?.();
      current = name;
      for (const [k, b] of Object.entries(tabs)) b.setAttribute('aria-pressed', String(k === name));
      const p = panels[name]();
      stopPanel = p.stop;
      panel.replaceChildren(p.node);
      updateAuthors(panel);
    }
    for (const k of ['notes', 'follows', 'followers']) {
      tabs[k] = el('button', { type: 'button', class: 'tab', 'aria-pressed': 'false' }, countLabel(`profile.tab.${k}`, null));
      tabs[k].addEventListener('click', () => show(k));
      tabbar.append(tabs[k]);
    }
    stops.push(() => stopPanel?.());
    show('notes');
  }

  return () => { alive = false; stops.forEach((s) => (typeof s === 'function' ? s() : s.close?.())); };
}
