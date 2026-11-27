// Première configuration : création des listes de relais d'un compte qui n'en a pas publié.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { getSigner } from '../auth.js';
import { normalizeRelayUrl } from '../nostr/relayurl.js';
import { LIST_KEYS, MAX_LIST_RELAYS } from '../nostr/relaylists.js';
import { suggestedRelays, createLists, applyCreated, publishListEvent, loadAccountLists } from '../account.js';
import { el, pageTitle, publishKind } from './common.js';

const ERR = { NO_SIGNER: 'lists.err.signer', SIGN_FAILED: 'lists.err.sign', EMPTY: 'setup.err.empty' };
const short = (u) => u.replace(/^wss:\/\//, '');

export function renderSetup(main) {
  const title = pageTitle('setup.title');
  const lists = state.get('lists');
  if (!getSigner()) {
    const retry = el('button', { type: 'button', class: 'btn' }, t('lists.retry'));
    retry.addEventListener('click', () => { retry.disabled = true; loadAccountLists(state.get('session').pubkey); });
    main.replaceChildren(title, el('p', {}, t('setup.nosigner')), el('p', {}, el('a', { class: 'btn', href: '#/login' }, t('login.cta')), ' ', retry));
    return;
  }
  const keys = LIST_KEYS.filter((k) => !lists[k]); // seulement les listes qui n'existent pas encore
  const sel = {};   // key → Map(url → coché)
  const body = el('div');
  main.replaceChildren(title, el('p', {}, t('setup.intro')), body);

  suggestedRelays().then((sug) => {
    for (const key of keys) sel[key] = new Map((sug[key] ?? []).map((u) => [u, true]));
    form();
  });

  function form(error) {
    const sections = keys.map((key) => {
      const ul = el('ul', { class: 'relays' });
      const paint = () => ul.replaceChildren(...[...sel[key]].map(([url, on]) => {
        const box = el('input', { type: 'checkbox', id: `setup-${key}-${url}`, checked: on });
        box.addEventListener('change', () => sel[key].set(url, box.checked));
        return el('li', { class: 'relay' }, box, el('label', { for: `setup-${key}-${url}`, class: 'ident' }, short(url)));
      }));
      paint();
      const input = el('input', { type: 'text', id: `setup-add-${key}`, placeholder: 'wss://relais.exemple.com', inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
      const msg = el('p', { class: 'status', role: 'status' });
      const add = el('form', { class: 'add-relay' }, el('label', { for: `setup-add-${key}` }, t('lists.add.label')), input, el('button', { type: 'submit', class: 'btn' }, t('lists.add')));
      add.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = normalizeRelayUrl(input.value.trim());
        msg.className = 'status';
        if (!url) { msg.className = 'status status-error'; msg.textContent = t('lists.err.url'); return; }
        if (sel[key].has(url)) { msg.className = 'status status-error'; msg.textContent = t('lists.err.dup'); return; }
        if (sel[key].size >= MAX_LIST_RELAYS) { msg.className = 'status status-error'; msg.textContent = t('lists.err.max'); return; }
        sel[key].set(url, true); input.value = ''; msg.textContent = ''; paint();
      });
      return el('div', { class: 'relay-list' }, el('h3', { class: 'list-title' }, t(`lists.${key}`)), el('p', { class: 'hint' }, t(`setup.hint.${key}`)), ul, add, msg);
    });
    const next = el('button', { type: 'button', class: 'btn' }, t('setup.review'));
    const err = el('p', { class: 'status status-error', role: 'alert' }, error ? t(error) : '');
    next.addEventListener('click', () => {
      const chosen = chosenLists();
      if (!chosen.pub?.length) { err.textContent = t('setup.err.empty'); return; }
      confirm(chosen);
    });
    body.replaceChildren(...sections, err, el('p', {}, next));
  }

  const chosenLists = () => Object.fromEntries(keys.map((k) => [k, [...sel[k]].filter(([, on]) => on).map(([u]) => u)]).filter(([, v]) => v.length));

  function confirm(chosen) {
    const go = el('button', { type: 'button', class: 'btn' }, t('setup.publish'));
    const back = el('button', { type: 'button', class: 'btn' }, t('setup.back'));
    back.addEventListener('click', () => form());
    go.addEventListener('click', () => publish(chosen, go, back));
    body.replaceChildren(
      el('p', {}, t('setup.confirm')),
      ...Object.entries(chosen).map(([key, urls]) => el('div', { class: 'relay-list' }, el('h3', { class: 'list-title' }, t(`lists.${key}`)),
        el('ul', { class: 'relays' }, ...urls.map((u) => el('li', { class: 'relay' }, el('span', { class: 'ident' }, short(u))))))),
      el('p', {}, t('setup.confirm.hint')),
      el('p', {}, go, ' ', back));
  }

  async function publish(chosen, go, back) {
    go.disabled = back.disabled = true;
    const status = el('p', { class: 'status', role: 'status' }, t('lists.publishing'));
    body.append(status);
    let created;
    try {
      created = await createLists(chosen, { signer: getSigner(), onProgress: (p) => { status.textContent = t('lists.progress.pub', { done: p.done, total: p.total }); } });
    } catch (e) { form(ERR[e.message] ?? 'lists.err.generic'); return; }
    result(created);
  }

  function result(created) {
    const blocks = Object.entries(created).map(([key, res]) => {
      const holder = el('div');
      const paint = (r) => {
        res = r; created[key] = r;
        const failed = !r.ok;
        const nodes = [el('p', { class: `status status-${publishKind(r)}`, role: 'status' }, t(failed ? 'lists.publish.failed' : 'lists.published', { ok: r.ok, total: r.total })),
          el('details', {}, el('summary', {}, t('lists.details')), el('ul', { class: 'relays' }, ...r.results.map((x) => el('li', { class: 'relay' },
            el('span', { class: `dot dot-${x.ok ? 'open' : 'closed'}`, 'aria-hidden': 'true' }),
            el('div', { class: 'relay-body' }, el('span', { class: 'ident' }, short(x.url)),
              el('span', { class: 'relay-meta' }, x.ok ? t('lists.accepted') : `${t('lists.refused')}${x.message ? ` : ${x.message}` : ''}`))))))];
        if (failed) {
          const again = el('button', { type: 'button', class: 'btn' }, t('lists.retry'));
          again.addEventListener('click', async () => { again.disabled = true; paint(await publishListEvent(key, r.event, null)); refreshContinue(); });
          nodes.push(again);
        }
        holder.replaceChildren(...nodes);
      };
      paint(res);
      return el('div', { class: 'relay-list' }, el('h3', { class: 'list-title' }, t(`lists.${key}`)), holder);
    });
    const cont = el('button', { type: 'button', class: 'btn' }, t('setup.continue'));
    const refreshContinue = () => { cont.disabled = !(created.pub?.ok > 0); };
    refreshContinue();
    cont.addEventListener('click', () => applyCreated(created)); // l'état « prêt » réaffiche la page demandée
    body.replaceChildren(el('p', {}, t('setup.done')), ...blocks, el('p', {}, cont));
  }
}
