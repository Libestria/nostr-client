import { t } from '../i18n.js';
import { state } from '../state.js';
import { pool } from '../relays/pool.js';
import { latest, getReplaceable } from '../storage/db.js';
import { parseContacts } from '../nostr/contacts.js';
import { onProfiles } from '../profiles.js';
import { el, pageTitle, stateBlock } from './common.js';
import { noteCard, updateAuthors } from './note.js';
import { planFor } from '../relays/outbox.js';
import { chunkAuthors } from '../nostr/outbox.js';
import { composer } from './composer.js';
import { getSigner } from '../auth.js';

const PAGE = 30;
const MAX_SHOWN = 300;
const MAX_AUTHORS = 1000; // 10 filtres au maximum par abonnement

const tab = (href, key, active) => el('a', { class: 'tab', href, 'aria-current': active ? 'page' : false }, t(key));

// Accueil : fil des comptes suivis (si connecté) ou flux global. Chargements ponctuels, jamais de flux continu.
export function renderFeed(main, params = []) {
  const session = state.get('session');
  const following = !!session && params[0] !== 'global';

  const notes = new Map();
  const via = new Map();
  const subs = [];
  let alive = true, got = false, drawTimer = null;
  let oldest = Infinity;                 // mode global
  let groups = [], cursor = [], authorSet = null, planToken = 0; // mode abonnements : groupes (relais, auteurs), curseur par groupe
  let contacts = null, followCount = 0, contactsDone = false, contactsSub = null;

  const status = el('p', { class: 'status', role: 'status' });
  const holder = el('div');
  const list = el('div', { class: 'notes' });
  const reload = el('button', { type: 'button', class: 'btn' }, t('feed.refresh'));
  const more = el('button', { type: 'button', class: 'btn' }, t('feed.more'));
  more.hidden = true;
  const extra = [];
  if (!session) extra.push(el('p', {}, el('a', { class: 'btn', href: '#/login' }, t('login.cta'))));
  const compose = session && getSigner() ? el('section', { class: 'composer-box' }, composer({})) : null;
  main.replaceChildren(pageTitle('nav.feed'),
    session ? el('nav', { class: 'tabs', 'aria-label': t('feed.tabs') }, tab('#/feed', 'feed.following', following), tab('#/feed/global', 'feed.globalTab', !following))
      : el('p', {}, t('feed.global')),
    ...(compose ? [compose] : []), status, el('div', { class: 'row' }, reload), holder, list, more, ...extra);

  const setHolder = (kind, key) => holder.replaceChildren(...(kind ? [stateBlock(kind, key)] : []));
  const scheduleDraw = () => { drawTimer ||= setTimeout(draw, 150); };
  function draw() {
    drawTimer = null;
    if (!alive) return;
    const arr = [...notes.values()].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)).slice(0, MAX_SHOWN);
    list.replaceChildren(...arr.map((ev) => noteCard(ev, { via: via.get(ev.id) })));
  }

  function add(ev, relay) {
    if (!alive || ev.kind !== 1) return;
    if (following) {
      if (!authorSet?.has(ev.pubkey)) return;
      // le curseur de chaque groupe avance même pour un doublon reçu d'un autre relais
      if (relay) groups.forEach((g, i) => { if (g.url === relay && g.authors.has(ev.pubkey)) cursor[i] = cursor[i] == null ? ev.created_at : Math.min(cursor[i], ev.created_at); });
    }
    if (notes.has(ev.id)) return;
    if (!following) oldest = Math.min(oldest, ev.created_at);
    notes.set(ev.id, ev);
    if (relay) via.set(ev.id, relay);
    got = true;
    setHolder(null);
    more.hidden = false;
    scheduleDraw();
  }

  function fetchPage(first, only = null) {
    reload.disabled = more.disabled = true;
    const done = () => {
      if (!got) setHolder('empty', following ? 'feed.followingEmpty' : 'feed.empty');
      reload.disabled = more.disabled = false;
    };
    if (!following) {
      subs.push(pool.subscribe([{ kinds: [1], limit: PAGE, ...(first || !Number.isFinite(oldest) ? {} : { until: oldest - 1 }) }], { closeOnEose: true, onevent: add, oneose: done }));
      return;
    }
    // modèle outbox : chaque relais n'interroge que les comptes qui y publient
    const byRelay = new Map();
    groups.forEach((g, i) => {
      if (only && !only.includes(i)) return;
      const f = { kinds: [1], authors: [...g.authors], limit: PAGE, ...(!first && cursor[i] != null ? { until: cursor[i] - 1 } : {}) };
      if (!byRelay.has(g.url)) byRelay.set(g.url, []);
      byRelay.get(g.url).push(f);
    });
    if (!byRelay.size) { reload.disabled = more.disabled = false; return; }
    subs.push(pool.subscribe([{ kinds: [1] }], { closeOnEose: true, relayFilters: byRelay, onevent: add, oneose: done }));
  }

  more.addEventListener('click', () => fetchPage(false));
  reload.addEventListener('click', () => fetchPage(true));

  const refreshStatus = () => {
    const st = pool.status();
    const acc = st.filter((r) => r.read && r.scope === 'account');
    const base = t('feed.relays', { open: acc.filter((r) => r.state === 'open').length, total: acc.length });
    status.textContent = following && contactsDone ? `${base} · ${t('feed.follows', { n: followCount })}` : base;
  };
  const stopPool = pool.onChange(refreshStatus);
  const stopPublished = state.on('published', (ev) => { if (ev?.kind === 1 && ev.pubkey === session?.pubkey) { add(ev); more.hidden = false; } });
  const stopProfiles = onProfiles(() => updateAuthors(list));
  refreshStatus();

  // --- démarrage
  if (!following) {
    setHolder('loading', 'state.loading');
    latest({ kinds: [1], limit: PAGE }).then((evs) => evs.forEach((ev) => add(ev)));
    fetchPage(true);
  } else {
    setHolder('loading', 'state.loading');
    const me = session.pubkey;
    const apply = (ev) => {
      if (!alive || ev.kind !== 3 || ev.pubkey !== me || (contacts && ev.created_at <= contacts.created_at)) return;
      const follows = parseContacts(ev);
      const authors = [...new Set([...follows, me])].slice(0, MAX_AUTHORS);
      const same = contacts && contacts.key === authors.join();
      contacts = { created_at: ev.created_at, key: authors.join() };
      followCount = follows.length;
      contactsDone = true;
      refreshStatus();
      if (same) return;
      subs.splice(0).forEach((s) => s.close());
      groups = []; cursor = [];
      authorSet = new Set(authors);
      latest({ kinds: [1], limit: 300 }).then((evs) => evs.filter((e) => authorSet.has(e.pubkey)).slice(0, PAGE).forEach((e) => add(e)));
      const mine = pool.status().filter((r) => r.read && r.scope === 'account').map((r) => r.url);
      // 1) affichage immédiat : tes relais de lecture pour tous les comptes suivis (comme avant)
      for (const url of mine) chunkAuthors(authors).forEach((c) => groups.push({ url, authors: new Set(c) }));
      cursor = groups.map(() => null);
      fetchPage(true);
      // 2) puis, sans bloquer, les relais d'écriture des comptes suivis (modèle outbox)
      const my = ++planToken;
      planFor(authors, { mine }).then((plan) => {
        if (!alive || my !== planToken) return;
        const added = [];
        for (const [url, pks] of plan.byRelay) {
          if (mine.includes(url)) continue;   // déjà interrogé pour tous les comptes
          chunkAuthors(pks).forEach((c) => { groups.push({ url, authors: new Set(c) }); cursor.push(null); added.push(groups.length - 1); });
        }
        if (added.length) fetchPage(true, added);
      }).catch(() => {});
    };
    getReplaceable(3, me).then((ev) => ev && apply(ev));
    contactsSub = pool.subscribe([{ kinds: [3], authors: [me], limit: 1 }], {
      closeOnEose: true, onevent: apply,
      oneose: () => {
        if (contacts) return;
        // Aucune liste trouvée : on affiche au moins ses propres notes
        apply({ kind: 3, pubkey: me, created_at: 1, tags: [] });
        setHolder('empty', 'feed.noFollows');
      },
    });
  }

  const noRelays = setTimeout(() => {
    if (!got && pool.status().every((r) => r.state !== 'open')) setHolder('error', 'feed.noRelays');
  }, 10000);

  return () => {
    alive = false;
    stopPool(); stopPublished(); stopProfiles(); clearTimeout(noRelays); clearTimeout(drawTimer);
    subs.forEach((s) => s.close());
    contactsSub?.close();
  };
}

export function placeholder(titleKey) {
  return (main) => main.replaceChildren(pageTitle(titleKey), stateBlock('empty', 'state.soon'));
}
