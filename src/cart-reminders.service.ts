import { Injectable, Logger } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { adapterFor, smtpTransportFromEnv } from '@huloglobal/vendure-licence-sdk';
import { AbandonedCartService } from './abandoned-cart.service';
import { ReminderSettings } from './va-settings';
import { hashEmail } from './recovery-tokens';
import { EmailBrand } from './email-layout';
import { getOptions } from './plugin';

const loggerCtx = 'HuloCartReminders';

/** E-mail branding: the admin's Settings first, then the plugin's `email` options. */
export function reminderBrand(r: ReminderSettings, shop: string): EmailBrand {
    const o: any = (getOptions() as any).email || {};
    return {
        storeName: shop,
        accentColor: r.accentColor || o.accentColor || null,
        logoUrl: r.logoUrl || o.logoUrl || null,
        logoWidth: o.logoWidth || null,
        supportEmail: r.supportEmail || o.supportEmail || null,
        footerText: r.footerText || o.footerText || null,
    };
}

/** At most one reminder sequence per address in this window, however many carts it has. */
export const ADDRESS_COOLDOWN_DAYS = 7;

export { reminderStepDue, composeReminder } from './reminder-mail';
import { reminderStepDue, composeReminder } from './reminder-mail';

/**
 * Abandoned-cart reminder e-mails (0.20.0, premium, off until enabled in
 * Visitors → Settings). Deliverability and consent rules:
 * - only carts with an e-mail address, verified unless the admin allowed
 *   any captured address; opted-out addresses never (checked at send time);
 * - each cart at most two reminders, each claimed with a compare-and-set on
 *   `emailsSent`, so overlapping workers never send twice;
 * - one reminder sequence per address per 7 days, whatever its carts;
 * - at most `maxPerRun` per scan (every 5 minutes);
 * - a working recovery link (`abandonment.recoveryLinkSecret`) and opt-out
 *   link are required: without them nothing is sent;
 * - `List-Unsubscribe` / one-click headers on every message.
 */
@Injectable()
export class CartRemindersService {
    constructor(private readonly connection: TransactionalConnection, private readonly carts: AbandonedCartService) {}

    private get db() { return adapterFor(this.connection.rawConnection); }

    async sendDue(r: ReminderSettings, verifiedOnly: boolean, now = new Date()): Promise<{ sent: number; skipped: string | null }> {
        if (!r.enabled) return { sent: 0, skipped: 'disabled' };
        const transport = smtpTransportFromEnv();
        if (!transport) return { sent: 0, skipped: 'smtp-not-configured' };
        const steps = r.secondAfterHours > 0 ? 2 : 1;
        const rows: any[] = await this.db.query(
            `SELECT ac.id, ac.email, ac.\`emailHash\`, ac.currency, ac.\`totalMinor\`, ac.\`itemsJson\`, ac.\`emailsSent\`, ac.\`lastEmailAt\`, ac.\`abandonedAt\`, ac.\`resumeOrderCode\`, ac.\`recoveryStep\`, ch.code AS \`channelCode\`
             FROM abandoned_cart ac LEFT JOIN channel ch ON ch.id = ac.\`channelId\`
             WHERE ac.status = 'abandoned' AND ac.email IS NOT NULL AND ac.\`emailsSent\` < ? AND ac.\`totalMinor\` >= ?
               AND (ac.\`recoveryStep\` IS NULL OR ac.\`recoveryStep\` = 'link_issued')
               AND ac.\`abandonedAt\` <= ? AND ac.\`abandonedAt\` >= DATE_SUB(NOW(), INTERVAL 30 DAY)
               ${verifiedOnly ? 'AND ac.`emailVerified` = TRUE' : ''}
             ORDER BY ac.id LIMIT 200`,
            [steps, r.minValueMinor, new Date(now.getTime() - r.firstAfterHours * 3600_000)],
        );
        let sent = 0;
        for (const row of rows) {
            if (sent >= r.maxPerRun) break;
            const step = reminderStepDue({ emailsSent: Number(row.emailsSent || 0), abandonedAt: row.abandonedAt, lastEmailAt: row.lastEmailAt }, r, now.getTime());
            if (!step) continue;
            if (await this.carts.isOptedOut(row.email)) continue;
            const optOutUrl = this.carts.buildOptOutLink(row.email);
            const headers = this.carts.buildListUnsubscribeHeaders(row.email);
            if (!optOutUrl || !headers) return { sent, skipped: 'no-opt-out-secret' };
            if (!(await this.claim(row, now))) continue;
            const recoveryUrl = await this.carts.issueRecoveryLink(Number(row.id));
            if (!recoveryUrl) {
                await this.unclaim(row);
                return { sent, skipped: 'no-recovery-link-secret' };
            }
            let items: any[] = [];
            try { items = JSON.parse(row.itemsJson || '[]'); } catch { items = []; }
            const shop = r.shopName || (row.channelCode && row.channelCode !== '__default_channel__' ? row.channelCode : 'our shop');
            const mail = composeReminder({ step, shop, subject: r.subject, items, totalMinor: Number(row.totalMinor) || 0, currency: row.currency || 'GBP', recoveryUrl, optOutUrl, brand: reminderBrand(r, shop) });
            try {
                await transport.sendMail({ to: row.email, ...mail, headers } as any);
                sent++;
            } catch (e: any) {
                // The claim stays: a failing address must not be retried every five minutes.
                Logger.warn(`reminder ${step} for cart ${row.id} not sent: ${e?.message}`, loggerCtx);
            }
        }
        if (sent) Logger.log(`Sent ${sent} abandoned-cart reminder(s)`, loggerCtx);
        return { sent, skipped: null };
    }

    /** Address cooldown, then compare-and-set the cart's counter. */
    private async claim(row: any, now: Date): Promise<boolean> {
        const hash = row.emailHash || hashEmail(String(row.email).toLowerCase());
        const recent: any[] = await this.db.query(
            `SELECT id FROM abandoned_cart WHERE \`emailHash\` = ? AND id <> ? AND \`lastEmailAt\` >= DATE_SUB(NOW(), INTERVAL ${ADDRESS_COOLDOWN_DAYS} DAY) LIMIT 1`,
            [hash, row.id],
        ).catch(() => [{ id: 0 }]);
        if (recent.length) return false;
        const res = await this.db.query(
            `UPDATE abandoned_cart SET \`emailsSent\` = \`emailsSent\` + 1, \`lastEmailAt\` = ? WHERE id = ? AND \`emailsSent\` = ? AND status = 'abandoned'`,
            [now, row.id, Number(row.emailsSent || 0)],
            { needAffected: true },
        );
        return Number(res?.affectedRows ?? res?.rowCount ?? 0) > 0;
    }

    private async unclaim(row: any): Promise<void> {
        await this.db.query(`UPDATE abandoned_cart SET \`emailsSent\` = ?, \`lastEmailAt\` = ? WHERE id = ?`, [Number(row.emailsSent || 0), row.lastEmailAt || null, row.id]).catch(() => undefined);
    }
}
