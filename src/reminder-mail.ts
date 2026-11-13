import { ReminderSettings } from './va-settings';

const escHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

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

/** The reminder e-mail: plain text first, a light HTML version, the recovery link and an unsubscribe line. */
export function composeReminder(input: { step: 1 | 2; shop: string; subject: string; items: any[]; totalMinor: number; currency: string; recoveryUrl: string; optOutUrl: string | null }) {
    const total = money(input.totalMinor, input.currency);
    const subject = input.subject.replace(/\{\{\s*total\s*\}\}/g, total).replace(/\{\{\s*shop\s*\}\}/g, input.shop).slice(0, 150);
    const lines = (input.items || []).slice(0, 8).map(i => `${Number(i?.qty ?? 1)} × ${String(i?.name ?? 'Item').slice(0, 120)}`);
    const intro = input.step === 1
        ? `You left ${lines.length === 1 ? 'an item' : 'some items'} in your basket at ${input.shop}.`
        : `Your basket at ${input.shop} is still waiting for you.`;
    const text = [
        'Hello,', '', intro, '', ...lines, '', `Total: ${total}`, '',
        `Pick up where you left off: ${input.recoveryUrl}`, '',
        input.optOutUrl ? `Don't want these reminders? Unsubscribe: ${input.optOutUrl}` : '',
    ].join('\n');
    const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24;line-height:1.5">
<p>Hello,</p><p>${escHtml(intro)}</p><ul>${lines.map(l => `<li>${escHtml(l)}</li>`).join('')}</ul><p><strong>Total: ${escHtml(total)}</strong></p>
<p><a href="${escHtml(input.recoveryUrl)}" style="display:inline-block;background:#1b1f24;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Return to your basket</a></p>
${input.optOutUrl ? `<p style="font-size:12px;color:#6b7280">Don't want these reminders? <a href="${escHtml(input.optOutUrl)}">Unsubscribe</a>.</p>` : ''}
</body></html>`;
    return { subject, text, html };
}

