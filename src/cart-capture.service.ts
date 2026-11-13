import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, OrderLineEvent, OrderPlacedEvent, TransactionalConnection } from '@vendure/core';
import { adapterFor } from '@huloglobal/vendure-licence-sdk';
import { createHash } from 'crypto';
import { VaSettingsService } from './va-settings.service';

const loggerCtx = 'HuloCartCapture';

/**
 * Server-side cart capture (0.20.0, premium, off until enabled in Visitors →
 * Settings). Carts are read from Vendure's own order events, so abandonment
 * works without the storefront firing `cart_snapshot`:
 * - every order-line change refreshes a `va_order_cart` row (debounced per order);
 * - the 5-minute scan turns rows idle for the abandonment window, whose order
 *   is still `AddingItems` / `ArrangingPayment`, into `abandoned_cart` rows
 *   (session `order:<code>`, bound to the order so the recovery link resumes it,
 *   the order customer's address marked verified);
 * - `OrderPlacedEvent` marks the capture placed and its abandoned cart converted.
 */
@Injectable()
export class CartCaptureService implements OnApplicationBootstrap {
    private pending = new Map<string, NodeJS.Timeout>();

    constructor(private readonly connection: TransactionalConnection, private readonly eventBus: EventBus, private readonly settings: VaSettingsService) {}

    private get db() { return adapterFor(this.connection.rawConnection); }

    private premium(): boolean {
        const { VisitorAnalyticsPlugin } = require('./plugin');
        return VisitorAnalyticsPlugin.hasPremiumAccess();
    }

    private async active(): Promise<boolean> {
        return this.premium() && (await this.settings.get()).serverCartCapture;
    }

    async onApplicationBootstrap(): Promise<void> {
        try {
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS va_order_cart (
                    orderId VARCHAR(36) NOT NULL PRIMARY KEY,
                    orderCode VARCHAR(64) NOT NULL,
                    channelId INT NOT NULL DEFAULT 1,
                    customerId INT NULL,
                    email VARCHAR(255) NULL,
                    currency VARCHAR(16) NOT NULL DEFAULT 'GBP',
                    totalMinor INT NOT NULL DEFAULT 0,
                    itemCount INT NOT NULL DEFAULT 0,
                    itemsJson TEXT NULL,
                    lastChangedAt DATETIME NOT NULL,
                    placedAt DATETIME NULL,
                    INDEX idx_va_order_cart_idle (placedAt, lastChangedAt)
                )`);
        } catch (e: any) { Logger.warn(`va_order_cart not created: ${e?.message}`, loggerCtx); }
        this.eventBus.ofType(OrderLineEvent).subscribe(ev => {
            const order: any = ev.order;
            if (!order?.id) return;
            const key = String(order.id);
            const channelId = Number(ev.ctx?.channelId) || 1;
            clearTimeout(this.pending.get(key) as any);
            const t = setTimeout(() => {
                this.pending.delete(key);
                this.active().then(on => (on ? this.snapshot(order.id, channelId) : undefined)).catch((e: any) => Logger.warn(`cart capture for order ${key}: ${e?.message}`, loggerCtx));
            }, 3000);
            (t as any).unref?.();
            this.pending.set(key, t);
        });
        this.eventBus.ofType(OrderPlacedEvent).subscribe(ev => {
            this.active().then(on => (on ? this.placed(ev.order as any) : undefined)).catch((e: any) => Logger.warn(`cart capture placed ${ev.order?.code}: ${e?.message}`, loggerCtx));
        });
    }

    /** Refresh the capture of one order from the database (its lines, total, customer). */
    async snapshot(orderId: any, channelId: number): Promise<boolean> {
        const [o]: any[] = await this.db.query(
            `SELECT o.id, o.code, o.state, o.\`currencyCode\`, o.\`subTotalWithTax\`, o.\`shippingWithTax\`, o.\`customerId\`, c.\`emailAddress\` AS email
             FROM \`order\` o LEFT JOIN customer c ON c.id = o.\`customerId\` WHERE o.id = ?`, [orderId],
        );
        if (!o || !['AddingItems', 'ArrangingPayment'].includes(String(o.state))) return false;
        const lines: any[] = await this.db.query(
            `SELECT ol.\`productVariantId\`, ol.quantity, ol.\`listPrice\`, pv.sku, MAX(pvt.name) AS name
             FROM order_line ol
             LEFT JOIN product_variant pv ON pv.id = ol.\`productVariantId\`
             LEFT JOIN product_variant_translation pvt ON pvt.\`baseId\` = ol.\`productVariantId\`
             WHERE ol.\`orderId\` = ? AND ol.quantity > 0
             GROUP BY ol.id, ol.\`productVariantId\`, ol.quantity, ol.\`listPrice\`, pv.sku`, [orderId],
        );
        const items = lines.slice(0, 100).map(l => ({ variantId: Number(l.productVariantId), name: l.name ? String(l.name).slice(0, 200) : undefined, qty: Number(l.quantity) || 1, unitPriceMinor: Number(l.listPrice) || 0, sku: l.sku || undefined }));
        const itemCount = items.reduce((n, i) => n + i.qty, 0);
        const total = (Number(o.subTotalWithTax) || 0) + (Number(o.shippingWithTax) || 0);
        await this.db.query(
            `INSERT INTO va_order_cart (orderId, orderCode, channelId, customerId, email, currency, totalMinor, itemCount, itemsJson, lastChangedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE customerId = VALUES(customerId), email = VALUES(email), currency = VALUES(currency), totalMinor = VALUES(totalMinor),
                itemCount = VALUES(itemCount), itemsJson = VALUES(itemsJson), lastChangedAt = NOW()`,
            [String(o.id), String(o.code), channelId, o.customerId ?? null, o.email ? String(o.email).toLowerCase().slice(0, 255) : null, String(o.currencyCode || 'GBP').slice(0, 3), total, itemCount, JSON.stringify(items)],
            { conflictColumns: ['orderId'] },
        );
        return true;
    }

    /** The order was placed: the capture stops, and a cart abandoned for it converted. */
    async placed(order: { id: any; code: string }): Promise<void> {
        if (!order?.code) return;
        await this.db.query(`UPDATE va_order_cart SET placedAt = NOW() WHERE orderId = ?`, [String(order.id)]);
        await this.db.query(
            `UPDATE abandoned_cart SET status = 'converted', \`convertedAt\` = COALESCE(\`convertedAt\`, NOW(3)), \`convertedOrderId\` = ?, \`convertedOrderCode\` = ?
             WHERE status = 'abandoned' AND (\`sessionId\` = ? OR \`resumeOrderCode\` = ?)`,
            [Number(order.id) || null, order.code, `order:${order.code}`.slice(0, 64), order.code],
        );
    }

    /** Promote idle captures to abandoned carts (the 5-minute scan). Returns the number opened. */
    async promote(windowMinutes: number): Promise<number> {
        if (!(await this.active())) return 0;
        const rows: any[] = await this.db.query(
            `SELECT vc.*, o.state FROM va_order_cart vc JOIN \`order\` o ON o.code = vc.orderCode
             WHERE vc.placedAt IS NULL AND vc.itemCount > 0 AND vc.lastChangedAt < ? AND vc.lastChangedAt >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
               AND o.state IN ('AddingItems', 'ArrangingPayment')
               AND NOT EXISTS (SELECT 1 FROM abandoned_cart ac WHERE ac.\`sessionId\` = CONCAT('order:', vc.orderCode) OR ac.\`resumeOrderCode\` = vc.orderCode)
             ORDER BY vc.lastChangedAt LIMIT 200`,
            [new Date(Date.now() - windowMinutes * 60_000)],
        );
        let opened = 0;
        for (const r of rows) {
            const sessionId = `order:${r.orderCode}`.slice(0, 64);
            let visitorId = sessionId;
            if (r.customerId) {
                const v: any[] = await this.db.query(`SELECT \`visitorId\` FROM visitor_event WHERE \`customerId\` = ? ORDER BY id DESC LIMIT 1`, [r.customerId]).catch(() => []);
                if (v[0]?.visitorId) visitorId = String(v[0].visitorId);
            }
            const email = r.email ? String(r.email).toLowerCase() : null;
            try {
                await this.db.query(
                    `INSERT INTO abandoned_cart (\`visitorId\`, \`sessionId\`, \`customerId\`, \`channelId\`, currency, \`totalMinor\`, \`itemCount\`, \`itemsJson\`,
                        email, \`emailHash\`, \`emailVerified\`, \`emailSource\`, \`firstSnapshotAt\`, \`lastSnapshotAt\`, \`abandonedAt\`, status, \`resumeOrderCode\`,
                        \`notificationSent\`, \`emailsSent\`, \`createdAt\`, \`updatedAt\`)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'order', ?, ?, NOW(3), 'abandoned', ?, FALSE, 0, NOW(3), NOW(3))`,
                    [visitorId, sessionId, r.customerId ?? null, Number(r.channelId) || 1, r.currency || 'GBP', Number(r.totalMinor) || 0, Number(r.itemCount) || 0, r.itemsJson || '[]',
                     email, email ? createHash('sha256').update(email).digest('hex') : null, !!email, r.lastChangedAt, r.lastChangedAt, r.orderCode],
                );
                opened++;
            } catch (e: any) {
                if (!/duplicate|unique/i.test(String(e?.message))) Logger.warn(`abandoned cart for ${r.orderCode} not opened: ${e?.message}`, loggerCtx);
            }
        }
        return opened;
    }
}
