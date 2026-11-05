import { afterEach, describe, expect, it, vi } from 'vitest';

import { AbandonedCartController } from './abandoned-cart.controller';
import { VisitorAnalyticsPlugin } from './plugin';
import { VisitorTrackingController } from './visitor-tracking.controller';

/**
 * The admin CSV exports must tell every cache not to keep them: Cloudflare
 * caches `.csv` by extension, even on an authenticated 200, and would hand
 * one admin's export to the next caller of the same URL.
 */

// TypeORM reads the entities' column types from decorator metadata, which
// vitest's esbuild transform does not emit. The exports use raw SQL only, so
// plain classes stand in for the entities.
vi.mock('./visitor-event.entity', () => ({ VisitorEvent: class VisitorEvent {} }));
vi.mock('./conversion-goal.entity', () => ({ ConversionGoal: class ConversionGoal {} }));
vi.mock('./abandoned-cart.entity', () => ({ AbandonedCart: class AbandonedCart {} }));
vi.mock('./product-co-view.entity', () => ({ ProductCoView: class ProductCoView {} }));

/** Just enough of an Express response to see what a streaming handler answered. */
function fakeRes() {
    const headers: Record<string, string> = {};
    const res: any = {
        statusCode: 200,
        body: '',
        destroyed: false,
        writableEnded: false,
        setHeader(name: string, value: string | number) { headers[name.toLowerCase()] = String(value); return res; },
        getHeader(name: string) { return headers[name.toLowerCase()]; },
        status(code: number) { res.statusCode = code; return res; },
        json(body: unknown) { res.body = JSON.stringify(body); res.writableEnded = true; return res; },
        write(chunk: string) { res.body += chunk; return true; },
        end() { res.writableEnded = true; return res; },
        once() { return res; },
        off() { return res; },
    };
    return { res, headers };
}

/** A raw connection that answers the first chunk query with `rows`, then nothing. */
function rawConnection(rows: any[]) {
    let calls = 0;
    return { options: { type: 'mysql' }, query: async () => (calls++ === 0 ? rows : []) };
}

/** An administrator; `channels` are the channels their roles cover (default channel = all). */
function adminCtx(channels: Array<{ id: number; code: string }> = [{ id: 1, code: '__default_channel__' }], activeUserId: number | null = 1): any {
    return {
        activeUserId,
        channelId: channels[0].id,
        userHasPermissions: () => true,
        session: { user: { channelPermissions: channels.map(c => ({ ...c, permissions: ['ReadCustomer'] })) } },
    };
}

const visitorRow = {
    id: 1, createdAt: new Date('2026-11-01T10:00:00Z'), visitorId: 'a'.repeat(32), sessionId: 's1', customerId: null, channelId: 1,
    type: 'pageview', url: '/products/widget', title: 'Widget', referrerDomain: null, country: 'GB', region: null, city: null,
    browser: 'Firefox', os: 'Linux', device: 'desktop', isBot: false, goalId: null, utmSource: null, utmMedium: null, utmCampaign: null,
};

const cartRow = {
    id: 1, sessionId: 's1', visitorId: 'a'.repeat(32), customerId: 7, currency: 'GBP', totalMinor: 9900, itemCount: 1,
    email: 'shopper@example.test', status: 'abandoned', abandonedAt: new Date('2026-11-01T10:00:00Z'), recoveredAt: null,
    utmSource: null, utmMedium: null, utmCampaign: null, countryCode: 'GB',
};

const visitorsController = () =>
    new VisitorTrackingController({ rawConnection: rawConnection([visitorRow]) } as any, {} as any, {} as any, {} as any);
const cartsController = () =>
    new AbandonedCartController({ connection: { rawConnection: rawConnection([cartRow]) } } as any);

afterEach(() => vi.restoreAllMocks());

describe('GET /ees/visitors/export.csv', () => {
    it('streams the CSV with Cache-Control: private, no-store', async () => {
        vi.spyOn(VisitorAnalyticsPlugin, 'hasPremiumAccess').mockReturnValue(true);
        const { res, headers } = fakeRes();
        await visitorsController().exportCsv(adminCtx(), { query: { days: '7' } } as any, res);
        expect(res.statusCode).toBe(200);
        expect(headers['content-type']).toMatch(/^text\/csv/);
        expect(res.body).toContain('/products/widget');
        expect(headers['cache-control']).toBe('private, no-store');
    });

    it('sends it on the refusals too (signed out, no licence)', async () => {
        vi.spyOn(VisitorAnalyticsPlugin, 'hasPremiumAccess').mockReturnValue(false);
        const signedOut = fakeRes();
        await visitorsController().exportCsv(adminCtx(undefined, null), { query: {} } as any, signedOut.res);
        expect(signedOut.res.statusCode).toBe(401);
        expect(signedOut.headers['cache-control']).toBe('private, no-store');

        const unlicensed = fakeRes();
        await visitorsController().exportCsv(adminCtx(), { query: {} } as any, unlicensed.res);
        expect(unlicensed.res.statusCode).toBe(402);
        expect(unlicensed.headers['cache-control']).toBe('private, no-store');
    });
});

describe('GET /ees/abandoned-carts/export.csv', () => {
    it('streams the CSV with Cache-Control: private, no-store', async () => {
        const { res, headers } = fakeRes();
        await cartsController().exportCsv(adminCtx(), res, '30', undefined);
        expect(res.statusCode).toBe(200);
        expect(headers['content-type']).toMatch(/^text\/csv/);
        expect(res.body).toContain('shopper@example.test');
        expect(headers['cache-control']).toBe('private, no-store');
    });

    it('sends it when the admin asks for a channel they cannot read', async () => {
        const { res, headers } = fakeRes();
        await expect(cartsController().exportCsv(adminCtx([{ id: 2, code: 'second' }]), res, '30', '1')).rejects.toThrow();
        expect(res.body).toBe('');
        expect(headers['cache-control']).toBe('private, no-store');
    });
});
