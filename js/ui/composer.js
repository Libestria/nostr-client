// Composeur de notes / réponses, et affichage du résultat de publication par relais.
import { t } from '../i18n.js';
import { getSigner } from '../auth.js';
import { buildNote, MAX_NOTE_CHARS } from '../nostr/compose.js';
import { publishEvent, republishEvent } from '../publish.js';
import { el, publishKind } from './common.js';

const ERR = { EMPTY: 'compose.err.empty', TOO_LONG: 'compose.err.long', PRIVATE_KEY: 'compose.err.private',
  NO_SIGNER: 'lists.err.signer', SIGN_FAILED: 'lists.err.sign', NOT_OWN: 'compose.err.notown' };
export const errorKey = (e) => ERR[e?.message] ?? 'compose.err.generic';

const draftKey = (id) => `nostr-client:draft:${id}`;
const loadDraft = (id) => { try { return localStorage.getItem(draftKey(id)) ?? ''; } catch { return ''; } };
const saveDraft = (id, v) => { try { v ? localStorage.setItem(draftKey(id), v) : localStorage.removeItem(draftKey(id)); } catch { /* indisponible */ } };

// Remplit `box` avec le résultat d'une publication ; `retry()` est proposé quand aucun relais n'a accepté.
export function showResult(box, res, retry) {
  if (res.queued) { box.replaceChildren(el('span', { class: 'status' }, t('compose.queued'))); return; }
  const failed = !res.ok;
  const nodes = [el('span', { class: `status status-${publishKind(res)}` },
    res.total === 0 ? t('compose.norelay') : t(failed ? 'lists.publish.failed' : 'lists.published', { ok: res.ok, total: res.total }))];
  if (res.total) {
    nodes.push(el('details', {}, el('summary', {}, t('lists.details')), el('ul', { class: 'relays' }, ...res.results.map((x) => el('li', { class: 'relay' },
      el('span', { class: `dot dot-${x.ok ? 'open' : 'closed'}`, 'aria-hidden': 'true' }),
      el('div', { class: 'relay-body' }, el('span', { class: 'ident' }, x.url.replace(/^wss:\/\//, '')),
        el('span', { class: 'relay-meta' }, x.ok ? t('lists.accepted') : `${t('lists.refused')}${x.message ? ` : ${x.message}` : ''}`)))))));
  }
  if (failed && retry) {
    const again = el('button', { type: 'button', class: 'btn' }, t('lists.retry'));
    again.addEventListener('click', async () => { again.disabled = true; showResult(box, await retry(), retry); });
    nodes.push(again);
  }
  box.replaceChildren(...nodes);
}

// reply : événement parent (ou null pour une nouvelle note) ; onPublished(res) après succès.
export function composer({ reply = null, onPublished } = {}) {
  const id = reply ? `reply-${reply.id}` : 'new';
  const area = el('textarea', { id: `compose-${id}`, name: 'text', rows: reply ? 3 : 4, maxlength: MAX_NOTE_CHARS, autocomplete: 'off',
    placeholder: t(reply ? 'compose.reply.placeholder' : 'compose.placeholder') });
  area.value = loadDraft(id);
  area.addEventListener('input', () => saveDraft(id, area.value));
  const send = el('button', { type: 'submit', class: 'btn' }, t(reply ? 'compose.reply.send' : 'compose.send'));
  const out = el('div', { class: 'compose-result', role: 'status' });
  const count = el('span', { class: 'compose-count', 'aria-hidden': 'true' });
  const paintCount = () => { count.textContent = `${[...area.value].length} / ${MAX_NOTE_CHARS}`; };
  area.addEventListener('input', paintCount); paintCount();
  const form = el('form', { class: 'composer', id: `composer-form-${id}` },
    el('label', { for: area.id, class: 'sr-only' }, t(reply ? 'compose.reply.label' : 'compose.label')), area, el('div', { class: 'row' }, send, count), out);
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !getSigner()) return;
    let tpl;
    try { tpl = buildNote(area.value, { reply }); } catch (err) { showError(err); return; }
    busy = true; send.disabled = true; out.replaceChildren(t('lists.publishing'));
    try {
      const res = await publishEvent(tpl);
      showResult(out, res, () => republishEvent(res.event));
      if (res.ok || res.queued) { area.value = ''; saveDraft(id, ''); paintCount(); if (res.ok) onPublished?.(res); }
    } catch (err) { showError(err); } finally { busy = false; send.disabled = false; }
  });
  function showError(err) { out.replaceChildren(el('span', { class: 'status status-error' }, t(errorKey(err)))); }
  return form;
}
