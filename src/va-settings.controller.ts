import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Ctx, Permission, RequestContext } from '@vendure/core';
import { Response } from 'express';
import { isAdminApiSession } from '@huloglobal/vendure-licence-sdk';
import { VaSettingsService } from './va-settings.service';
import { VaPrivacyService } from './privacy.service';
import { readableChannels } from './channel-scope';
import { noStore } from './no-store';
import { getOptions } from './plugin';

function requireAdmin(ctx: RequestContext, res: Response, perms: Permission[]): boolean {
    if (!ctx?.activeUserId) { res.status(401).json({ error: 'Authentication required' }); return false; }
    if (!isAdminApiSession(ctx) || !ctx.userHasPermissions(perms)) { res.status(403).json({ error: 'Insufficient permissions' }); return false; }
    return true;
}

/** Settings and personal data apply to every channel: only administrators of the default channel (or SuperAdmins) change them. */
function requireAllChannels(ctx: RequestContext, res: Response, perm: string): boolean {
    if (readableChannels(ctx as any, perm) !== null) { res.status(403).json({ error: 'Only an administrator of the default channel can do this' }); return false; }
    return true;
}

/**
 * Visitors → Settings (0.20.0):
 *   GET  /ees/settings          — current settings + what the install has configured
 *   POST /ees/settings          — partial update (UpdateSettings)
 *   GET  /ees/privacy/export?email=|customerId=|visitorId=   — one person's data as JSON (ReadCustomer)
 *   POST /ees/privacy/erase { email | customerId | visitorId } — delete it (DeleteCustomer)
 */
@Controller('ees')
export class VaSettingsController {
    constructor(private readonly settings: VaSettingsService, private readonly privacy: VaPrivacyService) {}

    @Get('settings')
    async get(@Ctx() ctx: RequestContext, @Res() res: Response) {
        if (!requireAdmin(ctx, res, [Permission.ReadSettings])) return;
        const { VisitorAnalyticsPlugin } = require('./plugin');
        const o: any = getOptions();
        const ab = o.abandonment || {};
        return res.json({
            settings: await this.settings.get(),
            premium: VisitorAnalyticsPlugin.hasPremiumAccess(),
            environment: {
                smtp: !!(process.env.SMTP_SERVER || process.env.SMTP_HOST),
                recoveryLinkSecret: !!ab.recoveryLinkSecret,
                optOutSecret: !!(ab.optOutSecret || ab.recoveryLinkSecret || o.signingSecret),
                storefrontBaseUrl: !!(ab.storefrontBaseUrl || Object.keys(ab.storefrontBaseUrls || {}).length),
                honorDoNotTrack: o.honorDoNotTrack !== false,
                anonymizeIp: o.anonymizeIp !== false,
                requireConsent: !!o.requireConsent,
                retentionDays: o.retention === false ? null : (o.retention?.days ?? 400),
            },
        });
    }

    @Post('settings')
    async update(@Ctx() ctx: RequestContext, @Res() res: Response, @Body() body: any) {
        if (!requireAdmin(ctx, res, [Permission.UpdateSettings])) return;
        if (!requireAllChannels(ctx, res, 'UpdateSettings')) return;
        if (!body || typeof body !== 'object') return res.status(400).json({ error: 'settings object required' });
        return res.json({ settings: await this.settings.update(body) });
    }

    @Get('privacy/export')
    async export(@Ctx() ctx: RequestContext, @Res() res: Response, @Query() q: any) {
        noStore(res);
        if (!requireAdmin(ctx, res, [Permission.ReadCustomer])) return;
        if (!requireAllChannels(ctx, res, 'ReadCustomer')) return;
        const out = await this.privacy.export({ email: q?.email || undefined, customerId: q?.customerId ? Number(q.customerId) : undefined, visitorId: q?.visitorId || undefined });
        if (out?.error) return res.status(400).json(out);
        res.setHeader('Content-Disposition', `attachment; filename="visitor-data-${new Date().toISOString().slice(0, 10)}.json"`);
        return res.json(out);
    }

    @Post('privacy/erase')
    async erase(@Ctx() ctx: RequestContext, @Res() res: Response, @Body() body: any) {
        if (!requireAdmin(ctx, res, [Permission.DeleteCustomer])) return;
        if (!requireAllChannels(ctx, res, 'DeleteCustomer')) return;
        const out = await this.privacy.erase({ email: body?.email || undefined, customerId: body?.customerId ? Number(body.customerId) : undefined, visitorId: body?.visitorId || undefined });
        if (out?.error) return res.status(400).json(out);
        return res.json(out);
    }
}
