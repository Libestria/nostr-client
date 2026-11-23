import { t } from '../i18n.js';
import { walletInfo, saveWallet, removeWallet, isUnlocked, lock, setMaxSats, DEFAULT_MAX_SATS } from '../wallet.js';
import { nwcErrMsg } from './zap.js';
import { el, shortNpub } from './common.js';

// Section Réglages : portefeuille Nostr Wallet Connect (paiement des zaps sans quitter le client).
export function walletSection() {
  const node = el('section', { class: 'wallet' });
  const msg = el('p', { class: 'status', role: 'status' });
  const draw = () => {
    const info = walletInfo();
    const kids = [el('h2', {}, t('nwc.title')), el('p', { class: 'hint' }, t('nwc.hint'))];
    if (info) {
      const limit = el('input', { type: 'number', min: 1, max: 1000000, value: String(info.maxSats), inputmode: 'numeric', 'aria-label': t('nwc.limit') });
      limit.addEventListener('change', () => { setMaxSats(Number(limit.value)); msg.textContent = t('settings.saved'); });
      const off = el('button', { type: 'button', class: 'btn' }, t('nwc.remove'));
      off.addEventListener('click', () => { removeWallet(); msg.textContent = t('nwc.removed'); draw(); });
      kids.push(el('p', {}, el('strong', {}, t('nwc.connected')), ` ${shortNpub(info.walletPubkey)} · ${info.relays[0].replace(/^wss:\/\//, '')}${info.lud16 ? ` · ${info.lud16}` : ''}`),
        el('p', { class: 'ident' }, isUnlocked() ? t('nwc.unlocked') : t('nwc.locked.state')),
        el('label', {}, t('nwc.limit'), limit));
      if (isUnlocked()) { const lk = el('button', { type: 'button', class: 'btn btn-small' }, t('nwc.lock')); lk.addEventListener('click', () => { lock(); draw(); }); kids.push(el('p', {}, lk)); }
      kids.push(el('p', {}, off));
    } else {
      const uri = el('input', { type: 'password', id: 'nwc-uri', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      const pw = el('input', { type: 'password', id: 'nwc-pw', autocomplete: 'new-password' });
      const limit = el('input', { type: 'number', min: 1, max: 1000000, value: String(DEFAULT_MAX_SATS), inputmode: 'numeric' });
      const go = el('button', { type: 'submit', class: 'btn' }, t('nwc.save'));
      const form = el('form', { class: 'form' }, el('label', { for: 'nwc-uri' }, t('nwc.uri')), uri, el('label', { for: 'nwc-pw' }, t('nwc.newpassword')), pw,
        el('label', {}, t('nwc.limit'), limit), go);
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); go.disabled = true; msg.textContent = '';
        try { await saveWallet(uri.value, pw.value, Number(limit.value)); uri.value = ''; pw.value = ''; msg.textContent = t('nwc.saved'); draw(); }
        catch (err) { msg.textContent = nwcErrMsg(err); go.disabled = false; }
      });
      kids.push(form);
    }
    node.replaceChildren(...kids, msg);
  };
  draw();
  return node;
}
