import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, PaymentStateTransitionEvent, TransactionalConnection } from '@vendure/core';
import { adapterFor } from '@huloglobal/vendure-licence-sdk';
import { globMatch } from './url-pattern';
import { VisitorEvent } from './visitor-event.entity';
import { GoalType } from './goal-rules';

export { GOAL_TYPES, GoalType, GoalInput, CleanGoal, cleanGoal, patternForUrl } from './goal-rules';
import { patternForUrl } from './goal-rules';

const loggerCtx = 'HuloVisitorGoals';

export interface GoalSuggestion { type: GoalType; name: string; urlPattern: string; target: string; reason: string }

/**
 * Conversion goals (0.20.0): the schema for goal types, payment goals recorded
 * from Vendure's own payment events, data-driven goal suggestions and the
 * per-goal completions report.
 */
@Injectable()
export class GoalsService implements OnApplicationBootstrap {
    constructor(private readonly connection: TransactionalConnection, private readonly eventBus: EventBus) {}

    private get db() { return adapterFor(this.connection.rawConnection); }

    async onApplicationBootstrap(): Promise<void> {
        try { await this.ensureSchema(); } catch (e: any) { Logger.warn(`goal schema check failed (retried next boot): ${e?.message}`, loggerCtx); }
        this.eventBus.ofType(PaymentStateTransitionEvent).subscribe(ev => {
            if (ev.toState !== 'Settled') return;
            this.onPaymentSettled(ev).catch((e: any) => Logger.warn(`payment goal for ${ev.order?.code}: ${e?.message}`, loggerCtx));
        });
    }

    /** Goal type/target columns (installs that never synchronise plugin entities) and the payment-completion table. */
    async ensureSchema(): Promise<void> {
        await this.addColumnIfMissing('conversion_goal', 'type', `VARCHAR(16) NOT NULL DEFAULT 'page'`);
        await this.addColumnIfMissing('conversion_goal', 'target', `VARCHAR(200) NOT NULL DEFAULT ''`);
        await this.db.query(`
            CREATE TABLE IF NOT EXISTS va_goal_payment (
                id INT AUTO_INCREMENT PRIMARY KEY,
                goalId INT NOT NULL,
                channelId INT NOT NULL,
                paymentId VARCHAR(64) NOT NULL,
                orderCode VARCHAR(64) NOT NULL,
                amountMinor INT NOT NULL DEFAULT 0,
                currency VARCHAR(16) NULL,
                visitorId VARCHAR(64) NULL,
                createdAt DATETIME NOT NULL,
                UNIQUE KEY uq_va_goal_payment (goalId, paymentId),
                INDEX idx_va_goal_payment_created (goalId, createdAt)
            )`);
    }

    private async addColumnIfMissing(goalTable: string, goalColumn: string, goalDdl: string): Promise<void> {
        const scope = this.db.dialect === 'postgres' ? 'table_catalog = current_database() AND table_schema = current_schema()' : 'table_schema = DATABASE()';
        const rows: any[] = await this.db.query(
            `SELECT COUNT(*) AS n FROM information_schema.columns WHERE ${scope} AND LOWER(table_name) = LOWER(?) AND LOWER(column_name) = LOWER(?)`,
            [goalTable, goalColumn],
        ).catch(() => []);
        if (Number(rows?.[0]?.n ?? rows?.[0]?.N ?? 0) > 0) return;
        try { await this.db.query(`ALTER TABLE ${goalTable} ADD COLUMN \`${goalColumn}\` ${goalDdl}`); }
        catch (e: any) { if (!/duplicate|exists/i.test(String(e?.message || ''))) throw e; }
    }

    private premium(): boolean {
        // Lazy: plugin.ts imports this file.
        const { VisitorAnalyticsPlugin } = require('./plugin');
        return VisitorAnalyticsPlugin.hasPremiumAccess();
    }

    /** A Vendure payment settled: one completion of the first matching payment goal of the order's channel (premium). */
    async onPaymentSettled(ev: PaymentStateTransitionEvent): Promise<number> {
        if (!this.premium()) return 0;
        const order: any = ev.order;
        const payment: any = ev.payment;
        if (!order?.code || !payment?.id) return 0;
        const channelId = Number(ev.ctx?.channelId) || 1;
        const goals: any[] = await this.db.query(
            `SELECT id, target FROM conversion_goal WHERE \`channelId\` = ? AND enabled = TRUE AND type = 'payment' ORDER BY id`, [channelId],
        ).catch(() => []);
        const goal = goals.find(g => globMatch(String(g.target || ''), String(payment.method || '')));
        if (!goal) return 0;
        const who = await this.attribute(order.code, order.customerId ?? order.customer?.id ?? null);
        const ins = await this.db.query(
            `INSERT IGNORE INTO va_goal_payment (goalId, channelId, paymentId, orderCode, amountMinor, currency, visitorId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [Number(goal.id), channelId, String(payment.id).slice(0, 64), String(order.code).slice(0, 64), Math.max(0, Math.trunc(Number(payment.amount) || 0)), String(order.currencyCode || '').slice(0, 3) || null, who.visitorId],
            { conflictColumns: ['goalId', 'paymentId'], needAffected: true },
        );
        if (Number(ins?.affectedRows ?? ins?.rowCount ?? 0) < 1) return 0; // already counted
        const repo = this.connection.rawConnection.getRepository(VisitorEvent);
        await repo.insert(repo.create({
            visitorId: who.visitorId, sessionId: who.sessionId, customerId: who.customerId, channelId,
            type: 'payment', url: '', title: `Order ${order.code}`, isBot: false, goalId: Number(goal.id),
            meta: JSON.stringify({ orderCode: order.code, paymentMethod: payment.method, amountMinor: Number(payment.amount) || 0 }),
        } as any));
        return Number(goal.id);
    }

    /** The visit that placed an order: its `checkout_completed` event, else the customer's latest visit, else the order itself. */
    async attribute(orderCode: string, customerId: number | null): Promise<{ visitorId: string; sessionId: string; customerId: number | null }> {
        const code = String(orderCode).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
        const viaEvent: any[] = await this.db.query(
            `SELECT \`visitorId\`, \`sessionId\` FROM visitor_event
             WHERE type = 'event' AND \`createdAt\` >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND meta LIKE ?
             ORDER BY id DESC LIMIT 1`, [`%"orderCode":"${code}"%`],
        ).catch(() => []);
        if (viaEvent[0]) return { visitorId: viaEvent[0].visitorId, sessionId: viaEvent[0].sessionId, customerId };
        if (customerId) {
            const viaCustomer: any[] = await this.db.query(
                `SELECT \`visitorId\`, \`sessionId\` FROM visitor_event WHERE \`customerId\` = ? AND \`createdAt\` >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY id DESC LIMIT 1`, [customerId],
            ).catch(() => []);
            if (viaCustomer[0]) return { visitorId: viaCustomer[0].visitorId, sessionId: viaCustomer[0].sessionId, customerId };
        }
        return { visitorId: `order:${code}`.slice(0, 64), sessionId: `order:${code}`.slice(0, 64), customerId };
    }

    /** Per-goal completions, unique visitors and value over the last `days` days (bots excluded). */
    async stats(channelId: number, days: number): Promise<any[]> {
        const rows: any[] = await this.db.query(
            `SELECT g.id, g.name, g.type, g.target, g.\`urlPattern\`, g.\`valueMinor\`, g.enabled,
                    COUNT(DISTINCT v.\`visitorId\`) AS \`uniqueVisitors\`,
                    COUNT(DISTINCT v.\`sessionId\`) AS sessions,
                    COUNT(v.id) AS completions
             FROM conversion_goal g
             LEFT JOIN visitor_event v
                ON v.\`goalId\` = g.id
               AND v.\`createdAt\` >= DATE_SUB(NOW(), INTERVAL ? DAY)
               AND v.\`isBot\` = FALSE
             WHERE g.\`channelId\` = ?
             GROUP BY g.id, g.name, g.type, g.target, g.\`urlPattern\`, g.\`valueMinor\`, g.enabled
             ORDER BY g.id`,
            [days, channelId],
        );
        const paid: any[] = await this.db.query(
            `SELECT goalId, SUM(amountMinor) AS paid FROM va_goal_payment WHERE channelId = ? AND createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY goalId`,
            [channelId, days],
        ).catch(() => []);
        const paidBy = new Map(paid.map(p => [Number(p.goalId), Number(p.paid) || 0]));
        return rows.map(r => {
            const completions = Number(r.completions) || 0;
            const unit = Number(r.valueMinor) || 0;
            const type = String(r.type || 'page');
            return {
                id: Number(r.id), name: r.name, type, target: r.target || '', urlPattern: r.urlPattern || '', enabled: !!Number(r.enabled ?? 1),
                unitValueMinor: unit, completions, uniqueVisitors: Number(r.uniqueVisitors) || 0, sessions: Number(r.sessions) || 0,
                // Payment goals without a fixed value are worth what was paid.
                valueMinor: type === 'payment' && unit === 0 ? paidBy.get(Number(r.id)) || 0 : unit * completions,
            };
        });
    }

    /** Ready-made goals from the last 30 days of traffic, minus the goals that already exist (premium). */
    async suggestions(channelId: number): Promise<GoalSuggestion[]> {
        const existing: any[] = await this.db.query(`SELECT type, \`urlPattern\`, target FROM conversion_goal WHERE \`channelId\` = ?`, [channelId]).catch(() => []);
        const taken = (type: string, urlPattern: string, target: string) => existing.some(g => String(g.type || 'page') === type && String(g.urlPattern || '') === urlPattern && String(g.target || '') === target);
        const out: GoalSuggestion[] = [];
        const confirm: any[] = await this.db.query(
            `SELECT url, COUNT(*) AS n FROM visitor_event
             WHERE \`channelId\` = ? AND type = 'pageview' AND \`createdAt\` >= DATE_SUB(NOW(), INTERVAL 30 DAY)
               AND (url LIKE '%confirmation%' OR url LIKE '%thank%' OR url LIKE '%order-received%' OR url LIKE '%success%')
             GROUP BY url ORDER BY n DESC LIMIT 1`, [channelId],
        ).catch(() => []);
        const orderPattern = confirm[0]?.url ? patternForUrl(String(confirm[0].url)) : '/checkout/confirmation/**';
        out.push({ type: 'page', name: 'Order placed', urlPattern: orderPattern, target: '', reason: confirm[0] ? `${Number(confirm[0].n)} visits to ${confirm[0].url} in 30 days` : 'Vendure storefront default confirmation page' });
        out.push({ type: 'payment', name: 'Payment received', urlPattern: '', target: '', reason: 'Counts every settled Vendure payment, worth the amount paid' });
        const forms: any[] = await this.db.query(
            `SELECT meta, COUNT(*) AS n FROM visitor_event
             WHERE \`channelId\` = ? AND type = 'form_submit' AND \`createdAt\` >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY meta ORDER BY n DESC LIMIT 20`, [channelId],
        ).catch(() => []);
        const seen = new Set<string>();
        for (const f of forms) {
            let id = '';
            try { const m = JSON.parse(f.meta || '{}'); id = String(m.formId || m.form || m.label || ''); } catch { id = ''; }
            id = id.replace(/[^A-Za-z0-9 _.:#/\-[\]]/g, '').slice(0, 200);
            if (!id || seen.has(id) || seen.size >= 3) continue;
            seen.add(id);
            out.push({ type: 'form', name: `Form sent: ${id}`.slice(0, 128), urlPattern: '', target: id, reason: `${Number(f.n)} submissions in 30 days` });
        }
        const signup: any[] = await this.db.query(
            `SELECT url, COUNT(*) AS n FROM visitor_event
             WHERE \`channelId\` = ? AND type = 'pageview' AND \`createdAt\` >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND (url LIKE '%verify%' OR url LIKE '%welcome%' OR url LIKE '%register/success%')
             GROUP BY url ORDER BY n DESC LIMIT 1`, [channelId],
        ).catch(() => []);
        if (signup[0]?.url) out.push({ type: 'page', name: 'Account created', urlPattern: patternForUrl(String(signup[0].url)), target: '', reason: `${Number(signup[0].n)} visits to ${signup[0].url} in 30 days` });
        return out.filter(s => !taken(s.type, s.urlPattern, s.target));
    }
}
