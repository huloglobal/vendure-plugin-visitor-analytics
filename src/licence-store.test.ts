import { afterEach, describe, expect, it, vi } from 'vitest';

import { VisitorAnalyticsPlugin } from './plugin';
import { RecommendationsService } from './recommendations.service';
import { VisitorTrackingController } from './visitor-tracking.controller';

/**
 * On PostgreSQL the licence SDK rewrites `ON DUPLICATE KEY UPDATE` as
 * `ON CONFLICT (...) DO UPDATE`, using the conflict columns that
 * `LicenceStore.save` passes as the query function's third argument. A
 * wrapper that dropped that argument made every save throw there: activating
 * a key in the admin applied it, answered 500 and never stored it, and the
 * co-view watermark (kept in the same table) was never stored either.
 */

// TypeORM reads the entities' column types from decorator metadata, which
// vitest's esbuild transform does not emit. These paths use raw SQL only, so
// plain classes stand in for the entities.
vi.mock('./visitor-event.entity', () => ({ VisitorEvent: class VisitorEvent {} }));
vi.mock('./conversion-goal.entity', () => ({ ConversionGoal: class ConversionGoal {} }));
vi.mock('./abandoned-cart.entity', () => ({ AbandonedCart: class AbandonedCart {} }));
vi.mock('./product-co-view.entity', () => ({ ProductCoView: class ProductCoView {} }));

/** A raw connection that reports Postgres, keeps `hulo_licence_store` in a map and has no visitor events. */
function postgres() {
    const rows = new Map<string, string>();
    const upserts: string[] = [];
    const rawConnection = {
        options: { type: 'postgres' },
        async query(sql: string, params: any[] = []) {
            if (sql.startsWith('INSERT INTO hulo_licence_store')) {
                upserts.push(sql);
                rows.set(params[0], params[1]);
            }
            if (sql.startsWith('SELECT licenceKey FROM hulo_licence_store')) {
                // Postgres folds unquoted names to lower case; the SDK's adapter restores them.
                return rows.has(params[0]) ? [{ licencekey: rows.get(params[0]) }] : [];
            }
            return [];
        },
    };
    return { connection: { rawConnection } as any, rows, upserts };
}

/** Just enough of an Express response to see what a handler answered. */
function fakeRes() {
    const res: any = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) { res.statusCode = code; return res; },
        json(body: unknown) { res.body = body; return res; },
    };
    return res;
}

const admin: any = { activeUserId: 1, userHasPermissions: () => true };

afterEach(() => vi.restoreAllMocks());

describe('licence key store on PostgreSQL', () => {
    it('activating a key in the admin stores it with an ON CONFLICT upsert', async () => {
        vi.spyOn(VisitorAnalyticsPlugin, 'activateRuntimeLicence').mockReturnValue({ valid: true, message: 'Licensed' } as any);
        const db = postgres();
        const res = fakeRes();
        await new VisitorTrackingController(db.connection, {} as any, {} as any, {} as any).licenceActivate(admin, res, { key: 'a.licence.key' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ licensed: true, message: 'Licensed' });
        expect(db.upserts).toEqual([expect.stringContaining('ON CONFLICT (pluginId) DO UPDATE SET')]);
        expect(db.rows.get('vendure-plugin-visitor-analytics')).toBe('a.licence.key');
    });

    it('stores the co-view watermark, so another process does not count the same window again', async () => {
        const db = postgres();
        const first = await new RecommendationsService(db.connection).aggregateCoViews(6);
        expect(db.upserts).toEqual([expect.stringContaining('ON CONFLICT (pluginId) DO UPDATE SET')]);
        // A second instance on the same database stands in for "aggregate now" in
        // the server process, after the worker's sweep.
        const second = await new RecommendationsService(db.connection).aggregateCoViews(6);
        expect(second.since).toBe(first.until);
    });
});
