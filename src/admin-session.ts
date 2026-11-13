import { ForbiddenError, RequestContext } from '@vendure/core';
import { isAdminApiSession } from '@huloglobal/vendure-licence-sdk';

/**
 * Vendure 3.8+ binds each session to the API it was created on, but does not
 * check REST routes: an administrator's Shop-API session would otherwise pass
 * the `@Allow(...)` admin permission of these routes. No-op on Vendure 3.5-3.7.
 */
export function assertAdminApiSession(ctx: RequestContext): void {
    if (!isAdminApiSession(ctx)) throw new ForbiddenError();
}
