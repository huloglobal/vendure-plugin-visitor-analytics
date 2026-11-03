import { describe, expect, it } from 'vitest';
import { getRealIp, getResolvedCountry, getResolvedRegion } from './proxy-headers';

const req = (headers: Record<string, string>, ip?: string): any => ({ headers, ip });
/** A request whose immediate peer is a proxy the host trusts (Express `trust proxy`). */
const viaTrustedProxy = (headers: Record<string, string>): any => ({
    headers, ip: '203.0.113.50', socket: { remoteAddress: '127.0.0.1' },
    app: { get: (k: string) => (k === 'trust proxy fn' ? (addr: string) => addr === '127.0.0.1' : undefined) },
});

describe('getRealIp', () => {
    it('uses req.ip by default and ignores every proxy header (they are client-spoofable)', () => {
        expect(getRealIp(req({
            'cf-connecting-ip': '1.1.1.1', 'true-client-ip': '2.2.2.2',
            'x-real-ip': '3.3.3.3', 'x-forwarded-for': '4.4.4.4',
        }, '5.5.5.5'))).toBe('5.5.5.5');
    });
    it('honours only the headers the host trusts, in the order given', () => {
        const all = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-forwarded-for'] as const;
        expect(getRealIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '3.3.3.3' }, '5.5.5.5'), [...all])).toBe('1.1.1.1');
        expect(getRealIp(req({ 'true-client-ip': '2.2.2.2', 'x-real-ip': '3.3.3.3' }), [...all])).toBe('2.2.2.2');
        expect(getRealIp(req({ 'x-forwarded-for': '4.4.4.4, 9.9.9.9' }), ['x-forwarded-for'])).toBe('9.9.9.9');
    });
    it('uses the right-most XFF entry when XFF is trusted: the left ones are client-supplied', () => {
        // Client sent `X-Forwarded-For: 1.2.3.4`; the trusted proxy appended the real peer.
        expect(getRealIp(req({ 'x-forwarded-for': '1.2.3.4, 198.51.100.23' }), ['x-forwarded-for'])).toBe('198.51.100.23');
        expect(getRealIp(req({ 'x-forwarded-for': '  203.0.113.1 , 10.0.0.1 , 10.0.0.2 ' }), ['x-forwarded-for'])).toBe('10.0.0.2');
        expect(getRealIp(req({ 'x-forwarded-for': '198.51.100.23,' }), ['x-forwarded-for'])).toBe('198.51.100.23');
    });
    it('falls back to req.ip then null', () => {
        expect(getRealIp(req({}, '5.5.5.5'))).toBe('5.5.5.5');
        expect(getRealIp(req({}))).toBeNull();
    });
});

describe('getResolvedCountry', () => {
    it('reads cf-ipcountry', () => {
        expect(getResolvedCountry(viaTrustedProxy({ 'cf-ipcountry': 'gb' }))).toBe('GB');
    });
    it('ignores CF placeholders XX and T1', () => {
        expect(getResolvedCountry(viaTrustedProxy({ 'cf-ipcountry': 'XX' }))).toBeNull();
        expect(getResolvedCountry(viaTrustedProxy({ 'cf-ipcountry': 'T1' }))).toBeNull();
    });
    it('parses Akamai edgescape', () => {
        expect(getResolvedCountry(viaTrustedProxy({ 'x-akamai-edgescape': 'georegion=246,country_code=US,region_code=CA' }))).toBe('US');
    });
    it('reads the Fastly country header', () => {
        expect(getResolvedCountry(viaTrustedProxy({ 'x-country-code': 'de' }))).toBe('DE');
        expect(getResolvedCountry(viaTrustedProxy({ 'x-country-code': 'not-a-code' }))).toBeNull();
    });
    it('returns null when nothing present', () => {
        expect(getResolvedCountry(viaTrustedProxy({}))).toBeNull();
    });
});

describe('edge geo headers are trusted only from a trusted edge', () => {
    it('ignores CF-IPCountry / Akamai / Fastly / region headers sent straight by a client', () => {
        const direct = { headers: { 'cf-ipcountry': 'KP', 'x-country-code': 'KP', 'cf-region-code': 'ENG' }, ip: '198.51.100.9', socket: { remoteAddress: '198.51.100.9' } } as any;
        expect(getResolvedCountry(direct)).toBeNull();
        expect(getResolvedRegion(direct)).toBeNull();
        const untrustedPeer = { ...direct, app: { get: () => () => false } };
        expect(getResolvedCountry(untrustedPeer)).toBeNull();
    });
    it('honours them when the host lists trusted edge IP headers', () => {
        expect(getResolvedCountry(req({ 'cf-ipcountry': 'gb' }), ['cf-connecting-ip'])).toBe('GB');
        expect(getResolvedRegion(req({ 'cf-region-code': 'sct' }), ['cf-connecting-ip'])).toBe('SCT');
    });
});

describe('getResolvedRegion', () => {
    it('reads cf-region-code', () => {
        expect(getResolvedRegion(viaTrustedProxy({ 'cf-region-code': 'eng' }))).toBe('ENG');
        expect(getResolvedRegion(viaTrustedProxy({ 'cf-region-code': 'CA' }))).toBe('CA');
    });
    it('rejects malformed region codes and empties', () => {
        expect(getResolvedRegion(viaTrustedProxy({ 'cf-region-code': 'TOOLONG' }))).toBeNull();
        expect(getResolvedRegion(viaTrustedProxy({}))).toBeNull();
    });
});
