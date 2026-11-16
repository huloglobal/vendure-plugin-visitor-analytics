/**
 * Shared e-mail layout (0.21.0) for the e-mails this plugin sends to
 * shoppers: a 600px white card on a light grey background, the merchant's
 * logo (or store name) over a 3px accent bar, a heading, body blocks, the
 * sign-off and an optional footer strip. Inline styles and tables only, so
 * clients that strip <style> blocks still render it. Every interpolated
 * value is escaped by the helpers here; callers pass plain text.
 */

export const DEFAULT_ACCENT = '#155dfc';
export const MONO = "Consolas,Menlo,'Courier New',monospace";
const FONT = 'Arial,Helvetica,sans-serif';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** A safe `#rrggbb` accent, else the default. */
export function accentOf(v: unknown): string {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : DEFAULT_ACCENT;
}

/** An http(s) URL, else null (logos and links never take `javascript:` or `data:`). */
export function safeUrl(v: unknown): string | null {
    if (typeof v !== 'string' || !v.trim()) return null;
    try {
        const u = new URL(v.trim());
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
    } catch { return null; }
}

export interface EmailBrand {
    storeName: string;
    accentColor?: string | null;
    logoUrl?: string | null;
    /** Logo width in px (default 140). */
    logoWidth?: number | null;
    supportEmail?: string | null;
    /** Merchant footer / legal text (plain text). */
    footerText?: string | null;
}

export const block = {
    text: (s: string) => `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:14px;line-height:22px;color:#374151;">${esc(s)}</p>`,
    label: (s: string) => `<div style="font-family:${FONT};font-size:12px;line-height:16px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;padding:0 0 6px 0;">${esc(s)}</div>`,
    /** An info box; `inner` is trusted HTML built with these helpers. */
    info: (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 16px 0;"><tr><td style="padding:14px 16px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-family:${FONT};">${inner}</td></tr></table>`,
    warning: (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 16px 0;"><tr><td style="padding:14px 16px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-family:${FONT};color:#78350f;">${inner}</td></tr></table>`,
    button: (href: string, label: string, accent: string, secondary = false) =>
        `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:4px 0 18px 0;"><tr><td style="border-radius:8px;background-color:${secondary ? '#ffffff' : accent};${secondary ? `border:1px solid ${accent};` : ''}">` +
        `<a href="${esc(href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:bold;color:${secondary ? accent : '#ffffff'};text-decoration:none;border-radius:8px;">${esc(label)}</a></td></tr></table>`,
};

/** Wrap body HTML in the shared card. `bodyHtml` must already be escaped. */
export function renderEmail(input: { brand: EmailBrand; preheader?: string; heading: string; bodyHtml: string; footerHtml?: string }): string {
    const b = input.brand;
    const accent = accentOf(b.accentColor);
    const logo = safeUrl(b.logoUrl);
    const width = Math.min(300, Math.max(40, Math.floor(Number(b.logoWidth) || 140)));
    const header = logo
        ? `<img src="${esc(logo)}" alt="${esc(b.storeName)}" width="${width}" style="display:block;border:0;outline:none;width:${width}px;max-width:100%;height:auto;">`
        : `<span style="font-family:${FONT};font-size:20px;line-height:26px;font-weight:bold;color:#111827;">${esc(b.storeName)}</span>`;
    const support = b.supportEmail && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(b.supportEmail)
        ? `<br><a href="mailto:${esc(b.supportEmail)}" style="color:${accent};text-decoration:none;">${esc(b.supportEmail)}</a>` : '';
    const footerParts = [b.footerText ? esc(b.footerText).replace(/\r?\n/g, '<br>') : '', input.footerHtml || ''].filter(Boolean);
    const footer = footerParts.length
        ? `<tr><td style="padding:14px 28px;background-color:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 10px 10px;font-family:${FONT};font-size:11px;line-height:17px;color:#6b7280;">${footerParts.join('<br><br>')}</td></tr>`
        : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.heading)}</title></head>` +
        `<body style="margin:0;padding:0;background-color:#f3f4f6;">` +
        (input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(input.preheader)}</div>` : '') +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">` +
        `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;">` +
        `<tr><td style="padding:22px 28px;border-bottom:3px solid ${accent};">${header}</td></tr>` +
        `<tr><td style="padding:28px 28px 8px 28px;font-family:${FONT};">` +
        `<h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:bold;color:#111827;">${esc(input.heading)}</h1>` +
        input.bodyHtml +
        `<p style="margin:8px 0 20px 0;font-family:${FONT};font-size:14px;line-height:22px;color:#374151;">Kind regards,<br>${esc(b.storeName)}${support}</p>` +
        `</td></tr>${footer}</table></td></tr></table></body></html>`;
}

/** Plain-text sign-off matching the HTML one. */
export function textSignOff(b: EmailBrand): string[] {
    return ['Kind regards,', b.storeName, ...(b.supportEmail ? [b.supportEmail] : [])];
}
