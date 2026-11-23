import { t } from '../i18n.js';
import { state } from '../state.js';
import { pool } from '../relays/pool.js';
import { npubEncode } from '../nostr/nip19.js';
import { noteHref } from '../nostr/content.js';
import { parseQuery } from '../nostr/search.js';
import { resolveNip05 } from '../nostr/nip05.js';
import { parseProfile } from '../nostr/profile.js';
import { searchRelays } from '../relays/search.js';
import { acceptProfileEvent, requestProfile } from '../profiles.js';
import { putEvent } from '../storage/db.js';
import { el, pageTitle, stateBlock, shortNpub } from './common.js';
import { noteCard, updateAuthors } from './note.js';
import { onProfiles } from '../profiles.js';

// #/search (formulaire) ou #/search/<saisie> : npub, nprofile, note, nevent, adresse NIP-05 ou texte (NIP-50).
export function renderSearch(main, params = []) {
  const query = params.join('/');
  const input = el('input', { type: 'search', id: 'q', value: query, maxlength: 200, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const form = el('form', { class: 'add-relay', role: 'search' }, el('label', { for: 'q' }, t('search.label')), input, el('button', { type: 'submit', class: 'btn' }, t('search.go')));
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); location.hash = v ? `#/search/${encodeURIComponent(v)}` : '#/search'; });
  const out = el('div', { class: 'search-results', 'aria-live': 'polite' });
  main.replaceChildren(pageTitle('nav.search'), form, out);
  if (!query) { out.replaceChildren(el('p', { class: 'hint' }, t('search.hint'))); return; }

  let alive = true;
  const stops = [];
  const q = parseQuery(query);
  const go = (hash) => { if (alive) location.replace(hash); };
  (async () => {
    if (q.type === 'profile') return go(`#/profile/${npubEncode(q.pubkey)}`);
    if (q.type === 'note') return go(noteHref(q.id));
    if (q.type === 'nip05') {
      out.replaceChildren(stateBlock('loading', 'state.loading'));
      try { return go(`#/profile/${npubEncode((await resolveNip05(q.identifier)).pubkey)}`); }
      catch { if (alive) out.replaceChildren(stateBlock('error', 'search.nip05.fail')); return; }
    }
    if (q.type !== 'text') return;
    const relays = (state.get('lists')?.search?.relays ?? []).filter((r) => r.read !== false).map((r) => r.url);
    if (!relays.length) { out.replaceChildren(stateBlock('empty', 'search.norelay')); return; }
    out.replaceChildren(stateBlock('loading', 'search.loading'));
    const { events, responded, total } = await searchRelays(relays, [{ kinds: [1], search: q.text, limit: 40 }, { kinds: [0], search: q.text, limit: 20 }], { sign: (tpl) => pool.signer?.(tpl) });
    if (!alive) return;
    events.forEach((e) => putEvent(e));
    const notes = events.filter((e) => e.kind === 1).sort((a, b) => b.created_at - a.created_at);
    const profiles = events.filter((e) => e.kind === 0).map((e) => ({ e, p: parseProfile(e) })).filter((x) => x.p);
    profiles.forEach((x) => acceptProfileEvent(x.e));
    notes.forEach((n) => requestProfile(n.pubkey));
    const status = el('p', { class: 'status', role: 'status' }, t('search.status', { ok: responded, total, n: notes.length + profiles.length }));
    const sections = [status];
    if (profiles.length) sections.push(el('h2', {}, t('search.profiles')), el('ul', { class: 'dm-list' }, ...profiles.map(({ e, p }) => el('li', { class: 'card dm-item' },
      el('a', { href: `#/profile/${npubEncode(e.pubkey)}` }, el('strong', {}, p.displayName || p.name || shortNpub(e.pubkey)), p.nip05 ? el('span', { class: 'ident' }, ` ${p.nip05}`) : null),
      p.about ? el('p', {}, p.about.length > 140 ? `${p.about.slice(0, 140)}…` : p.about) : null))));
    if (notes.length) sections.push(el('h2', {}, t('search.notes')), el('div', { class: 'notes' }, ...notes.map((n) => noteCard(n))));
    if (!notes.length && !profiles.length) sections.push(stateBlock('empty', 'search.empty'));
    out.replaceChildren(...sections);
    updateAuthors(out);
    stops.push(onProfiles(() => updateAuthors(out)));
  })();
  return () => { alive = false; stops.forEach((s) => s()); };
}
