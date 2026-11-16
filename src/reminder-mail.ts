import { ReminderSettings } from './va-settings';
import { accentOf, block, EmailBrand, esc, renderEmail, textSignOff } from './email-layout';

function money(minor: number, currency: string): string {
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((minor || 0) / 100); } catch { return `${currency} ${((minor || 0) / 100).toFixed(2)}`; }
}

/** Which reminder (1 or 2) a cart is due for now, or 0. Pure: the scan's SQL pre-filters, this decides. */
export function reminderStepDue(cart: { emailsSent: number; abandonedAt: Date | string; lastEmailAt?: Date | string | null }, r: ReminderSettings, now = Date.now()): 0 | 1 | 2 {
    const since = now - new Date(cart.abandonedAt).getTime();
    const sent = Number(cart.emailsSent || 0);
    if (sent === 0 && since >= r.firstAfterHours * 3600_000) return 1;
    if (sent === 1 && r.secondAfterHours > 0 && since >= r.secondAfterHours * 3600_000
        && (!cart.lastEmailAt || now - new Date(cart.lastEmailAt).getTime() >= 3600_000)) return 2;
    return 0;
}

/** The reminder e-mail (0.21.0: the shared card design): plain text and HTML, the items, the total, the recovery link and an unsubscribe line. */
export function composeReminder(input: { step: 1 | 2; shop: string; subject: string; items: any[]; totalMinor: number; currency: string; recoveryUrl: string; optOutUrl: string | null; brand?: Partial<EmailBrand> }) {
    const total = money(input.totalMinor, input.currency);
    // Function replacers: a shop name like "Bob$'s" must not be read as a replacement pattern.
    const subject = input.subject.replace(/\{\{\s*total\s*\}\}/g, () => total).replace(/\{\{\s*shop\s*\}\}/g, () => input.shop).slice(0, 150);
    const brand: EmailBrand = { ...(input.brand || {}), storeName: input.brand?.storeName || input.shop };
    const accent = accentOf(brand.accentColor);
    const items = (input.items || []).slice(0, 8).map(i => {
        const qty = Math.max(1, Number(i?.qty ?? 1) || 1);
        const unit = Number(i?.unitPriceMinor);
        return { qty, name: String(i?.name ?? 'Item').slice(0, 120), price: Number.isFinite(unit) && unit > 0 ? money(unit * qty, input.currency) : '' };
    });
    const more = Math.max(0, (input.items || []).length - items.length);
    const lines = items.map(i => `${i.qty} × ${i.name}${i.price ? ` (${i.price})` : ''}`);
    const heading = input.step === 1 ? 'You left something in your basket' : 'Your basket is still waiting';
    const intro = input.step === 1
        ? `You left ${items.length === 1 && more === 0 ? 'an item' : 'some items'} in your basket at ${input.shop}. We have saved it for you, so you can pick up where you left off.`
        : `Your basket at ${input.shop} is still saved. You can complete your order whenever you are ready.`;
    const text = [
        'Hello,', '', intro, '', ...lines, ...(more ? [`and ${more} more`] : []), '', `Total: ${total}`, '',
        `Return to your basket: ${input.recoveryUrl}`, '',
        ...textSignOff(brand),
        ...(brand.footerText ? ['', brand.footerText] : []),
        ...(input.optOutUrl ? ['', `You are receiving this because you started an order at ${input.shop}. Don't want these reminders? Unsubscribe: ${input.optOutUrl}`] : []),
    ].join('\n');
    const rows = items.map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;line-height:20px;color:#111827;">${esc(i.name)}<div style="font-size:12px;color:#6b7280;">Quantity ${esc(i.qty)}</div></td>` +
        `<td align="right" style="padding:8px 0 8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;font-weight:bold;white-space:nowrap;">${esc(i.price)}</td></tr>`).join('');
    const box = block.label('Your basket') +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">${rows}` +
        (more ? `<tr><td colspan="2" style="padding:8px 0;font-size:13px;color:#6b7280;">and ${esc(more)} more</td></tr>` : '') +
        `<tr><td style="padding:10px 0 0 0;font-size:14px;color:#6b7280;">Total</td><td align="right" style="padding:10px 0 0 0;font-size:16px;font-weight:bold;color:#111827;white-space:nowrap;">${esc(total)}</td></tr></table>`;
    const html = renderEmail({
        brand,
        preheader: `${input.shop}: your basket of ${total} is saved.`,
        heading,
        bodyHtml: block.text('Hello,') + block.text(intro) + block.info(box) + block.button(input.recoveryUrl, 'Return to your basket', accent),
        footerHtml: input.optOutUrl
            ? `You are receiving this because you started an order at ${esc(input.shop)}. Don't want these reminders? <a href="${esc(input.optOutUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>.`
            : undefined,
    });
    return { subject, text, html };
}
