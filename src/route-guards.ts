import { HttpException } from '@nestjs/common';
import { RateLimiter } from '@huloglobal/vendure-licence-sdk';
import { getRealIp } from './proxy-headers';
import { readableChannels } from './channel-scope';

/** A browser form submission (Accept: text/html), not an RFC 8058 one-click POST. */
export function wantsHtml(req: { headers?: Record<string, any>; body?: any }): boolean {
    const accept = String(req?.headers?.accept || '');
    if (req?.body && typeof req.body === 'object' && 'List-Unsubscribe' in req.body) return false;
    return /text\/html/i.test(accept);
}

/** 0.21.0: the public recommendation endpoints had no rate limit; each call runs
 *  one or two aggregate queries. 120 requests a minute per client IP across the three. */
const PUBLIC_LIMIT = new RateLimiter({ capacity: 120, windowMs: 60_000 });

export function assertRecsBudget(req: any, trustedIpHeaders: any[] = [], limiter: RateLimiter = PUBLIC_LIMIT): void {
    const ip = req ? getRealIp(req, trustedIpHeaders) || '' : '';
    if (ip && !limiter.allow(`recs|${ip}`)) throw new HttpException({ error: 'rate-limited' }, 429);
}

/** The weekly report and the widget total every channel: only administrators of
 *  the default channel (or SuperAdmins) may read them, change the recipient or
 *  send them to an address (0.21.0 fix: channel-scoped admins could before). */
export function requireAllChannelsAdmin(ctx: any, res: any, perm = 'ReadCustomer'): boolean {
    if (readableChannels(ctx, perm) !== null) {
        res.status(403).json({ error: 'Only an administrator of the default channel can do this' });
        return false;
    }
    return true;
}
