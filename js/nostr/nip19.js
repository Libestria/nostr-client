// NIP-19 : encodage bech32 des identifiants (npub, note, nprofile, nevent, naddr).
// Les clés privées (nsec, ncryptsec) sont REFUSÉES : ce client n'en manipule jamais.
// Module sans DOM ni dépendance.
export class Nip19Error extends Error {
  constructor(code) { super(code); this.code = code; } // 'private-key' | 'invalid'
}

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const HEX64 = /^[0-9a-f]{64}$/;
const PRIVATE = /^(nsec|ncryptsec)1/i;

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
const hrpExpand = (hrp) => [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));

function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [], max = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from) throw new Nip19Error('invalid');
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & max); }
    acc &= (1 << bits) - 1;
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & max); }
  else if (bits >= from || (acc << (to - bits)) & max) throw new Nip19Error('invalid');
  return out;
}

function bech32Decode(str) {
  if (str.length < 8 || str.length > 5000) throw new Nip19Error('invalid');
  if (str !== str.toLowerCase() && str !== str.toUpperCase()) throw new Nip19Error('invalid');
  const s = str.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) throw new Nip19Error('invalid');
  const hrp = s.slice(0, pos);
  const data = [];
  for (const c of s.slice(pos + 1)) {
    const i = CHARSET.indexOf(c);
    if (i < 0) throw new Nip19Error('invalid');
    data.push(i);
  }
  if (polymod(hrpExpand(hrp).concat(data)) !== 1) throw new Nip19Error('invalid');
  return { hrp, bytes: Uint8Array.from(convertBits(data.slice(0, -6), 5, 8, false)) };
}

function bech32Encode(hrp, bytes) {
  const data = convertBits(bytes, 8, 5, true);
  const mod = polymod(hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0])) ^ 1;
  const check = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${data.concat(check).map((i) => CHARSET[i]).join('')}`;
}

export const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export function hexToBytes(hex) {
  if (!/^([0-9a-f]{2})+$/.test(hex)) throw new Nip19Error('invalid');
  return Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
}

function parseTLV(bytes) {
  const out = {};
  for (let i = 0; i < bytes.length;) {
    if (i + 2 > bytes.length) throw new Nip19Error('invalid');
    const type = bytes[i], len = bytes[i + 1];
    const value = bytes.slice(i + 2, i + 2 + len);
    if (value.length !== len) throw new Nip19Error('invalid');
    (out[type] ||= []).push(value);
    i += 2 + len;
  }
  return out;
}
const text = (b) => new TextDecoder('utf-8', { fatal: true }).decode(b);
const hex32 = (b) => { if (!b || b.length !== 32) throw new Nip19Error('invalid'); return bytesToHex(b); };
const relayList = (tlv) => (tlv[1] || []).map(text).filter((r) => /^wss:\/\/[^\s]+$/.test(r));
const kind = (tlv) => {
  const b = tlv[3]?.[0];
  if (!b) return undefined;
  if (b.length !== 4) throw new Nip19Error('invalid');
  return new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
};

// Retourne { type, data } :
//   npub / note : data = hex ; nprofile : { pubkey, relays } ;
//   nevent : { id, relays, author?, kind? } ; naddr : { identifier, pubkey, kind, relays }
export function decode(input) {
  const str = String(input).trim();
  if (PRIVATE.test(str)) throw new Nip19Error('private-key');
  const { hrp, bytes } = bech32Decode(str);
  try {
    switch (hrp) {
      case 'npub': return { type: 'npub', data: hex32(bytes) };
      case 'note': return { type: 'note', data: hex32(bytes) };
      case 'nprofile': {
        const t = parseTLV(bytes);
        return { type: 'nprofile', data: { pubkey: hex32(t[0]?.[0]), relays: relayList(t) } };
      }
      case 'nevent': {
        const t = parseTLV(bytes);
        return { type: 'nevent', data: {
          id: hex32(t[0]?.[0]), relays: relayList(t),
          author: t[2] ? hex32(t[2][0]) : undefined, kind: kind(t) } };
      }
      case 'naddr': {
        const t = parseTLV(bytes);
        const k = kind(t);
        if (!t[0] || !t[2] || k === undefined) throw new Nip19Error('invalid');
        return { type: 'naddr', data: { identifier: text(t[0][0]), pubkey: hex32(t[2][0]), kind: k, relays: relayList(t) } };
      }
      default: throw new Nip19Error('invalid');
    }
  } catch (e) {
    throw e instanceof Nip19Error ? e : new Nip19Error('invalid');
  }
}

const need = (hex) => { if (!HEX64.test(hex)) throw new Nip19Error('invalid'); return hexToBytes(hex); };
export const npubEncode = (hex) => bech32Encode('npub', need(hex));
export const noteEncode = (hex) => bech32Encode('note', need(hex));
export function nprofileEncode({ pubkey, relays = [] }) {
  const enc = new TextEncoder();
  const parts = [Uint8Array.of(0, 32, ...need(pubkey))];
  for (const r of relays) { const b = enc.encode(r); parts.push(Uint8Array.of(1, b.length, ...b)); }
  return bech32Encode('nprofile', Uint8Array.from(parts.flatMap((p) => [...p])));
}

// LNURL (LUD-01) : URL https encodée en bech32 (hrp « lnurl »), utilisée dans la demande de zap.
export const lnurlEncode = (url) => bech32Encode('lnurl', new TextEncoder().encode(url));
export function lnurlDecode(str) {
  const { hrp, bytes } = bech32Decode(String(str).trim());
  if (hrp !== 'lnurl') throw new Nip19Error('invalid');
  return new TextDecoder().decode(bytes);
}
