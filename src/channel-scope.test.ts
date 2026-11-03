import { describe, expect, it } from 'vitest';
import { readableChannels, scopeChannel, singleChannel } from './channel-scope';

const ctx = (channelId: number, perms: Array<{ id: number | string; code: string; permissions: string[] }>): any =>
    ({ channelId, session: { user: { channelPermissions: perms } } });

const superAdmin = ctx(1, [
    { id: 1, code: '__default_channel__', permissions: ['SuperAdmin', 'ReadCustomer'] },
    { id: 2, code: 'second', permissions: ['SuperAdmin', 'ReadCustomer'] },
]);
const defaultReader = ctx(1, [{ id: 1, code: '__default_channel__', permissions: ['ReadCustomer'] }]);
const ch2Only = ctx(2, [{ id: 2, code: 'second', permissions: ['ReadCustomer'] }]);
const ch2And3 = ctx(3, [
    { id: 2, code: 'second', permissions: ['ReadCustomer'] },
    { id: 3, code: 'third', permissions: ['ReadCustomer', 'UpdateCustomer'] },
]);

describe('channel scope', () => {
    it('default-channel and SuperAdmin users read every channel, as before', () => {
        expect(readableChannels(superAdmin)).toBeNull();
        expect(readableChannels(defaultReader)).toBeNull();
        expect(scopeChannel(superAdmin, null)).toEqual({ ok: true, channelId: null });
        expect(scopeChannel(defaultReader, 2)).toEqual({ ok: true, channelId: 2 });
    });
    it('a channel-2 admin is refused channel 1 and gets channel 2 when naming none', () => {
        expect(readableChannels(ch2Only)).toEqual([2]);
        expect(scopeChannel(ch2Only, 1)).toEqual({ ok: false });
        expect(scopeChannel(ch2Only, null)).toEqual({ ok: true, channelId: 2 });
        expect(scopeChannel(ch2Only, 2)).toEqual({ ok: true, channelId: 2 });
    });
    it('permission is checked per channel', () => {
        expect(readableChannels(ch2And3, 'UpdateCustomer')).toEqual([3]);
        expect(scopeChannel(ch2And3, 2, 'UpdateCustomer')).toEqual({ ok: false });
        expect(scopeChannel(ch2And3, null)).toEqual({ ok: true, channelId: 3 });
    });
    it('no session means nothing', () => {
        expect(scopeChannel({} as any, null)).toEqual({ ok: false });
    });
    it('singleChannel keeps the old default of channel 1 for unrestricted users', () => {
        expect(singleChannel(superAdmin, undefined)).toBe(1);
        expect(singleChannel(superAdmin, '2')).toBe(2);
        expect(singleChannel(ch2Only, undefined)).toBe(2);
        expect(singleChannel(ch2Only, '1')).toBeNull();
    });
    it('accepts the T_<n> ids of the e2e id strategy', () => {
        expect(readableChannels(ctx(2, [{ id: 'T_2', code: 'second', permissions: ['ReadCustomer'] }]))).toEqual([2]);
    });
});
