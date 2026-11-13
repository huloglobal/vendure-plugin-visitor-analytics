import { cleanParamList, cleanRanges } from './privacy-utils';

/**
 * Admin-editable settings (Visitors → Settings, `GET|POST /ees/settings`),
 * stored as one JSON document in the plugin's prefs table. Defaults keep
 * every existing install behaving as before 0.20.0, except the two privacy
 * defaults the WordPress edition also ships with (staff excluded, private
 * URL parameters stripped).
 */
export interface ReminderSettings {
    /** Send abandoned-cart reminder e-mails (premium). Off by default. */
    enabled: boolean;
    /** Hours after abandonment for the first reminder (1–168). */
    firstAfterHours: number;
    /** Hours after abandonment for the second reminder; 0 = only one (0–336). */
    secondAfterHours: number;
    /** Carts below this value (minor units) get no reminder. */
    minValueMinor: number;
    /** At most this many reminders per scan (every 5 minutes): 1–200. */
    maxPerRun: number;
    /** Subject line; `{{total}}` and `{{shop}}` are replaced. */
    subject: string;
    /** Shop name used in the e-mail (default: the channel code). */
    shopName: string;
}

export interface VaSettings {
    /** Cookieless mode: no cookies or device storage; a daily-rotating hash of address + browser identifies a visit. */
    cookieless: boolean;
    /** Do not record visits from signed-in administrators. */
    excludeStaff: boolean;
    /** Do not record visits from these addresses / CIDR ranges (the office, staff VPN). */
    excludeIps: string[];
    /** Strip the built-in private parameters (tokens, keys, e-mail addresses) from stored URLs and referrers. */
    stripPrivateParams: boolean;
    /** More parameters to strip, e.g. `ref, affiliate_id`. */
    stripParams: string[];
    /** hulo.js reports form submissions (form id or name only, never field values). */
    formAutoTracking: boolean;
    /** Premium: capture carts server-side from Vendure order events (no storefront snapshot needed). Off by default. */
    serverCartCapture: boolean;
    /** Premium: only e-mail addresses that are verified (the order's own customer, or typed in the session's own checkout) are kept for reminders. */
    verifiedEmailOnly: boolean;
    reminders: ReminderSettings;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
    enabled: false,
    firstAfterHours: 1,
    secondAfterHours: 24,
    minValueMinor: 0,
    maxPerRun: 20,
    subject: 'You left something in your basket',
    shopName: '',
};

export const DEFAULT_VA_SETTINGS: VaSettings = {
    cookieless: false,
    excludeStaff: true,
    excludeIps: [],
    stripPrivateParams: true,
    stripParams: [],
    formAutoTracking: true,
    serverCartCapture: false,
    verifiedEmailOnly: true,
    reminders: DEFAULT_REMINDERS,
};

const int = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const text = (v: unknown, fallback: string, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : fallback);

/** Merge `patch` over `base`, keeping only known keys with sane values. */
export function sanitiseSettings(patch: any, base: VaSettings = DEFAULT_VA_SETTINGS): VaSettings {
    const p = patch && typeof patch === 'object' ? patch : {};
    const r = p.reminders && typeof p.reminders === 'object' ? p.reminders : {};
    const br = base.reminders || DEFAULT_REMINDERS;
    const reminders: ReminderSettings = {
        enabled: bool(r.enabled, br.enabled),
        firstAfterHours: int(r.firstAfterHours, br.firstAfterHours, 1, 168),
        secondAfterHours: int(r.secondAfterHours, br.secondAfterHours, 0, 336),
        minValueMinor: int(r.minValueMinor, br.minValueMinor, 0, 100_000_000),
        maxPerRun: int(r.maxPerRun, br.maxPerRun, 1, 200),
        subject: text(r.subject, br.subject, 150) || DEFAULT_REMINDERS.subject,
        shopName: text(r.shopName, br.shopName, 100),
    };
    if (reminders.secondAfterHours && reminders.secondAfterHours <= reminders.firstAfterHours) reminders.secondAfterHours = 0;
    return {
        cookieless: bool(p.cookieless, base.cookieless),
        excludeStaff: bool(p.excludeStaff, base.excludeStaff),
        excludeIps: p.excludeIps !== undefined ? cleanRanges(p.excludeIps) : base.excludeIps,
        stripPrivateParams: bool(p.stripPrivateParams, base.stripPrivateParams),
        stripParams: p.stripParams !== undefined ? cleanParamList(p.stripParams) : base.stripParams,
        formAutoTracking: bool(p.formAutoTracking, base.formAutoTracking),
        serverCartCapture: bool(p.serverCartCapture, base.serverCartCapture),
        verifiedEmailOnly: bool(p.verifiedEmailOnly, base.verifiedEmailOnly),
        reminders,
    };
}
