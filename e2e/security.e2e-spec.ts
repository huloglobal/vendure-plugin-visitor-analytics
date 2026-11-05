import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import * as path from 'path';
import { initialData } from '../../../e2e-shared/initial-data';
import { VisitorEvent } from '../src/visitor-event.entity';
import { VisitorAnalyticsPlugin } from '../src/plugin';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

const PORT = 3162;
const BASE = `http://localhost:${PORT}`;

/**
 * Security regressions (0.19.2):
 *  - an administrator whose role covers only channel B must not read
 *    channel A's analytics or abandoned carts (GraphQL + REST);
 *  - the public recover-cart limiter keys on the same client IP as the
 *    ingest limiter (the host's `trustedIpHeaders`), not on the proxy.
 */
describe('@huloglobal/vendure-plugin-visitor-analytics — security', () => {
    const config = mergeConfig(testConfig, {
        apiOptions: { port: PORT },
        plugins: [
            VisitorAnalyticsPlugin.init({
                publicBaseUrl: BASE,
                trustedIpHeaders: ['x-real-ip'],
                abandonment: { recoveryLinkSecret: 'e2e-secret', storefrontBaseUrl: 'https://shop.test' },
            }),
        ],
    });
    const { server, adminClient } = createTestEnvironment(config);
    let ch2Id = 0;
    let ch2Gql = '';

    beforeAll(async () => {
        await server.init({ initialData, productsCsvPath: '', customerCount: 0 } as any);
        await adminClient.asSuperAdmin();
        const { createChannel } = await adminClient.query(gql`
            mutation {
                createChannel(input: {
                    code: "second", token: "second-token", defaultLanguageCode: en,
                    pricesIncludeTax: false, currencyCode: GBP, defaultCurrencyCode: GBP,
                    defaultShippingZoneId: "1", defaultTaxZoneId: "1"
                }) { ... on Channel { id } ... on ErrorResult { message } }
            }`);
        if (!createChannel.id) throw new Error(JSON.stringify(createChannel));
        ch2Gql = String(createChannel.id);
        ch2Id = Number(ch2Gql.replace(/^T_/, '')); // testConfig encodes ids as T_<n>
        const { createRole } = await adminClient.query(gql`
            mutation($ch: ID!) {
                createRole(input: { code: "ch2-reader", description: "ch2", permissions: [ReadCustomer, UpdateCustomer], channelIds: [$ch] }) { id }
            }`, { ch: ch2Gql });
        await adminClient.query(gql`
            mutation($role: ID!) {
                createAdministrator(input: { firstName: "Ch", lastName: "Two", emailAddress: "ch2@test", password: "ch2pass", roleIds: [$role] }) { id }
            }`, { role: createRole.id });

        const conn = server.app.get(TransactionalConnection);
        const repo = conn.rawConnection.getRepository(VisitorEvent);
        const ev = (channelId: number, visitorId: string, url: string): any => repo.create({
            visitorId, sessionId: visitorId, customerId: null, channelId, type: 'pageview', url, isBot: false,
        } as any);
        await repo.insert([
            ev(1, 'a'.repeat(32), '/channel-one-secret'),
            ev(ch2Id, 'b'.repeat(32), '/channel-two-page'),
        ]);
        await conn.rawConnection.query(
            `INSERT INTO abandoned_cart (visitorId, sessionId, channelId, currency, totalMinor, itemCount, itemsJson, email,
                 status, abandonedAt, firstSnapshotAt, lastSnapshotAt, notificationSent, createdAt, updatedAt)
             VALUES ('${'a'.repeat(32)}', 'sess-one', 1, 'GBP', 9900, 1, '[]', 'one@victim.test', 'abandoned',
                 datetime('now'), datetime('now'), datetime('now'), 0, datetime('now'), datetime('now'))`,
        );

        await adminClient.asUserWithCredentials('ch2@test', 'ch2pass');
        adminClient.setChannelToken('second-token');
    }, 90_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('GraphQL: a channel-2 admin cannot ask for channel 1 analytics', async () => {
        // (Date-windowed aggregates use MySQL-only SQL that sql.js cannot run, so the
        // proof here is that the request is refused before any SQL runs.)
        await expect(adminClient.query(gql`query { huloVisitorTopPages(channelId: 1, days: 30) { url } }`))
            .rejects.toThrow(/not currently authorized|forbidden/i);
    });

    it('GraphQL: visitor journey of a channel-1 visitor is not readable from channel 2', async () => {
        const r = await adminClient.query(gql`query($v: String!) { huloVisitorJourney(visitorId: $v) { url } }`, { v: 'a'.repeat(32) });
        expect(r.huloVisitorJourney).toEqual([]);
    });

    it('REST: a channel-2 admin cannot read channel 1 visitors or pages', async () => {
        const forced = await adminClient.fetch(`${BASE}/ees/visitors/top-pages?days=30&channelId=1`);
        expect(forced.status).toBe(403);
        const profile = await adminClient.fetch(`${BASE}/ees/visitors/profile/${'a'.repeat(32)}`);
        expect(profile.status).toBe(404);
        const journey = await adminClient.fetch(`${BASE}/ees/visitors/journey/${'a'.repeat(32)}`);
        expect((await journey.json()).events).toEqual([]);
        // 402 without a licence or evaluation, 403 with one; never stored by a cache either way.
        const csv = await adminClient.fetch(`${BASE}/ees/visitors/export.csv?channelId=1`);
        expect([402, 403]).toContain(csv.status);
        expect(csv.headers.get('cache-control')).toBe('private, no-store');
    });

    it('REST: a channel-2 admin cannot list, open or act on channel 1 abandoned carts', async () => {
        const list = await adminClient.fetch(`${BASE}/ees/abandoned-carts`);
        const lb = await list.json();
        expect(JSON.stringify(lb)).not.toContain('one@victim.test');
        const conn = server.app.get(TransactionalConnection);
        const [{ id }] = await conn.rawConnection.query(`SELECT id FROM abandoned_cart WHERE sessionId = 'sess-one'`);
        const detail = await (await adminClient.fetch(`${BASE}/ees/abandoned-carts/${id}`)).json();
        expect(JSON.stringify(detail)).not.toContain('one@victim.test');
        const link = await (await adminClient.fetch(`${BASE}/ees/abandoned-carts/${id}/recovery-link`, { method: 'POST', body: '{}' })).json();
        expect(link.url).toBeUndefined();
        // (The CSV streams with a Date bind sql.js rejects, so only the refusal is checked here.)
        const csv = await adminClient.fetch(`${BASE}/ees/abandoned-carts/export.csv?channelId=1`);
        expect(csv.status).toBe(403);
        expect(csv.headers.get('cache-control')).toBe('private, no-store');
        const forcedList = await adminClient.fetch(`${BASE}/ees/abandoned-carts?channelId=1`);
        expect(forcedList.status).toBe(403);
    });

    it('recover-cart rate limit is per visitor IP (trustedIpHeaders), not shared by everyone behind the proxy', async () => {
        // 30/min per IP. 40 different visitors, one request each, must all get through.
        const statuses: number[] = [];
        for (let i = 0; i < 40; i++) {
            const r = await fetch(`${BASE}/ees/recover-cart?t=nope`, { headers: { 'x-real-ip': `198.51.100.${i + 1}` } });
            statuses.push(r.status);
        }
        expect(statuses).not.toContain(429);
    });
});
