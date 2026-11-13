import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';
import { adapterFor } from '@huloglobal/vendure-licence-sdk';
import { createHash } from 'crypto';
import { normaliseEmailAddress } from './privacy-utils';

export interface PrivacySubject { email?: string; customerId?: number; visitorId?: string }

const VID_RE = /^[A-Za-z0-9:_-]{8,64}$/;

/**
 * Personal-data export and erase (0.20.0, free) for one person: by e-mail
 * address (their customer record and every visitor id it was seen under),
 * by customer id, or by a visitor id. Covers visitor events, abandoned carts,
 * server-side cart captures and payment-goal completions. The opt-out record
 * of an address is reported but kept: it is what stops reminders reaching
 * someone who asked for none.
 */
@Injectable()
export class VaPrivacyService {
    constructor(private readonly connection: TransactionalConnection) {}

    private get db() { return adapterFor(this.connection.rawConnection); }

    /** Validate the subject and resolve its customer ids and visitor ids. */
    async resolve(subject: PrivacySubject): Promise<{ email: string | null; customerIds: number[]; visitorIds: string[] } | { error: string }> {
        const email = subject.email ? normaliseEmailAddress(subject.email) : null;
        if (subject.email && !email) return { error: 'email is not an e-mail address' };
        const cid = subject.customerId != null ? Math.trunc(Number(subject.customerId)) : null;
        if (subject.customerId != null && !(cid! > 0)) return { error: 'customerId is not valid' };
        const vid = subject.visitorId ? String(subject.visitorId) : null;
        if (vid && !VID_RE.test(vid)) return { error: 'visitorId is not valid' };
        if (!email && !cid && !vid) return { error: 'give an email, customerId or visitorId' };
        const customerIds = new Set<number>();
        if (cid) customerIds.add(cid);
        if (email) {
            const rows: any[] = await this.db.query(`SELECT id FROM customer WHERE LOWER(\`emailAddress\`) = ?`, [email]);
            for (const r of rows) customerIds.add(Number(r.id));
        }
        const visitorIds = new Set<string>();
        if (vid) visitorIds.add(vid);
        const ids = [...customerIds];
        if (ids.length) {
            const rows: any[] = await this.db.query(`SELECT DISTINCT \`visitorId\` FROM visitor_event WHERE \`customerId\` IN (${ids.map(() => '?').join(',')}) LIMIT 1000`, ids);
            for (const r of rows) visitorIds.add(String(r.visitorId));
        }
        if (email) {
            const rows: any[] = await this.db.query(`SELECT DISTINCT \`visitorId\` FROM abandoned_cart WHERE \`emailHash\` = ? LIMIT 1000`, [this.hash(email)]);
            for (const r of rows) visitorIds.add(String(r.visitorId));
        }
        return { email, customerIds: ids, visitorIds: [...visitorIds] };
    }

    private hash(email: string): string { return createHash('sha256').update(email).digest('hex'); }

    private inList(col: string, values: any[]): { sql: string; params: any[] } {
        return values.length ? { sql: `${col} IN (${values.map(() => '?').join(',')})`, params: values } : { sql: '1=0', params: [] };
    }

    /** Everything held about the subject, as JSON. Events are capped at 10 000 (newest first). */
    async export(subject: PrivacySubject): Promise<any> {
        const r = await this.resolve(subject);
        if ('error' in r) return r;
        const v = this.inList('`visitorId`', r.visitorIds);
        const c = this.inList('`customerId`', r.customerIds);
        const events = await this.db.query(
            `SELECT \`createdAt\`, \`visitorId\`, \`sessionId\`, \`customerId\`, \`channelId\`, type, url, title, referrer, ip, \`userAgent\`, browser, os, device, country, region, city, \`utmSource\`, \`utmMedium\`, \`utmCampaign\`, meta
             FROM visitor_event WHERE ${v.sql} OR ${c.sql} ORDER BY id DESC LIMIT 10000`, [...v.params, ...c.params]);
        const cartWhere = r.email ? `(\`emailHash\` = ? OR ${c.sql} OR ${v.sql})` : `(${c.sql} OR ${v.sql})`;
        const cartParams = r.email ? [this.hash(r.email), ...c.params, ...v.params] : [...c.params, ...v.params];
        const carts = await this.db.query(
            `SELECT id, \`createdAt\`, \`abandonedAt\`, status, currency, \`totalMinor\`, \`itemsJson\`, email, \`firstName\`, \`lastName\`, phone, ip, \`userAgent\`, city, \`countryCode\`, \`emailsSent\`, \`lastEmailAt\`
             FROM abandoned_cart WHERE ${cartWhere} LIMIT 1000`, cartParams);
        const captures = r.email || r.customerIds.length
            ? await this.db.query(`SELECT orderCode, email, totalMinor, currency, itemsJson, lastChangedAt, placedAt FROM va_order_cart WHERE ${r.email ? 'email = ? OR ' : ''}${this.inList('customerId', r.customerIds).sql} LIMIT 1000`,
                [...(r.email ? [r.email] : []), ...r.customerIds]).catch(() => [])
            : [];
        const optOut = r.email ? await this.db.query(`SELECT email, source, createdAt FROM abandoned_cart_opt_out WHERE emailHash = ?`, [this.hash(r.email)]).catch(() => []) : [];
        return { subject: { email: r.email, customerIds: r.customerIds, visitorIds: r.visitorIds }, exportedAt: new Date().toISOString(), visitorEvents: events, abandonedCarts: carts, serverCartCaptures: captures, reminderOptOut: optOut[0] || null };
    }

    /** Delete the subject's analytics data. Returns what was removed. */
    async erase(subject: PrivacySubject): Promise<any> {
        const r = await this.resolve(subject);
        if ('error' in r) return r;
        const n = (res: any) => Number(res?.affectedRows ?? res?.rowCount ?? 0);
        const v = this.inList('`visitorId`', r.visitorIds);
        const c = this.inList('`customerId`', r.customerIds);
        const events = n(await this.db.query(`DELETE FROM visitor_event WHERE ${v.sql} OR ${c.sql}`, [...v.params, ...c.params], { needAffected: true }));
        const cartWhere = r.email ? `(\`emailHash\` = ? OR ${c.sql} OR ${v.sql})` : `(${c.sql} OR ${v.sql})`;
        const cartParams = r.email ? [this.hash(r.email), ...c.params, ...v.params] : [...c.params, ...v.params];
        const carts = n(await this.db.query(`DELETE FROM abandoned_cart WHERE ${cartWhere}`, cartParams, { needAffected: true }));
        let captures = 0;
        if (r.email || r.customerIds.length) {
            captures = n(await this.db.query(`DELETE FROM va_order_cart WHERE ${r.email ? 'email = ? OR ' : ''}${this.inList('customerId', r.customerIds).sql}`,
                [...(r.email ? [r.email] : []), ...r.customerIds], { needAffected: true }).catch(() => null));
        }
        const goals = r.visitorIds.length ? n(await this.db.query(`DELETE FROM va_goal_payment WHERE ${this.inList('visitorId', r.visitorIds).sql}`, r.visitorIds, { needAffected: true }).catch(() => null)) : 0;
        return { erased: { visitorEvents: events, abandonedCarts: carts, serverCartCaptures: captures, goalPayments: goals }, keptOptOut: !!r.email, subject: { email: r.email, customerIds: r.customerIds, visitorIds: r.visitorIds.length } };
    }
}
