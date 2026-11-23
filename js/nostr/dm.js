// Messages privés NIP-17 : message (kind 14) → sceau (kind 13, signé par l'utilisateur) → enveloppe cadeau (kind 1059,
// signée par une clé jetable). Module sans DOM ni réseau : le chiffrement NIP-44 de l'utilisateur passe par son signeur
// (la clé privée n'est jamais ici) ; seule la clé jetable de l'enveloppe est manipulée localement.
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_CONTENT = 20000;
const MAX_TAGS = 100;
const TWO_DAYS = 2 * 86400;

export class DmError extends Error {
  constructor(code) { super(code); this.code = code; }
  // unsupported | signer | seal | spoofed | invalid | kind | not-for-me
}

// Adapte la bibliothèque nostr-tools (les noms varient un peu selon les versions).
export function cryptoFromLib(lib) {
  const n = lib?.nip44;
  const getKey = n?.getConversationKey ?? n?.v2?.utils?.getConversationKey;
  const enc = n?.encrypt ?? n?.v2?.encrypt;
  const dec = n?.decrypt ?? n?.v2?.decrypt;
  const needed = [getKey, enc, dec, lib?.finalizeEvent, lib?.generateSecretKey, lib?.getPublicKey, lib?.getEventHash, lib?.verifyEvent];
  if (!needed.every((f) => typeof f === 'function')) throw new DmError('unsupported');
  return {
    generateSecretKey: lib.generateSecretKey, getPublicKey: lib.getPublicKey, finalizeEvent: lib.finalizeEvent,
    getEventHash: lib.getEventHash, verifyEvent: lib.verifyEvent,
    encryptWith: (sk, pk, text) => enc(text, getKey(sk, pk)),
  };
}

const randomPast = (now) => {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return now - (a[0] % TWO_DAYS);
};

// recipients : pubkeys hex (sans l'expéditeur). Erreurs : invalid
export function buildRumor({ content, pubkey, recipients, replyTo, subject }, crypto, now = Math.floor(Date.now() / 1000)) {
  const text = String(content ?? '').trim();
  const rcpts = [...new Set(recipients ?? [])].filter((p) => HEX64.test(p ?? ''));
  if (!text || text.length > MAX_CONTENT || !rcpts.length || !HEX64.test(pubkey ?? '')) throw new DmError('invalid');
  const tags = rcpts.map((p) => ['p', p]);
  if (HEX64.test(replyTo ?? '')) tags.push(['e', replyTo, '', 'reply']);
  if (subject) tags.push(['subject', String(subject).slice(0, 200)]);
  const rumor = { kind: 14, pubkey, created_at: now, tags, content: text };
  rumor.id = crypto.getEventHash(rumor);
  return rumor;
}

// Enveloppe pour un destinataire : sceau signé par le signeur de l'utilisateur, enveloppe signée par une clé jetable.
export async function wrapFor(rumor, recipientPubkey, signer, crypto, now = Math.floor(Date.now() / 1000)) {
  if (!signer?.nip44) throw new DmError('signer');
  let sealContent;
  try { sealContent = await signer.nip44.encrypt(recipientPubkey, JSON.stringify(rumor)); } catch { throw new DmError('signer'); }
  let seal;
  try { seal = await signer.signEvent({ kind: 13, created_at: randomPast(now), tags: [], content: sealContent }); } catch { throw new DmError('signer'); }
  const sk = crypto.generateSecretKey();
  const content = crypto.encryptWith(sk, recipientPubkey, JSON.stringify(seal));
  return crypto.finalizeEvent({ kind: 1059, created_at: randomPast(now), tags: [['p', recipientPubkey]], content }, sk);
}

const parse = (text) => { try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
const isTags = (t) => Array.isArray(t) && t.length <= MAX_TAGS && t.every((x) => Array.isArray(x) && x.every((s) => typeof s === 'string'));

// Ouvre une enveloppe reçue. Rejette : sceau mal signé, expéditeur du message ≠ signataire du sceau (usurpation),
// type inattendu, message qui ne me concerne pas. → { rumor (avec id recalculé), participants, conv }
export async function unwrap(wrap, me, signer, crypto) {
  if (wrap?.kind !== 1059 || !HEX64.test(wrap.pubkey ?? '') || typeof wrap.content !== 'string') throw new DmError('kind');
  if (!signer?.nip44) throw new DmError('signer');
  let sealJson;
  try { sealJson = await signer.nip44.decrypt(wrap.pubkey, wrap.content); } catch (e) { const err = new DmError('signer'); err.cause = e; throw err; }
  const seal = parse(sealJson);
  if (!seal || seal.kind !== 13 || !HEX64.test(seal.pubkey ?? '') || typeof seal.content !== 'string' || !crypto.verifyEvent(seal)) throw new DmError('seal');
  let rumorJson;
  try { rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content); } catch (e) { const err = new DmError('signer'); err.cause = e; throw err; }
  const rumor = parse(rumorJson);
  if (!rumor || rumor.kind !== 14 || typeof rumor.content !== 'string' || rumor.content.length > MAX_CONTENT || !isTags(rumor.tags)
    || !Number.isInteger(rumor.created_at)) throw new DmError('invalid');
  if (rumor.pubkey !== seal.pubkey) throw new DmError('spoofed');
  const clean = { kind: 14, pubkey: rumor.pubkey, created_at: rumor.created_at, tags: rumor.tags, content: rumor.content };
  clean.id = crypto.getEventHash(clean);
  const participants = participantsOf(clean);
  if (!participants.includes(me)) throw new DmError('not-for-me');
  return { rumor: clean, participants, conv: convId(participants) };
}

export function participantsOf(rumor) {
  const set = new Set([rumor.pubkey]);
  for (const t of rumor.tags) if (t[0] === 'p' && HEX64.test(t[1] ?? '')) set.add(t[1]);
  return [...set].sort();
}
export const convId = (participants) => [...participants].sort().join(',');

// Enregistrement stocké localement
export function toRecord(opened, me, wrapId) {
  const { rumor, participants, conv } = opened;
  const subject = rumor.tags.find((t) => t[0] === 'subject')?.[1];
  const replyTo = rumor.tags.find((t) => t[0] === 'e' && HEX64.test(t[1] ?? ''))?.[1];
  return { id: rumor.id, conv, participants, from: rumor.pubkey, mine: rumor.pubkey === me, created_at: rumor.created_at,
    content: rumor.content, ...(subject ? { subject: subject.slice(0, 200) } : {}), ...(replyTo ? { replyTo } : {}), wrapId, me };
}

// Interlocuteurs d'une conversation (sans soi-même ; soi-même si on s'écrit à soi)
export function partnersOf(participants, me) {
  const others = participants.filter((p) => p !== me);
  return others.length ? others : [me];
}

// ---- Anciens messages NIP-04 (kind 4) : lecture seule
// Regroupe des événements kind 4 par interlocuteur. Ne déchiffre rien. → Map(partner → [{ id, mine, created_at, content }])
export function legacyGroup(events, me) {
  const out = new Map();
  const seen = new Set();
  for (const ev of events ?? []) {
    if (ev?.kind !== 4 || typeof ev.content !== 'string' || !Array.isArray(ev.tags) || seen.has(ev.id)) continue;
    const to = ev.tags.find((t) => t[0] === 'p' && HEX64.test(t[1] ?? ''))?.[1];
    if (!to) continue;
    const mine = ev.pubkey === me;
    const partner = mine ? to : ev.pubkey;
    if (!mine && to !== me) continue;            // ne me concerne pas
    seen.add(ev.id);
    if (!out.has(partner)) out.set(partner, []);
    out.get(partner).push({ id: ev.id, mine, created_at: ev.created_at, content: ev.content });
  }
  for (const list of out.values()) list.sort((a, b) => a.created_at - b.created_at);
  return out;
}
