import { describe, expect, it, vi } from 'vitest';
import { cleanRanges, cookielessVisitorId, ipInRange, normaliseEmailAddress, stripPrivateParams, validRange } from './privacy-utils';
import { DEFAULT_VA_SETTINGS, sanitiseSettings } from './va-settings';
import { cleanGoal, patternForUrl } from './goal-rules';
import { matchGoal, objectMeta, sessionRates } from './ingest-utils';
import { globMatch } from './url-pattern';
import { composeReminder, reminderStepDue } from './reminder-mail';
import { PremiumWeeklyDigest } from './premium-digest';
import { HULO_STOREFRONT_JS } from './hulo-storefront';

describe('URL parameter stripping', () => {
    it('drops tokens, keys and e-mail values, keeps the rest in order', () => {
        expect(stripPrivateParams('/reset?token=abc&utm_source=news&page=2')).toBe('/reset?utm_source=news&page=2');
        expect(stripPrivateParams('/x?ref=a%40b.co&q=shoes')).toBe('/x?q=shoes');
        expect(stripPrivateParams('/x?Email=me@x.io')).toBe('/x');
        expect(stripPrivateParams('/cart/restore?t=tok#top')).toBe('/cart/restore#top');
        expect(stripPrivateParams('/x?aff=1&q=2', ['aff'])).toBe('/x?q=2');
        expect(stripPrivateParams('/x?token=1', [], false)).toBe('/x?token=1');
        expect(stripPrivateParams('/plain')).toBe('/plain');
    });
});

describe('cookieless ids and exclusion ranges', () => {
    it('the visitor id depends on the day salt, address, browser and site', () => {
        const a = cookielessVisitorId('s1', '1.2.3.4', 'UA', 'https://shop');
        expect(a).toMatch(/^[a-f0-9]{32}$/);
        expect(cookielessVisitorId('s1', '1.2.3.4', 'UA', 'https://shop')).toBe(a);
        expect(cookielessVisitorId('s2', '1.2.3.4', 'UA', 'https://shop')).not.toBe(a);
        expect(cookielessVisitorId('s1', '1.2.3.5', 'UA', 'https://shop')).not.toBe(a);
    });
    it('matches IPv4 and IPv6 addresses and CIDRs', () => {
        expect(ipInRange('10.1.2.3', '10.0.0.0/8')).toBe(true);
        expect(ipInRange('11.1.2.3', '10.0.0.0/8')).toBe(false);
        expect(ipInRange('::ffff:192.168.1.9', '192.168.1.0/24')).toBe(true);
        expect(ipInRange('2001:db8::1', '2001:db8::/32')).toBe(true);
        expect(ipInRange('2001:db9::1', '2001:db8::/32')).toBe(false);
        expect(ipInRange('203.0.113.7', '203.0.113.7')).toBe(true);
        expect(validRange('1.2.3.4/33')).toBe(false);
        expect(cleanRanges('1.2.3.4, nope, 10.0.0.0/8 1.2.3.4')).toEqual(['1.2.3.4', '10.0.0.0/8']);
        expect(normaliseEmailAddress(' Me@Example.COM ')).toBe('me@example.com');
        expect(normaliseEmailAddress('nope')).toBe('');
    });
});

describe('settings', () => {
    it('defaults keep existing installs unchanged except the privacy defaults', () => {
        expect(DEFAULT_VA_SETTINGS).toMatchObject({ cookieless: false, excludeStaff: true, stripPrivateParams: true, serverCartCapture: false, reminders: { enabled: false } });
    });
    it('sanitises a patch over the current settings', () => {
        const s = sanitiseSettings({ cookieless: true, excludeIps: '10.0.0.0/8, bad', stripParams: 'Aff, ref ref', reminders: { enabled: true, firstAfterHours: 999, secondAfterHours: 1, maxPerRun: 0 }, unknown: 1 });
        expect(s.cookieless).toBe(true);
        expect(s.excludeStaff).toBe(true);
        expect(s.excludeIps).toEqual(['10.0.0.0/8']);
        expect(s.stripParams).toEqual(['aff', 'ref']);
        expect(s.reminders).toMatchObject({ enabled: true, firstAfterHours: 168, secondAfterHours: 0, maxPerRun: 1 });
        expect((s as any).unknown).toBeUndefined();
        expect(sanitiseSettings({ excludeStaff: 'yes' }).excludeStaff).toBe(true);
    });
});

describe('goal types', () => {
    it('validates page, form and payment goals', () => {
        expect(cleanGoal({ name: 'Order', urlPattern: '/checkout/confirmation/**' })).toMatchObject({ type: 'page', urlPattern: '/checkout/confirmation/**' });
        expect(cleanGoal({ name: 'x', type: 'page' })).toEqual({ error: expect.stringMatching(/urlPattern/) });
        expect(cleanGoal({ name: 'Contact', type: 'form' })).toEqual({ error: expect.stringMatching(/target/) });
        expect(cleanGoal({ name: 'Contact', type: 'form', target: 'contact-*' })).toMatchObject({ type: 'form', target: 'contact-*' });
        expect(cleanGoal({ name: 'Paid', type: 'payment', urlPattern: '/ignored' })).toMatchObject({ type: 'payment', urlPattern: '' });
        expect(cleanGoal({ name: 'x', type: 'nope' })).toEqual({ error: expect.any(String) });
        expect(cleanGoal({ name: 'x', type: 'form', target: '<script>' })).toEqual({ error: expect.any(String) });
        expect(cleanGoal({ valueMinor: 5 }, { name: 'Kept', type: 'page', urlPattern: '/a', target: '', valueMinor: 1, enabled: true })).toMatchObject({ name: 'Kept', valueMinor: 5 });
    });
    it('matches form goals on form_submit only with premium access', () => {
        const goals = [{ id: 1, type: 'page', urlPattern: '/thanks', target: '' }, { id: 2, type: 'form', urlPattern: '', target: 'contact*' }];
        expect(matchGoal(goals, 'pageview', '/thanks', null, false)?.id).toBe(1);
        expect(matchGoal(goals, 'form_submit', '/contact', { formId: 'contact-form' }, true)?.id).toBe(2);
        expect(matchGoal(goals, 'form_submit', '/contact', { formId: 'contact-form' }, false)).toBeUndefined();
        expect(matchGoal(goals, 'form_submit', '/contact', { formId: 'newsletter' }, true)).toBeUndefined();
        expect(matchGoal([{ id: 3, urlPattern: '/a' }], 'pageview', '/a', null, false)?.id).toBe(3); // pre-0.20 goals have no type
    });
    it('globs and suggestion patterns', () => {
        expect(globMatch('stripe*', 'stripe-ch2')).toBe(true);
        expect(globMatch('', 'anything')).toBe(true);
        expect(globMatch('bank', 'stripe')).toBe(false);
        expect(patternForUrl('/checkout/confirmation/ABC123?x=1')).toBe('/checkout/confirmation/**');
        expect(patternForUrl('/thanks')).toBe('/thanks');
    });
    it('meta strings from hulo.js are stored as objects, once', () => {
        expect(objectMeta('{"eventType":"cart_snapshot"}')).toEqual({ eventType: 'cart_snapshot' });
        expect(objectMeta({ a: 1 })).toEqual({ a: 1 });
        expect(objectMeta('plain')).toEqual({ value: 'plain' });
        expect(objectMeta('')).toBeNull();
    });
});

describe('reports', () => {
    it('bounce and conversion rates', () => {
        expect(sessionRates(8, 2, 1)).toEqual({ bounced: 2, bounceRate: 25, conversions: 1, conversionRate: 12.5 });
        expect(sessionRates(0, 0, 0).bounceRate).toBe(0);
    });
});

describe('reminder e-mails', () => {
    const r = { ...DEFAULT_VA_SETTINGS.reminders, enabled: true, firstAfterHours: 1, secondAfterHours: 24 };
    const t0 = Date.parse('2026-11-13T10:00:00Z');
    it('first after an hour, second after a day, never a third', () => {
        expect(reminderStepDue({ emailsSent: 0, abandonedAt: new Date(t0) }, r, t0 + 30 * 60_000)).toBe(0);
        expect(reminderStepDue({ emailsSent: 0, abandonedAt: new Date(t0) }, r, t0 + 61 * 60_000)).toBe(1);
        expect(reminderStepDue({ emailsSent: 1, abandonedAt: new Date(t0), lastEmailAt: new Date(t0 + 3600_000) }, r, t0 + 23 * 3600_000)).toBe(0);
        expect(reminderStepDue({ emailsSent: 1, abandonedAt: new Date(t0), lastEmailAt: new Date(t0 + 3600_000) }, r, t0 + 25 * 3600_000)).toBe(2);
        expect(reminderStepDue({ emailsSent: 2, abandonedAt: new Date(t0) }, r, t0 + 99 * 3600_000)).toBe(0);
        expect(reminderStepDue({ emailsSent: 1, abandonedAt: new Date(t0) }, { ...r, secondAfterHours: 0 }, t0 + 99 * 3600_000)).toBe(0);
    });
    it('the message carries the link, the items, the total and an unsubscribe line, escaped', () => {
        const m = composeReminder({ step: 1, shop: 'Shop', subject: 'Still want it? {{total}} at {{shop}}', items: [{ qty: 2, name: '<b>Pen</b>' }], totalMinor: 1250, currency: 'GBP', recoveryUrl: 'https://shop/cart/restore?t=x', optOutUrl: 'https://api/ees/abandoned-carts/opt-out?e=y' });
        expect(m.subject).toBe('Still want it? £12.50 at Shop');
        expect(m.text).toContain('2 × <b>Pen</b>');
        expect(m.text).toContain('https://shop/cart/restore?t=x');
        expect(m.text).toContain('Unsubscribe');
        expect(m.html).toContain('&lt;b&gt;Pen&lt;/b&gt;');
        expect(m.html).not.toContain('<b>Pen</b>');
    });
});

describe('weekly report is premium (0.20.0)', () => {
    it('sends nothing and refuses a test without premium access', async () => {
        const prefs = { all: vi.fn(async () => ({})), get: vi.fn(async () => null), set: vi.fn(), cas: vi.fn(async () => true), casDelete: vi.fn() } as any;
        const send = vi.fn(async () => true);
        const d = new PremiumWeeklyDigest({ pluginId: 'p', pluginName: 'Visitors', prefs, collect: vi.fn(async () => ({ stats: [] } as any)), send, defaultRecipient: () => 'a@b.co' }, () => false);
        expect(await d.tick(new Date())).toBe(false);
        expect(prefs.all).not.toHaveBeenCalled();
        expect(await d.sendNow('a@b.co')).toMatchObject({ sent: false, reason: 'licence-required' });
        expect(send).not.toHaveBeenCalled();
    });
});

describe('hulo.js', () => {
    it('cookieless mode stores nothing on the device; forms are auto-tracked by id only', () => {
        const js = HULO_STOREFRONT_JS('https://api', 1, { cookieless: true });
        expect(js).toContain('cookieless: true');
        expect(js).toContain("if (CONFIG.cookieless) return {};");
        expect(js).toContain("type: 'form_submit', meta: { formId:");
        expect(js).toContain("hulo_exclude");
        expect(HULO_STOREFRONT_JS('https://api', 1, { autoForms: false })).toContain('autoForms: false');
        // The template is valid JavaScript.
        expect(() => new Function(HULO_STOREFRONT_JS('https://api', 1, {}))).not.toThrow();
    });
});
