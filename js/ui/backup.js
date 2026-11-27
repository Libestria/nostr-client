import { t } from '../i18n.js';
import { state } from '../state.js';
import { getSigner } from '../auth.js';
import { updateSettings } from '../storage/settings.js';
import { editList } from '../account.js';
import { editMute, muteList } from '../mute.js';
import { buildBackup, parseBackup, importPlan, MAX_BACKUP_BYTES } from '../nostr/backup.js';
import { el } from './common.js';

// Section Réglages : export / import JSON (réglages locaux, relais, sourdine).
export function backupSection() {
  const msg = el('p', { class: 'status', role: 'status' });
  const say = (text, kind = '') => { msg.className = kind ? `status status-${kind}` : 'status'; msg.textContent = text; };
  const exp = el('button', { type: 'button', class: 'btn' }, t('backup.export'));
  exp.addEventListener('click', () => {
    const data = buildBackup({ settings: state.get('settings'), lists: state.get('lists'), mute: muteList() });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `nostr-client-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    say(t('backup.exported'), 'ok');
  });
  const file = el('input', { type: 'file', accept: 'application/json,.json', id: 'backup-file' });
  const preview = el('div', {});
  file.addEventListener('change', async () => {
    preview.replaceChildren(); msg.textContent = '';
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > MAX_BACKUP_BYTES) { say(t('backup.error.TOO_BIG'), 'error'); return; }
    let parsed;
    try { parsed = parseBackup(await f.text()); } catch (e) { say(t(`backup.error.${['TOO_BIG', 'PRIVATE_KEY', 'WRONG_APP'].includes(e.code) ? e.code : 'INVALID'}`), 'error'); return; }
    const plan = importPlan(parsed, { lists: state.get('lists'), mute: muteList() });
    const canSign = !!getSigner();
    const apply = el('button', { type: 'button', class: 'btn' }, t('backup.apply'));
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      const log = [];
      if (Object.keys(plan.settings).length) { state.set('settings', updateSettings(plan.settings)); log.push(t('backup.done.settings')); }
      if (canSign) {
        let ok = 0, fail = 0;
        for (const { key, op } of plan.relayOps) {
          say(t('lists.publishing'));
          try { const r = await editList(key, op, { signer: getSigner() }); r.ok ? ok++ : fail++; } catch { fail++; }
        }
        if (plan.relayOps.length) log.push(t('backup.done.relays', { ok, fail }));
        if (plan.muteOps.length) { try { const r = await editMute(plan.muteOps); log.push(t(r.ok ? 'backup.done.mute' : 'backup.done.mutefail', { n: plan.muteOps.length })); } catch { log.push(t('backup.done.mutefail', { n: plan.muteOps.length })); } }
      }
      msg.textContent = log.join(' ');
      preview.replaceChildren();
    });
    preview.replaceChildren(el('p', {}, t('backup.preview', { relays: plan.relayOps.length, mute: plan.muteOps.length, skipped: parsed.skipped })),
      ...(canSign ? [] : [el('p', { class: 'status warn' }, t('backup.nosigner'))]), apply);
  });
  return el('section', { class: 'backup' }, el('h2', {}, t('backup.title')), el('p', { class: 'hint' }, t('backup.hint')),
    el('p', {}, exp), el('label', { for: 'backup-file' }, t('backup.import')), file, preview, msg);
}
