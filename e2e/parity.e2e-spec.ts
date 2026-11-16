import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, MysqlInitializer, registerInitializer, testConfig } from '@vendure/testing';
import { initialData } from '../../../e2e-shared/initial-data';
import { VisitorAnalyticsPlugin } from '../src/plugin';
import { GoalsService } from '../src/goals.service';
import { AbandonedCartService } from '../src/abandoned-cart.service';
import { CartRemindersService } from '../src/cart-reminders.service';

/**
 * 0.20.0 parity on MariaDB (the report SQL is MySQL-flavoured; sql.js cannot run it):
 *   VA_E2E_DB_HOST VA_E2E_DB_PORT VA_E2E_DB_USER VA_E2E_DB_PASS
 */
const DB = process.env.VA_E2E_DB_HOST
    ? { host: process.env.VA_E2E_DB_HOST, port: Number(process.env.VA_E2E_DB_PORT || 3306), username: process.env.VA_E2E_DB_USER || 'root', password: process.env.VA_E2E_DB_PASS || '' }
    : null;
const PORT = 3172;
const BASE = `http://localhost:${PORT}`;
const run = DB ? describe : describe.skip;

run('@huloglobal/vendure-plugin-visitor-analytics 0.20.0 (MariaDB)', () => {
    registerInitializer('mysql', new MysqlInitializer());
    const config = mergeConfig(testConfig, {
        apiOptions: { port: PORT },
        dbConnectionOptions: { type: 'mysql' as const, host: DB?.host, port: DB?.port, username: DB?.username, password: DB?.password, database: 'hulo_va_e2e', synchronize: true },
        plugins: [VisitorAnalyticsPlugin.init({ publicBaseUrl: BASE, honorDoNotTrack: true, rateLimit: { capacity: 10_000, windowMs: 60_000 }, abandonment: { windowMinutes: 0 } })],
    });
    const { server, adminClient } = createTestEnvironment(config);
    let premium: jest.SpyInstance;
    beforeAll(async () => {
        await server.init({ initialData, productsCsvPath: '', customerCount: 0 } as any);
        await adminClient.asSuperAdmin();
        premium = jest.spyOn(VisitorAnalyticsPlugin, 'hasPremiumAccess').mockReturnValue(false);
    }, 120_000);
    afterAll(async () => { premium?.mockRestore(); await server.destroy(); });

    const db = () => (server as any).app.get(TransactionalConnection).rawConnection;
    const auth = () => { const t = (adminClient as any).getAuthToken?.() as string | undefined; return { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }; };
    const track = (body: any, headers: Record<string, string> = {}) => fetch(`${BASE}/ees/track`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) e2e', ...headers }, body: JSON.stringify(body) });
    const vid = (n: number) => n.toString(16).padStart(32, 'a');

    it('the free tier records every event (no 100/day cap)', async () => {
        for (let b = 0; b < 3; b++) {
            const events = Array.from({ length: 50 }, (_, i) => ({ type: 'pageview', url: `/p/${b}-${i}` }));
            const r: any = await (await track({ channelId: 1, visitorId: vid(1), sessionId: vid(2), events })).json();
            expect(r.stored).toBe(50);
        }
        const [{ n }] = await db().query(`SELECT COUNT(*) AS n FROM visitor_event`);
        expect(Number(n)).toBe(150);
        const st: any = await (await fetch(`${BASE}/ees/licence/status`, { headers: auth() })).json();
        expect(st.capReached).toBe(false);
        await db().query(`DELETE FROM visitor_event`);
    });

    it('strips private parameters and honours excluded addresses', async () => {
        await track({ visitorId: vid(3), sessionId: vid(4), events: [{ type: 'pageview', url: 'https://shop.test/reset?token=s3cret&utm_source=news', referrer: 'https://mail.test/?email=a@b.co&x=1' }] });
        const [row] = await db().query(`SELECT url, referrer, \`utmSource\` FROM visitor_event WHERE \`visitorId\` = ?`, [vid(3)]);
        expect(row).toMatchObject({ url: '/reset?utm_source=news', referrer: 'https://mail.test/?x=1', utmSource: 'news' });
        const saved = await fetch(`${BASE}/ees/settings`, { method: 'POST', headers: auth(), body: JSON.stringify({ excludeIps: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] }) });
        expect(saved.ok).toBe(true);
        const r: any = await (await track({ events: [{ type: 'pageview', url: '/x' }] })).json();
        expect(r.skipped).toBe('excluded');
        await fetch(`${BASE}/ees/settings`, { method: 'POST', headers: auth(), body: JSON.stringify({ excludeIps: [] }) });
    });

    it('cookieless mode issues no cookies and ignores ids the browser sends', async () => {
        await fetch(`${BASE}/ees/settings`, { method: 'POST', headers: auth(), body: JSON.stringify({ cookieless: true }) });
        const a = await track({ visitorId: vid(5), sessionId: vid(6), events: [{ type: 'pageview', url: '/c1' }] });
        const b = await track({ visitorId: vid(7), sessionId: vid(8), events: [{ type: 'pageview', url: '/c2' }] });
        expect(a.headers.get('set-cookie')).toBeNull();
        const ja: any = await a.json(); const jb: any = await b.json();
        expect(ja.cookieless).toBe(true);
        expect(ja.visitorId).toMatch(/^[a-f0-9]{32}$/);
        expect(ja.visitorId).not.toBe(vid(5));
        expect(jb.visitorId).toBe(ja.visitorId);
        expect(jb.sessionId).toBe(ja.sessionId);
        const js = await (await fetch(`${BASE}/ees/hulo.js`)).text();
        expect(js).toContain('cookieless: true');
        await fetch(`${BASE}/ees/settings`, { method: 'POST', headers: auth(), body: JSON.stringify({ cookieless: false }) });
    });

    it('landing pages, bounce and conversion per source, OS breakdown', async () => {
        await db().query(`DELETE FROM visitor_event`);
        await track({ visitorId: vid(10), sessionId: vid(11), events: [{ type: 'pageview', url: '/landing?utm_source=ads' }, { type: 'pageview', url: '/products/x' }, { type: 'event', url: '/checkout/confirmation/A1', meta: '{"eventType":"checkout_completed","orderCode":"A1"}' }] });
        await track({ visitorId: vid(12), sessionId: vid(13), events: [{ type: 'pageview', url: '/landing?utm_source=ads' }] });
        const lp: any = await (await fetch(`${BASE}/ees/visitors/landing-pages?days=7`, { headers: auth() })).json();
        expect(lp.pages[0]).toMatchObject({ url: '/landing?utm_source=ads', sessions: 2, bounced: 1, bounceRate: 50, conversions: 1, conversionRate: 50 });
        const src: any = await (await fetch(`${BASE}/ees/visitors/sources?days=7`, { headers: auth() })).json();
        const ads = src.sources.find((s: any) => s.source === 'ads');
        expect(ads).toMatchObject({ sessions: 2, conversions: 1 });
        expect(ads.bounceRate).toBeGreaterThan(0);
        const bd: any = await (await fetch(`${BASE}/ees/visitors/breakdown?days=7`, { headers: auth() })).json();
        expect(bd.oses[0].label).toBe('Windows');
        // hulo.js sends meta as a JSON string: stored once, as an object.
        const [m] = await db().query(`SELECT meta FROM visitor_event WHERE type = 'event' AND \`visitorId\` = ?`, [vid(10)]);
        expect(JSON.parse(m.meta)).toMatchObject({ eventType: 'checkout_completed', orderCode: 'A1' });
    });

    it('goals: licensed; form and payment goals count completions', async () => {
        const free = await fetch(`${BASE}/ees/goals`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Contact', type: 'form', target: 'contact*' }) });
        expect(free.status).toBe(402);
        premium.mockReturnValue(true);
        try {
            const bad = await fetch(`${BASE}/ees/goals`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Contact', type: 'form' }) });
            expect(bad.status).toBe(400);
            const form: any = await (await fetch(`${BASE}/ees/goals`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Contact', type: 'form', target: 'contact*', channelId: 1 }) })).json();
            const pay: any = await (await fetch(`${BASE}/ees/goals`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'Paid', type: 'payment', channelId: 1 }) })).json();
            expect(form.goal.type).toBe('form');
            await track({ visitorId: vid(20), sessionId: vid(21), events: [{ type: 'form_submit', url: '/contact', meta: { formId: 'contact-form' } }] });
            const goals = (server as any).app.get(GoalsService) as GoalsService;
            const ev: any = { toState: 'Settled', ctx: { channelId: 1 }, order: { code: 'A1', currencyCode: 'GBP', customerId: null }, payment: { id: 991, method: 'stripe', amount: 4200 } };
            expect(await goals.onPaymentSettled(ev)).toBe(pay.goal.id);
            expect(await goals.onPaymentSettled(ev)).toBe(0); // once per payment
            const st: any = await (await fetch(`${BASE}/ees/goals/stats?days=7`, { headers: auth() })).json();
            const byName = (n: string) => st.goals.find((g: any) => g.name === n);
            expect(byName('Contact').completions).toBe(1);
            expect(byName('Paid')).toMatchObject({ completions: 1, valueMinor: 4200 });
            // The payment was attributed to the visit that completed checkout A1.
            const [p] = await db().query(`SELECT \`visitorId\` FROM visitor_event WHERE type = 'payment'`);
            expect(p.visitorId).toBe(vid(10));
            const sug: any = await (await fetch(`${BASE}/ees/goals/suggestions?days=7`, { headers: auth() })).json();
            expect(sug.suggestions.find((s: any) => s.name === 'Order placed').urlPattern).toBe('/checkout/confirmation/**');
            expect(sug.suggestions.some((s: any) => s.type === 'payment')).toBe(false); // already exists
        } finally { premium.mockReturnValue(false); }
    });

    it('verified e-mail capture: a typed address counts only after the session reached checkout', async () => {
        premium.mockReturnValue(true);
        try {
            const snap = (email: string) => ({ type: 'event', url: '/cart', meta: { eventType: 'cart_snapshot', currency: 'GBP', totalMinor: 2500, itemCount: 1, items: [{ name: 'Pen', qty: 1 }], email } });
            await track({ visitorId: vid(30), sessionId: vid(31), events: [{ type: 'pageview', url: '/checkout' }, snap('verified@example.test')] });
            await track({ visitorId: vid(32), sessionId: vid(33), events: [{ type: 'pageview', url: '/products/x' }, snap('typed@example.test')] });
            await new Promise(r => setTimeout(r, 1100));
            await ((server as any).app.get(AbandonedCartService) as AbandonedCartService).scan();
            const rows: any[] = await db().query(`SELECT email, \`emailVerified\`, \`emailSource\` FROM abandoned_cart ORDER BY email`);
            expect(rows.find(r => r.email === 'verified@example.test')).toMatchObject({ emailVerified: 1, emailSource: 'checkout' });
            expect(rows.find(r => r.email === 'typed@example.test')).toMatchObject({ emailVerified: 0, emailSource: 'snapshot' });
            // Reminders are off by default, and need SMTP when on.
            const reminders = (server as any).app.get(CartRemindersService) as CartRemindersService;
            expect(await reminders.sendDue({ enabled: false } as any, true)).toEqual({ sent: 0, skipped: 'disabled' });
            expect((await reminders.sendDue({ enabled: true, firstAfterHours: 1, secondAfterHours: 0, minValueMinor: 0, maxPerRun: 5, subject: 's', shopName: '', accentColor: '', logoUrl: '', supportEmail: '', footerText: '' }, true)).sent).toBe(0);
        } finally { premium.mockReturnValue(false); }
    });

    it('weekly report and checklist are licensed', async () => {
        const setup: any = await (await fetch(`${BASE}/ees/setup`, { headers: auth() })).json();
        expect(setup).toMatchObject({ premium: false, items: [] });
        const t = await fetch(`${BASE}/ees/digest/send-test`, { method: 'POST', headers: auth(), body: JSON.stringify({ to: 'me@example.test' }) });
        expect(t.status).toBe(402);
    });

    it('0.21.0: reminder e-mail preview uses the saved design settings; admin only', async () => {
        expect([401, 403]).toContain((await fetch(`${BASE}/ees/settings/reminder-preview`)).status);
        const saved: any = await (await fetch(`${BASE}/ees/settings`, { method: 'POST', headers: auth(), body: JSON.stringify({ reminders: { shopName: 'Pen <Shop>', accentColor: '#0a7d32', logoUrl: 'javascript:alert(1)', supportEmail: 'help@pens.test', footerText: 'Pens Ltd' } }) })).json();
        expect(saved.settings.reminders).toMatchObject({ accentColor: '#0a7d32', logoUrl: '', supportEmail: 'help@pens.test' });
        const r = await fetch(`${BASE}/ees/settings/reminder-preview`, { headers: auth() });
        expect(r.status).toBe(200);
        expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
        const html = await r.text();
        expect(html).toContain('border-bottom:3px solid #0a7d32');
        expect(html).toContain('Pen &lt;Shop&gt;');
        expect(html).toContain('mailto:help@pens.test');
        expect(html).toContain('Pens Ltd');
        expect(html).not.toContain('javascript:');
        await fetch(`${BASE}/ees/settings`, { method: 'POST', headers: auth(), body: JSON.stringify({ reminders: { shopName: '', accentColor: '', supportEmail: '', footerText: '' } }) });
    });

    it('0.21.0: public recommendation routes still answer (now rate limited)', async () => {
        const r = await fetch(`${BASE}/ees/recommendations/trending?channelId=1`);
        expect(r.status).toBe(200);
    });

    it('personal data export and erase', async () => {
        const anon = await fetch(`${BASE}/ees/privacy/export?visitorId=${vid(10)}`);
        expect([401, 403]).toContain(anon.status);
        expect((await fetch(`${BASE}/ees/privacy/export`, { headers: auth() })).status).toBe(400);
        const ex: any = await (await fetch(`${BASE}/ees/privacy/export?email=verified@example.test`, { headers: auth() })).json();
        expect(ex.abandonedCarts).toHaveLength(1);
        expect(ex.subject.visitorIds).toContain(vid(30));
        expect(ex.visitorEvents.length).toBeGreaterThan(0);
        const er: any = await (await fetch(`${BASE}/ees/privacy/erase`, { method: 'POST', headers: auth(), body: JSON.stringify({ email: 'verified@example.test' }) })).json();
        expect(er.erased.abandonedCarts).toBe(1);
        expect(er.erased.visitorEvents).toBeGreaterThan(0);
        const [{ n }] = await db().query(`SELECT COUNT(*) AS n FROM visitor_event WHERE \`visitorId\` = ?`, [vid(30)]);
        expect(Number(n)).toBe(0);
    });
});
