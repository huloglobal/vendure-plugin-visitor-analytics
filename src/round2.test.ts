import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@huloglobal/vendure-licence-sdk';
import { composeReminder } from './reminder-mail';
import { accentOf, renderEmail, safeUrl } from './email-layout';
import { DEFAULT_VA_SETTINGS, sanitiseSettings } from './va-settings';
import { assertRecsBudget, requireAllChannelsAdmin, wantsHtml } from './route-guards';

const base = { step: 1 as const, shop: 'Pen Shop', subject: 'Still want it? {{total}} at {{shop}}', items: [{ qty: 2, name: 'Pen', unitPriceMinor: 625 }], totalMinor: 1250, currency: 'GBP', recoveryUrl: 'https://shop/cart/restore?t=x', optOutUrl: 'https://api/ees/abandoned-carts/opt-out?e=y' };

describe('0.21.0 reminder e-mail design', () => {
    it('renders the shared card: 600px, accent bar, heading, button, sign-off, footer with unsubscribe; inline styles only', () => {
        const m = composeReminder({ ...base, brand: { accentColor: '#ff0000', supportEmail: 'help@pens.example', footerText: 'Pen Shop Ltd, 1 High St' } });
        expect(m.html).toContain('max-width:600px');
        expect(m.html).toContain('border-bottom:3px solid #ff0000');
        expect(m.html).toContain('background-color:#ff0000');
        expect(m.html).toContain('font-size:22px');
        expect(m.html).toContain('Kind regards,<br>Pen Shop');
        expect(m.html).toContain('mailto:help@pens.example');
        expect(m.html).toContain('Pen Shop Ltd, 1 High St');
        expect(m.html).toContain('Unsubscribe');
        expect(m.html).toContain('£12.50');
        expect(m.html).not.toMatch(/<style/i);
        expect(m.text).toContain('Kind regards,\nPen Shop\nhelp@pens.example');
        expect(m.text).toContain('2 × Pen (£12.50)');
        expect(m.text).toContain('Return to your basket: https://shop/cart/restore?t=x');
    });
    it('defaults: #155dfc accent and the shop name as text when no logo is set', () => {
        const m = composeReminder(base);
        expect(m.html).toContain('border-bottom:3px solid #155dfc');
        expect(m.html).not.toContain('<img');
        const withLogo = composeReminder({ ...base, brand: { logoUrl: 'https://cdn.example/logo.png' } });
        expect(withLogo.html).toMatch(/<img src="https:\/\/cdn\.example\/logo\.png" alt="Pen Shop" width="140"/);
    });
    it('rejects unsafe accent and logo values, escapes everything', () => {
        expect(accentOf('red;background:url(x)')).toBe('#155dfc');
        expect(safeUrl('javascript:alert(1)')).toBeNull();
        const m = composeReminder({ ...base, shop: '<b>Shop</b>', items: [{ qty: 1, name: '<script>x</script>' }], brand: { logoUrl: 'javascript:alert(1)', footerText: '<i>legal</i>' } });
        expect(m.html).not.toContain('<script>');
        expect(m.html).not.toContain('<b>Shop</b>');
        expect(m.html).not.toContain('<i>legal</i>');
        expect(m.html).not.toContain('javascript:');
    });
    it('subject replacement does not treat a shop name as a replacement pattern ($& and $\')', () => {
        const m = composeReminder({ ...base, shop: "Bob$'s $& Pens" });
        expect(m.subject).toBe("Still want it? £12.50 at Bob$'s $& Pens");
    });
    it('lists at most eight items and says how many more', () => {
        const items = Array.from({ length: 11 }, (_, i) => ({ qty: 1, name: `Item ${i}` }));
        const m = composeReminder({ ...base, items });
        expect(m.text).toContain('and 3 more');
        expect(m.html).toContain('and 3 more');
    });
    it('renderEmail without footer text or unsubscribe has no footer strip', () => {
        const html = renderEmail({ brand: { storeName: 'S' }, heading: 'H', bodyHtml: '' });
        expect(html).not.toContain('font-size:11px');
    });
});

describe('0.21.0 e-mail settings', () => {
    it('keep valid colour, https logo and support address; clear invalid ones; existing installs default to empty', () => {
        expect(DEFAULT_VA_SETTINGS.reminders.accentColor).toBe('');
        const s = sanitiseSettings({ reminders: { accentColor: '#AABBCC', logoUrl: 'https://x.example/l.png', supportEmail: 'Help@X.example', footerText: 'Ltd\r\nAddress' } });
        expect(s.reminders).toMatchObject({ accentColor: '#aabbcc', logoUrl: 'https://x.example/l.png', supportEmail: 'help@x.example', footerText: 'Ltd\nAddress' });
        const bad = sanitiseSettings({ reminders: { accentColor: 'red', logoUrl: 'javascript:alert(1)', supportEmail: 'nope' } }, s);
        expect(bad.reminders).toMatchObject({ accentColor: '', logoUrl: '', supportEmail: '' });
        // A patch without the fields keeps them.
        expect(sanitiseSettings({ cookieless: true }, s).reminders.accentColor).toBe('#aabbcc');
    });
});

describe('0.21.0 fixes', () => {
    it('the opt-out confirm form gets an HTML page; one-click POSTs keep JSON', () => {
        expect(wantsHtml({ headers: { accept: 'text/html,application/xhtml+xml' }, body: {} })).toBe(true);
        expect(wantsHtml({ headers: { accept: '*/*' }, body: { 'List-Unsubscribe': 'One-Click' } })).toBe(false);
        expect(wantsHtml({ headers: { accept: 'text/html' }, body: { 'List-Unsubscribe': 'One-Click' } })).toBe(false);
        expect(wantsHtml({ headers: {} })).toBe(false);
    });
    it('public recommendation routes are rate limited per client IP', () => {
        const limiter = new RateLimiter({ capacity: 3, windowMs: 60_000 });
        const req: any = { ip: '203.0.113.9', headers: {}, socket: { remoteAddress: '203.0.113.9' } };
        for (let i = 0; i < 3; i++) expect(() => assertRecsBudget(req, [], limiter)).not.toThrow();
        expect(() => assertRecsBudget(req, [], limiter)).toThrow();
        expect(() => assertRecsBudget({ ...req, ip: '203.0.113.10', socket: { remoteAddress: '203.0.113.10' } }, [], limiter)).not.toThrow();
    });
    it('the weekly report routes refuse channel-scoped administrators', () => {
        const res: any = { code: 0, body: null, status(c: number) { this.code = c; return this; }, json(b: any) { this.body = b; return this; } };
        const ch2: any = { channelId: 2, session: { user: { channelPermissions: [{ id: 2, code: 'second', permissions: ['ReadCustomer', 'UpdateSettings'] }] } } };
        expect(requireAllChannelsAdmin(ch2, res, 'UpdateSettings')).toBe(false);
        expect(res.code).toBe(403);
        const def: any = { channelId: 1, session: { user: { channelPermissions: [{ id: 1, code: '__default_channel__', permissions: ['ReadCustomer', 'UpdateSettings'] }] } } };
        expect(requireAllChannelsAdmin(def, res, 'UpdateSettings')).toBe(true);
    });
});
