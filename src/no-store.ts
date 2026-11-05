import type { Response } from 'express';

/**
 * `Cache-Control` for the admin CSV exports. They carry visitor and customer
 * data, and CDNs cache by file extension: Cloudflare stores a `.csv` answer
 * even when the request was authenticated, then serves it to the next caller
 * of the same URL.
 */
export const NO_STORE = 'private, no-store';

/** Call first in the handler, so the refusals and errors it sends carry it too. */
export function noStore(res: Pick<Response, 'setHeader'>): void {
    res.setHeader('Cache-Control', NO_STORE);
}
