/**
 * Channel scoping for the admin reads (0.19.2).
 *
 * Vendure grants permissions per channel: an administrator whose roles cover
 * only channel B passes `ctx.userHasPermissions([ReadCustomer])` while the
 * active channel is B, but must not see channel A's visitors, carts, e-mails
 * or IPs. Before 0.19.2 every admin read took `channelId` from the query (or
 * none = all channels), so any channel admin could read every channel.
 *
 * Rule: a user who holds the permission (or SuperAdmin) on the default
 * channel sees everything, exactly as in Vendure itself (every entity is also
 * in the default channel). Anyone else is limited to the channels their roles
 * grant the permission on; when they don't name a channel they get the active
 * one. Decorator-free so unit tests can import it.
 */

const DEFAULT_CHANNEL_CODE = '__default_channel__';
const SUPER_ADMIN = 'SuperAdmin';

interface ChannelPermissionsLike {
    id: string | number;
    code?: string;
    permissions?: string[];
}

interface CtxLike {
    channelId?: string | number | null;
    session?: { user?: { channelPermissions?: ChannelPermissionsLike[] } | null } | null;
}

/** Numeric id of a Vendure ID (also accepts the `T_<n>` ids of the e2e strategy). */
function toId(raw: unknown): number | null {
    const n = Number(String(raw ?? '').replace(/^T_/, ''));
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** `null` = every channel; otherwise the channel ids the user may read with `perm`. */
export function readableChannels(ctx: CtxLike, perm: string = 'ReadCustomer'): number[] | null {
    const entries = ctx?.session?.user?.channelPermissions || [];
    const grants = (e: ChannelPermissionsLike) =>
        (e.permissions || []).includes(perm) || (e.permissions || []).includes(SUPER_ADMIN);
    if (entries.some(e => e.code === DEFAULT_CHANNEL_CODE && grants(e))) return null;
    const ids: number[] = [];
    for (const e of entries) {
        const id = toId(e.id);
        if (id != null && grants(e) && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

export type ScopedChannel = { ok: true; channelId: number | null } | { ok: false };

/**
 * The channel an admin read should filter on.
 *   - unrestricted user: whatever was requested (`null` = all channels);
 *   - restricted user: the requested channel if granted, else refused;
 *     nothing requested → the active channel (or their first granted one).
 */
export function scopeChannel(ctx: CtxLike, requested: number | null, perm: string = 'ReadCustomer'): ScopedChannel {
    const allowed = readableChannels(ctx, perm);
    if (allowed === null) return { ok: true, channelId: requested };
    if (requested != null) return allowed.includes(requested) ? { ok: true, channelId: requested } : { ok: false };
    const active = toId(ctx?.channelId);
    if (active != null && allowed.includes(active)) return { ok: true, channelId: active };
    return allowed.length ? { ok: true, channelId: allowed[0] } : { ok: false };
}

/**
 * For endpoints that always read one channel (default 1): the requested
 * channel (`raw` from the query string) when the caller may read it, the
 * caller's own channel when they are channel-scoped and named none, or
 * `null` when they may not read the requested channel.
 */
export function singleChannel(ctx: CtxLike, raw: unknown, perm: string = 'ReadCustomer'): number | null {
    const n = parseInt(String(raw ?? ''), 10);
    const requested = Number.isFinite(n) && n > 0 ? n : null;
    const s = scopeChannel(ctx, requested, perm);
    if (!s.ok) return null;
    return s.channelId ?? 1;
}
