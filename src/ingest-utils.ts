import { globMatch, matchUrl } from './url-pattern';
/** Pure helpers for the ingest path (kept decorator-free so unit tests can import them). */

/** hulo.js sends `location.href`; reports, funnels and goals expect a path (`/products/x?y=1`). */
export function normaliseUrl(raw: unknown): string {
    const u = String(raw || '');
    if (/^https?:\/\//i.test(u)) {
        try { const p = new URL(u); return (p.pathname + p.search).slice(0, 2048); } catch { return u.slice(0, 2048); }
    }
    return u.slice(0, 2048);
}

/** JSON for the `meta` TEXT column: never cut mid-document (a truncated cart snapshot is unparseable). */
export function boundedMeta(meta: any, max = 60_000): string {
    let s = JSON.stringify(meta);
    if (s.length <= max) return s;
    if (meta && typeof meta === 'object' && Array.isArray(meta.items)) {
        for (let n = 50; n >= 5; n = Math.floor(n / 2)) {
            s = JSON.stringify({ ...meta, items: meta.items.slice(0, n), itemsTruncated: true });
            if (s.length <= max) return s;
        }
    }
    return JSON.stringify({ truncated: true, type: meta?.eventType || meta?.type || null });
}


/**
 * `meta` as an object: hulo.js sends it JSON-encoded (a string), other trackers as an object.
 * Before 0.20.0 a string was stored encoded twice, so the scanner's `"eventType":"…"` matches
 * never saw hulo.js events. A string that is not a JSON object is kept as `{ value }`.
 */
export function objectMeta(raw: unknown): Record<string, any> | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'string') {
        try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: raw.slice(0, 2000) }; }
        catch { return { value: raw.slice(0, 2000) }; }
    }
    return typeof raw === 'object' ? (raw as Record<string, any>) : { value: String(raw).slice(0, 2000) };
}

/**
 * The goal an incoming event completes: page goals on page views (as before 0.20.0);
 * form goals (premium) on `form_submit` events whose form id / name matches the goal's
 * target (a glob, `*` = anything) and, when set, whose page matches its URL pattern.
 */
export function matchGoal(goals: Array<{ id: any; urlPattern: string; type?: string | null; target?: string | null }>, type: string, url: string, meta: any, premium: boolean) {
    if (type === 'pageview') return goals.find(g => (g.type || 'page') === 'page' && matchUrl(g.urlPattern, url || ''));
    if (type === 'form_submit' && premium) {
        const label = String(meta?.formId || meta?.form || meta?.label || '').slice(0, 200);
        return goals.find(g => g.type === 'form' && globMatch(String(g.target || ''), label) && (!g.urlPattern || matchUrl(g.urlPattern, url || '')));
    }
    return undefined;
}

/** Bounce and conversion rates (percent, one decimal) for a group of sessions. */
export function sessionRates(sessions: number, bounced: number, conversions: number): { bounced: number; bounceRate: number; conversions: number; conversionRate: number } {
    const pct = (n: number) => (sessions > 0 ? Math.round((n / sessions) * 1000) / 10 : 0);
    return { bounced, bounceRate: pct(bounced), conversions, conversionRate: pct(conversions) };
}

