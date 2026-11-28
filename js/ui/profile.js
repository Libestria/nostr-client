import { t } from '../i18n.js';
import { state } from '../state.js';
import { pool } from '../relays/pool.js';
import { latest, getReplaceable, putEvent } from '../storage/db.js';
import { decode, npubEncode } from '../nostr/nip19.js';
import { resolveNip05 } from '../nostr/nip05.js';
import { tagUrls } from '../nostr/relaylists.js';
import { parseContacts, buildContactsTemplate } from '../nostr/contacts.js';
import { getCached, onProfiles, requestProfile } from '../profiles.js';
import { getSigner } from '../auth.js';
import { el, pageTitle, stateBlock, shortNpub, publishKind } from './common.js';
import { authorLink, noteCard, updateAuthors, nip05Line } from './note.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { openSheet } from './listwindow.js';
import { fitLine } from './fit.js';
import { qrSvg } from './qr.js';
import { profileEditor } from './profile-edit.js';
import { planFor } from '../relays/outbox.js';
import { zapPanel } from './zap.js';
import { muteList, editMute } from '../mute.js';
import { loadReplaceable } from '../replaceable.js';

const PAGE = 30;
const PEOPLE_PAGE = 50;
const HEX64 = /^[0-9a-f]{64}$/;

const FOLLOWERS_LIMIT = 200;      // demande par relais : au-delà, la liste est tronquée (affichage « N+ »)
const COUNT_CAP = 1000;           // « 1000+ » à partir de ce nombre

// Bouton « copier » d'une valeur : confirmation verte, ou erreur rouge
function copyButton(text, label) {
  const b = el('button', { type: 'button', class: 'p-icon', title: label, 'aria-label': label }, icon('copy', 16));
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); toast(t('profile.copied'), { kind: 'ok' }); } catch { toast(t('profile.copyFail'), { error: true }); }
  });
  return b;
}

// Fenêtre Liquid listant des comptes : source.get() → { pks, loading, note } ; source.on(fn) → arrêt. Tap sur un compte : ouvre son profil.
function openPeople({ title, opener, source, emptyKey }) {
  const body = el('div', { class: 'sheet-body' });
  let shown = PEOPLE_PAGE, off = () => {}, stopProfiles = () => {};
  const paint = () => {
    const { pks, loading, note } = source.get();
    if (!pks.length) { body.replaceChildren(loading ? stateBlock('loading', 'state.loading') : el('p', { class: 'sheet-note' }, t(emptyKey))); return; }
    const ul = el('ul', { class: 'sheet-people' }, ...pks.slice(0, shown).map((pk) => el('li', {}, authorLink(pk))));
    const kids = [...(note ? [el('p', { class: 'sheet-note' }, note)] : []), ul];
    if (shown < pks.length) {
      const more = el('button', { type: 'button', class: 'btn' }, t('people.more'));
      more.addEventListener('click', () => { shown += PEOPLE_PAGE; paint(); });
      kids.push(el('div', { class: 'sheet-more' }, more));
    }
    body.replaceChildren(...kids);
    updateAuthors(body);
  };
  const dlg = openSheet({ title, opener, body, cls: 'people-window', onClose: () => { off(); stopProfiles(); } });
  body.addEventListener('click', (e) => { if (e.target.closest('a')) dlg.close(); });
  off = source.on(paint);
  stopProfiles = onProfiles(() => { if (dlg.isConnected) updateAuthors(body); });
  paint();
}

// Fenêtre Liquid des relais publiés par le compte, avec l'état de connexion de chacun
function openRelays({ opener, urlsOf }) {
  const body = el('div', { class: 'sheet-body' });
  const paint = () => {
    const urls = urlsOf();
    if (!urls) { body.replaceChildren(stateBlock('loading', 'state.loading')); return; }
    if (!urls.length) { body.replaceChildren(el('p', { class: 'sheet-note' }, t('profile.noRelays'))); return; }
    const open = new Set(pool.status().filter((r) => r.state === 'open').map((r) => r.url));
    body.replaceChildren(el('ul', { class: 'sheet-people sheet-relays' }, ...urls.map((u) => el('li', {},
      el('span', { class: 'rl-url' }, u), el('span', { class: `rl-state${open.has(u) ? ' rl-on' : ''}` }, t(open.has(u) ? 'profile.relay.on' : 'profile.relay.off'))))));
  };
  const off = pool.onChange(paint);
  openSheet({ title: t('profile.relays.title'), opener, body, cls: 'people-window', onClose: off });
  paint();
}

// Fenêtre Liquid de l'adresse Lightning : QR code, adresse, copie
function openLightning(opener, address) {
  const slot = el('div', { class: 'nc-qr' });
  const copy = el('button', { type: 'button', class: 'btn' }, t('profile.ln.copy'));
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(address); toast(t('profile.copied'), { kind: 'ok' }); } catch { toast(t('profile.copyFail'), { error: true }); } });
  const body = el('div', { class: 'nc-body' }, slot, el('code', { class: 'nc-link' }, address), copy);
  openSheet({ title: t('profile.ln.title'), opener, body });
  qrSvg(`lightning:${address}`, t('profile.ln.qr')).then((svg) => slot.append(svg)).catch(() => {});   // sans bibliothèque : adresse seule
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
    const panel = el('div', { class: 'p-notes' });
    body.replaceChildren(head, actions, msg, panel);

    // ---- en-tête : bannière, avatar + nom, identifiants, barre de statistiques, bio
    let shown = undefined, followsMe = false;
    let theirs = null, followsDone = false, theirRelays = null, relaysDone = false;
    const followers = { found: new Map(), done: false, sub: null, listeners: new Set(), draw: null };
    const fc = { count: null, tried: false };

    const notifyFollowers = () => { followers.draw ||= setTimeout(() => { followers.draw = null; followers.listeners.forEach((fn) => fn()); paintStats(); }, 200); };
    const startFollowers = () => {
      if (followers.sub || !alive) return;
      followers.sub = pool.subscribe([{ kinds: [3], '#p': [pubkey], limit: FOLLOWERS_LIMIT }], {
        closeOnEose: true, maxEvents: 300,
        onevent: (ev) => { if (ev.kind === 3 && !followers.found.has(ev.pubkey) && parseContacts(ev).includes(pubkey)) { followers.found.set(ev.pubkey, ev); notifyFollowers(); } },
        oneose: () => { followers.done = true; notifyFollowers(); },
      });
      paintStats();
    };
    stops.push(() => { followers.sub?.close(); clearTimeout(followers.draw); });

    // Texte du compteur d'abonnés : « … » pendant le chargement, « 1000+ » à partir de 1000 (COUNT),
    // « N+ » quand la recherche sur les relais s'arrête avant la fin (liste tronquée)
    const followersText = () => {
      const seen = followers.found.size, c = fc.count ?? 0;
      if (c >= COUNT_CAP) return { n: COUNT_CAP, text: `${COUNT_CAP}+` };
      if (!fc.tried || (!c && !seen && !(followers.sub && followers.done))) return { n: 2, text: '…' };
      const n = Math.max(c, seen);
      return { n, text: `${n}${seen >= FOLLOWERS_LIMIT && seen >= c ? '+' : ''}` };
    };
    const statBtn = (cls) => el('button', { type: 'button', class: `p-stat ${cls}`, 'aria-haspopup': 'dialog' });
    const sFollows = statBtn('p-stat-follows'), sFollowers = statBtn('p-stat-followers'), sRelays = statBtn('p-stat-relays');
    const dot = () => el('span', { class: 'p-dot', 'aria-hidden': 'true' }, '\u2022');
    const stats = el('div', { class: 'p-stats' }, sFollows, dot(), sFollowers, dot(), sRelays);
    const relayUrls = () => (relaysDone || theirRelays ? (theirRelays ? tagUrls(theirRelays, 'pub') : []) : null);
    function paintStats() {
      const nf = theirs ? parseContacts(theirs).length : followsDone ? 0 : null;
      sFollows.textContent = t(nf != null && nf < 2 ? 'profile.stat.follows.one' : 'profile.stat.follows', { n: nf ?? '…' });
      const f = followersText();
      sFollowers.textContent = t(f.n < 2 ? 'profile.stat.followers.one' : 'profile.stat.followers', { n: f.text });
      const urls = relayUrls();
      if (urls && !urls.length) sRelays.textContent = t('profile.stat.relays.none');
      else {
        const open = new Set(pool.status().filter((r) => r.state === 'open').map((r) => r.url));
        sRelays.textContent = t('profile.stat.relays', { x: urls ? urls.filter((u) => open.has(u)).length : '…', y: urls ? urls.length : '…' });
      }
      layoutStats();
    }
    // Sur écran étroit les trois éléments passent à la ligne : on masque alors les puces « • » (une puce ne doit jamais finir une ligne)
    const layoutStats = () => {
      stats.classList.remove('wrapped');
      if (sRelays.offsetTop > sFollows.offsetTop + 4) stats.classList.add('wrapped');
    };
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => { if (!stats.isConnected) return; layoutStats(); }); ro.observe(stats); stops.push(() => ro.disconnect()); }
    sFollows.addEventListener('click', () => openPeople({ title: t('profile.tab.follows'), opener: sFollows, emptyKey: 'profile.noFollows',
      source: { get: () => ({ pks: theirs ? parseContacts(theirs) : [], loading: !followsDone && !theirs }), on: (fn) => { followsListeners.add(fn); return () => followsListeners.delete(fn); } } }));
    sFollowers.addEventListener('click', () => {
      startFollowers();
      openPeople({ title: t('profile.tab.followers'), opener: sFollowers, emptyKey: 'profile.noFollowers',
        source: {
          get: () => { const pks = [...followers.found.keys()]; return { pks, loading: !followers.done, note: pks.length ? t('profile.followers.note', { n: pks.length }) : null }; },
          on: (fn) => { followers.listeners.add(fn); return () => followers.listeners.delete(fn); },
        } });
    });
    sRelays.addEventListener('click', () => openRelays({ opener: sRelays, urlsOf: relayUrls }));
    const followsListeners = new Set();
    stops.push(pool.onChange(paintStats));

    // Une ligne « titre / valeur » ; la valeur tient sur une seule ligne (raccourcie au milieu si besoin), suivie d'icônes d'action
    const idRow = (titleKey, value, actions) => el('div', { class: 'p-row' }, el('dt', {}, t(titleKey)), el('dd', {}, value, ...actions));
    const keyRow = (titleKey, full, label) => {
      const v = el('span', { class: 'p-val ident' });
      const row = idRow(titleKey, v, [copyButton(full, label)]);
      queueMicrotask(() => fitLine(v, full));
      return row;
    };

    const paintHead = () => {
      const p = getCached(pubkey);
      const media = state.get('settings')?.loadMedia;
      const name = p?.displayName || p?.name || shortNpub(pubkey);
      const av = media && p?.picture
        ? el('img', { class: 'avatar avatar-lg', src: p.picture, alt: '', width: 72, height: 72, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
        : el('span', { class: 'avatar avatar-lg', 'aria-hidden': 'true' });
      av.addEventListener?.('error', () => av.remove());
      const over = media && p?.banner;
      const rows = [];
      if (p) {
        const n05 = typeof p.nip05 === 'string' ? p.nip05.trim() : '';
        rows.push(idRow('profile.id.nip05', nip05Line(pubkey), n05 ? [copyButton(n05.startsWith('_@') ? n05.slice(2) : n05, t('profile.copy.nip05'))] : []));
      }
      rows.push(keyRow('profile.id.npub', npub, t('profile.copy.npub')), keyRow('profile.id.hex', pubkey, t('profile.copy.hex')));
      if (p?.lud16) {
        const qr = el('button', { type: 'button', class: 'p-icon', title: t('profile.ln.title'), 'aria-label': t('profile.ln.title'), 'aria-haspopup': 'dialog' }, icon('qr', 16));
        qr.addEventListener('click', () => openLightning(qr, p.lud16));
        rows.push(idRow('profile.id.ln', el('span', { class: 'p-val ident' }, p.lud16), [copyButton(p.lud16, t('profile.copy.ln')), qr]));
      }
      head.replaceChildren(
        ...(over ? [el('img', { class: 'p-banner', src: p.banner, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })] : []),
        el('div', { class: `p-id${over ? ' p-id-over' : ''}` }, av, el('div', { class: 'p-who' }, el('h2', { class: 'p-name' }, name), followsMe ? el('p', { class: 'follows-you' }, t('profile.followsYou')) : null)),
        el('dl', { class: 'p-ids' }, ...rows),
        stats,
        p?.about ? el('p', { class: 'p-about' }, p.about) : null);
    };
    const onProfile = () => {
      const p = getCached(pubkey);
      if (p !== shown) { shown = p; paintHead(); }
      updateAuthors(panel);
    };
    stops.push(onProfiles(onProfile));
    requestProfile(pubkey, { force: true });
    onProfile(); paintHead(); paintStats();

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

    // ---- actions : suivre, zapper, masquer, modifier
    const say = (text, kind = false) => { msg.textContent = text; msg.classList.toggle('status-error', kind === true); msg.classList.toggle('status-ok', kind === 'ok'); msg.classList.toggle('status-warn', kind === 'warn'); };
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
        const hide = el('button', { type: 'button', class: 'btn' }, '');
        const paintHide = () => { hide.textContent = t(muteList().pubkeys.includes(pubkey) ? 'mute.unmute' : 'mute.account'); };
        paintHide();
        stops.push(state.on('mute', paintHide));
        hide.addEventListener('click', async () => {
          hide.disabled = true;
          try { const res = await editMute([{ type: muteList().pubkeys.includes(pubkey) ? 'remove' : 'add', kind: 'pubkey', value: pubkey }]); say(res.ok ? t('lists.published', { ok: res.ok, total: res.total }) : t('lists.publish.failed', { ok: res.ok, total: res.total }), ({ ok: 'ok', warn: 'warn', error: true })[publishKind(res)]); if (res.ok) setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 400); }
          catch { say(t('compose.err.generic'), true); }
          hide.disabled = false;
        });
        actions.append(hide);
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
          say(t('profile.follow.done', { ok, total: results.length }), 'ok');
        } catch { say(t('profile.follow.signFail'), true); }
        finally { busy = false; paintFollow(); }
      });
    } else if (!me) actions.append(el('a', { class: 'btn', href: '#/login' }, t('login.cta')));
    paintFollow();

    // ---- abonnements de ce compte (kind 3) et relais publiés (kind 10002)
    const theirSub = loadReplaceable(3, pubkey,
      (ev) => { theirs = ev; if (me && me !== pubkey) { const f = parseContacts(ev).includes(me); if (f !== followsMe) { followsMe = f; paintHead(); } } paintStats(); followsListeners.forEach((fn) => fn()); },
      () => { followsDone = true; paintStats(); followsListeners.forEach((fn) => fn()); });
    const relaySub = loadReplaceable(10002, pubkey, (ev) => { theirRelays = ev; paintStats(); }, () => { relaysDone = true; paintStats(); });
    stops.push(() => theirSub.close(), () => relaySub.close());

    // ---- nombre d'abonnés : COUNT (NIP-45) sur les relais qui le gèrent, sinon recherche de listes de contacts (repli)
    const waitRelays = () => new Promise((resolve) => {
      const ready = () => pool.status().some((r) => r.state === 'open' && r.read && r.scope === 'account');
      if (ready()) return resolve();
      const off = pool.onChange(() => { if (ready()) { off(); clearTimeout(tm); resolve(); } });
      const tm = setTimeout(() => { off(); resolve(); }, 4000);
    });
    (async () => {
      await waitRelays();
      let n = null;
      try { n = await pool.count([{ kinds: [3], '#p': [pubkey] }]); } catch { /* repli */ }
      if (!alive) return;
      fc.count = n; fc.tried = true;
      if (!n) startFollowers();    // pas de COUNT (ou 0 : peu fiable) : on cherche les listes elles-mêmes
      paintStats();
    })();

    // ---- panneaux
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
      }
    };
    const notes = panels.notes();
    panel.replaceChildren(notes.node);
    updateAuthors(panel);
    stops.push(() => notes.stop());
  }

  return () => { alive = false; stops.forEach((s) => (typeof s === 'function' ? s() : s.close?.())); };
}
