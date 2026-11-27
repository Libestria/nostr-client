import { t } from '../i18n.js';
import { getCached, requestProfile, onProfiles } from '../profiles.js';
import { lnurlInfo, createInvoice, hasWebln, payWebln, refreshZaps, watchZaps } from '../zap.js';
import { formatSats, MAX_SATS } from '../nostr/nip57.js';
import { walletInfo, isUnlocked, unlock, payWithWallet } from '../wallet.js';
import { el, closeButton } from './common.js';

const PRESETS = [21, 100, 500, 1000, 5000];
const BOLT11 = /^ln(?:bc|tbs|tb|bcrt)[0-9a-z]+$/i;

export const nwcErrMsg = (e) => {
  const code = e?.code;
  const known = ['INVALID_URI', 'NO_RELAY', 'NO_SECRET', 'WEAK_PASSWORD', 'BAD_PASSWORD', 'LOCKED', 'AMOUNT_LIMIT', 'NWC_ENCRYPTION', 'NWC_UNSUPPORTED', 'NWC_TIMEOUT', 'NWC_RELAY', 'NWC_REFUSED', 'NWC_ERROR', 'NO_WALLET'];
  const base = t(`nwc.error.${known.includes(code) ? code : 'GENERIC'}`, { n: e?.detail ?? '' });
  return code === 'NWC_REFUSED' && e.detail ? `${base} (${e.detail})` : base;
};

const errMsg = (e) => {
  const code = e?.code ?? e?.message;
  const known = ['NO_LNURL', 'LNURL_INVALID', 'LNURL_UNREACHABLE', 'NO_NOSTR', 'AMOUNT_RANGE', 'COMMENT_TOO_LONG', 'INVOICE_INVALID', 'INVOICE_AMOUNT', 'PROVIDER_ERROR', 'NO_SIGNER', 'SIGN_FAILED', 'NO_WEBLN', 'PAY_FAILED'];
  const base = t(`zap.error.${known.includes(code) ? code : 'GENERIC'}`);
  return e?.reason ? `${base} (${e.reason})` : base;
};

// Petit compteur de zaps affiché sur une note (⚡ total), mis à jour quand les reçus arrivent.
export function zapBadge(event) {
  const b = el('span', { class: 'zap-total', hidden: true });
  watchZaps(event, ({ sats, count }) => {
    b.hidden = !count;
    b.textContent = count ? `⚡ ${formatSats(sats)}` : '';
    b.title = t('zap.count', { n: count });
  });
  return b;
}

// Panneau de zap pour un profil (et éventuellement une note).
export function zapPanel({ recipient, event, onClose }) {
  requestProfile(recipient);
  const box = el('form', { class: 'zap-panel', 'aria-label': t('zap.title') });
  const status = el('p', { class: 'compose-result', role: 'status' });
  let info = null, amount = 21, busy = false, lud16 = null;
  const amountInput = el('input', { type: 'number', min: 1, max: MAX_SATS, step: 1, value: '21', inputmode: 'numeric', id: `zap-amt-${Math.random().toString(36).slice(2, 7)}` });
  const comment = el('input', { type: 'text', maxlength: 200, autocomplete: 'off', 'aria-label': t('zap.comment') });
  const chips = PRESETS.map((n) => {
    const b = el('button', { type: 'button', class: 'btn btn-small' }, formatSats(n));
    b.addEventListener('click', () => { amountInput.value = String(n); amount = n; });
    return b;
  });
  const send = el('button', { type: 'submit', class: 'btn' }, t('zap.send'));
  const invoiceBox = el('div', { class: 'zap-invoice' });
  amountInput.addEventListener('input', () => { amount = Number(amountInput.value); });
  const dismiss = () => { stop(); box.remove(); onClose?.(); };
  const cancel = el('button', { type: 'button', class: 'btn btn-small' }, t('zap.cancel'));
  cancel.addEventListener('click', dismiss);
  const xBtn = closeButton(t('zap.close'), { cls: 'zap-x', title: t('zap.close') });
  xBtn.addEventListener('click', dismiss);

  const load = async () => {
    lud16 = getCached(recipient)?.lud16;
    if (!lud16) { status.textContent = t('zap.error.NO_LNURL'); send.disabled = true; return; }
    status.textContent = t('zap.checking');
    try {
      info = await lnurlInfo(lud16);
      status.textContent = '';
      amountInput.min = Math.ceil(info.min / 1000); amountInput.max = Math.min(MAX_SATS, Math.floor(info.max / 1000));
      comment.hidden = !info.commentAllowed;
      comment.maxLength = info.commentAllowed || 0;
      send.disabled = false;
    } catch (e) { status.textContent = errMsg(e); send.disabled = true; }
  };
  const stop = onProfiles(() => { if (!info && getCached(recipient)?.lud16 && !busy) load(); });
  send.disabled = true;
  setTimeout(load, 300);

  const showInvoice = (pr) => {
    const nodes = [];
    if (BOLT11.test(pr)) {
      const open = el('a', { class: 'btn', href: `lightning:${pr}` }, t('zap.openwallet'));
      const copy = el('button', { type: 'button', class: 'btn btn-small' }, t('zap.copy'));
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pr); copy.textContent = t('zap.copied'); } catch { /* indisponible */ } });
      nodes.push(el('p', {}, t('zap.pay.manual')), el('p', {}, open, ' ', copy), el('code', { class: 'zap-pr' }, pr));
    }
    invoiceBox.replaceChildren(...nodes);
  };

  // Paiement par le portefeuille NWC ; déverrouillage par mot de passe si nécessaire. La facture reste affichée en cas d'échec.
  const payNwc = async (pr, sats) => {
    if (!isUnlocked()) {
      const pw = el('input', { type: 'password', autocomplete: 'current-password', 'aria-label': t('nwc.password') });
      const go = el('button', { type: 'button', class: 'btn' }, t('nwc.unlockpay'));
      const row = el('div', { class: 'zap-unlock' }, el('label', {}, t('nwc.password'), pw), go);
      invoiceBox.replaceChildren(row);
      status.textContent = t('nwc.locked');
      go.addEventListener('click', async () => {
        go.disabled = true;
        try { await unlock(pw.value); pw.value = ''; row.remove(); await payNwc(pr, sats); }
        catch (err) { status.textContent = nwcErrMsg(err); go.disabled = false; }
      });
      return;
    }
    status.textContent = t('nwc.paying');
    try {
      await payWithWallet(pr, sats);
      status.textContent = t('zap.paid', { n: formatSats(sats) });
      invoiceBox.replaceChildren();
      if (event) refreshZaps(event.id);
    } catch (err) { status.textContent = nwcErrMsg(err); showInvoice(pr); }
  };

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !info) return;
    if (!Number.isInteger(amount) || amount < 1) { status.textContent = t('zap.error.AMOUNT_RANGE'); return; }
    busy = true; send.disabled = true; invoiceBox.replaceChildren(); status.textContent = t('zap.invoice');
    try {
      const { pr } = await createInvoice({ recipient, lud16, event, amountSats: amount, comment: comment.value });
      if (walletInfo()) { await payNwc(pr, amount); busy = false; send.disabled = false; return; }
      if (hasWebln()) {
        status.textContent = t('zap.paying');
        try { await payWebln(pr); status.textContent = t('zap.paid', { n: formatSats(amount) }); if (event) refreshZaps(event.id); busy = false; send.disabled = false; return; }
        catch { status.textContent = t('zap.error.PAY_FAILED'); }
      } else status.textContent = t('zap.ready');
      showInvoice(pr);
      if (event) refreshZaps(event.id);
    } catch (err) { status.textContent = errMsg(err); }
    busy = false; send.disabled = false;
  });

  box.append(el('div', { class: 'zap-head' }, el('h3', {}, t('zap.title')), xBtn), el('div', { class: 'zap-chips' }, ...chips),
    el('label', {}, t('zap.amount'), amountInput), el('label', {}, t('zap.comment'), comment),
    el('div', {}, send, ' ', cancel), status, invoiceBox);
  return box;
}
