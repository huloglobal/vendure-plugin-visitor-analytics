import { createHmac, randomBytes } from 'crypto';
import { isIP } from 'net';

/**
 * Pure privacy helpers for the ingest path (0.20.0): private-parameter
 * stripping, the cookieless visitor id, IP exclusion ranges. No I/O, no
 * decorators, so the unit suite imports them directly.
 */

/**
 * Query parameters never stored or shown: one-time keys and tokens that links
 * carry (password resets, sign-in, unsubscribe and recovery links, order keys)
 * and the subscriber ids mailing tools add to campaign links. Any parameter
 * whose value is an e-mail address is dropped too.
 */
export const PRIVATE_PARAMS = [
    'key', 'login', 'token', 'access_token', 'id_token', 'auth', 'code', 'nonce', 'password', 'pass', 'pwd', 'email',
    'e', 't', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok', '_ke', 'ck_subscriber_id', 'vero_id', 'hulo_exclude',
];

const EMAIL_IN_VALUE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** Lower-cased, de-duplicated list of parameter names (letters, digits, `_ - .`, at most 64 chars each, 100 names). */
export function cleanParamList(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/);
    const out: string[] = [];
    for (const v of list) {
        const s = String(v ?? '').trim().toLowerCase();
        if (s && /^[a-z0-9_.\-[\]]{1,64}$/.test(s) && !out.includes(s)) out.push(s);
        if (out.length >= 100) break;
    }
    return out;
}

/**
 * `url` without its private parameters (`PRIVATE_PARAMS` when `defaults` is
 * true, plus `extra`) and without any parameter whose value is an e-mail
 * address. Everything else is kept exactly as sent, in order.
 */
export function stripPrivateParams(url: string, extra: string[] = [], defaults = true): string {
    const q = url.indexOf('?');
    if (q === -1) return url;
    const hashAt = url.indexOf('#', q);
    const query = url.slice(q + 1, hashAt === -1 ? undefined : hashAt);
    const hash = hashAt === -1 ? '' : url.slice(hashAt);
    const names = new Set([...(defaults ? PRIVATE_PARAMS : []), ...extra.map(s => s.toLowerCase())]);
    const keep: string[] = [];
    for (const pair of query.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        const rawName = eq === -1 ? pair : pair.slice(0, eq);
        const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
        let name = rawName;
        let value = rawValue;
        try { name = decodeURIComponent(rawName.replace(/\+/g, ' ')); } catch { /* keep raw */ }
        try { value = decodeURIComponent(rawValue.replace(/\+/g, ' ')); } catch { /* keep raw */ }
        const base = name.toLowerCase().replace(/\[.*$/, '');
        if (names.has(base) || names.has(name.toLowerCase()) || EMAIL_IN_VALUE.test(value)) continue;
        keep.push(pair);
    }
    return url.slice(0, q) + (keep.length ? `?${keep.join('&')}` : '') + hash;
}

/** A fresh random salt for the cookieless id (32 hex). */
export function newSalt(): string {
    return randomBytes(16).toString('hex');
}

/** Today's UTC day, `YYYY-MM-DD`. */
export function utcDay(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/**
 * Cookieless visitor id: an HMAC of the address, the browser and the site
 * under the salt of the current UTC day. Nothing is stored on the device; the
 * salt is replaced every day and the old one deleted, so an id can never be
 * recomputed or linked across days.
 */
export function cookielessVisitorId(salt: string, ip: string, userAgent: string, site: string): string {
    return createHmac('sha256', salt).update(`vid|${ip}|${userAgent}|${site}`).digest('hex').slice(0, 32);
}

/** A valid IP address or CIDR range (v4 or v6). */
export function validRange(r: string): boolean {
    const [net, bits] = String(r || '').split('/', 2);
    const v = isIP(net);
    if (!v) return false;
    if (bits === undefined) return true;
    if (!/^\d{1,3}$/.test(bits)) return false;
    return Number(bits) <= (v === 4 ? 32 : 128);
}

function ipBytes(ip: string): number[] | null {
    const v = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
    if (isIP(v) === 4) return v.split('.').map(Number);
    if (isIP(v) !== 6) return null;
    let [head, tail] = v.split('::', 2) as [string, string | undefined];
    const parse = (s: string) => (s ? s.split(':') : []);
    let h = parse(head);
    let t = tail === undefined ? [] : parse(tail);
    // An embedded IPv4 tail (::ffff:1.2.3.4 written in full form).
    const fix = (parts: string[]) => {
        const last = parts[parts.length - 1];
        if (last && isIP(last) === 4) {
            const b = last.split('.').map(Number);
            parts.splice(parts.length - 1, 1, ((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16));
        }
        return parts;
    };
    h = fix(h); t = fix(t);
    const fill = tail === undefined ? [] : new Array(8 - h.length - t.length).fill('0');
    const groups = [...h, ...fill, ...t];
    if (groups.length !== 8) return null;
    const out: number[] = [];
    for (const g of groups) { const n = parseInt(g || '0', 16); out.push((n >> 8) & 0xff, n & 0xff); }
    return out;
}

/** True when `ip` is inside `range` (an address or CIDR, v4 or v6). */
export function ipInRange(ip: string, range: string): boolean {
    if (!ip || !validRange(range)) return false;
    const [net, bitsRaw] = range.split('/', 2);
    const a = ipBytes(ip);
    const b = ipBytes(net);
    if (!a || !b || a.length !== b.length) return false;
    const bits = bitsRaw === undefined ? a.length * 8 : Number(bitsRaw);
    const full = Math.floor(bits / 8);
    for (let i = 0; i < full; i++) if (a[i] !== b[i]) return false;
    const rem = bits % 8;
    if (!rem) return true;
    const mask = (0xff << (8 - rem)) & 0xff;
    return (a[full] & mask) === (b[full] & mask);
}

/** Valid ranges only, de-duplicated, at most 200. */
export function cleanRanges(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,]+/);
    const out: string[] = [];
    for (const v of list) {
        const s = String(v ?? '').trim();
        if (s && validRange(s) && !out.includes(s)) out.push(s);
        if (out.length >= 200) break;
    }
    return out;
}

/** Normalised e-mail address, or '' when it is not one. */
export function normaliseEmailAddress(raw: unknown): string {
    const e = String(raw ?? '').trim().toLowerCase();
    return e.length <= 254 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) ? e : '';
}
