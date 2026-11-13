/** Pure goal rules (0.20.0) — no entities, so the unit suite imports them directly. */

export const GOAL_TYPES = ['page', 'form', 'payment'] as const;
export type GoalType = typeof GOAL_TYPES[number];

export interface GoalInput { name?: unknown; type?: unknown; urlPattern?: unknown; target?: unknown; valueMinor?: unknown; enabled?: unknown }
export interface CleanGoal { name: string; type: GoalType; urlPattern: string; target: string; valueMinor: number; enabled: boolean }

/**
 * Validate a goal from the admin. Page goals need a URL pattern; form goals a
 * form target (id or name, `*` allowed) and optionally a URL pattern; payment
 * goals an optional payment-method target. Returns an error message instead
 * of a goal when the input cannot be used.
 */
export function cleanGoal(input: GoalInput, base?: Partial<CleanGoal>): CleanGoal | { error: string } {
    const has = (k: keyof GoalInput) => input && input[k] !== undefined;
    const type = (has('type') ? String(input.type) : base?.type || 'page') as GoalType;
    if (!GOAL_TYPES.includes(type)) return { error: 'type must be page, form or payment' };
    const name = has('name') ? String(input.name ?? '').trim().slice(0, 128) : String(base?.name || '');
    const urlPattern = has('urlPattern') ? String(input.urlPattern ?? '').trim().slice(0, 256) : String(base?.urlPattern || '');
    const target = has('target') ? String(input.target ?? '').trim().slice(0, 200) : String(base?.target || '');
    const valueMinor = has('valueMinor') ? Math.max(0, Math.min(2_147_483_647, Math.trunc(Number(input.valueMinor) || 0))) : Number(base?.valueMinor || 0);
    const enabled = has('enabled') ? input.enabled !== false : base?.enabled !== false;
    if (!name) return { error: 'name is required' };
    if (type === 'page' && !urlPattern) return { error: 'urlPattern is required for a page goal' };
    if (type === 'form' && !target) return { error: 'target (the form id or name) is required for a form goal' };
    if (target && !/^[A-Za-z0-9 _.:*#/\-[\]]+$/.test(target)) return { error: 'target may contain letters, digits, spaces and _ . : * # / - [ ] only' };
    return { name, type, urlPattern: type === 'payment' ? '' : urlPattern, target, valueMinor, enabled };
}

/** "/checkout/confirmation/ABC123" → "/checkout/confirmation/**". */
export function patternForUrl(url: string): string {
    const path = String(url || '/').split('?')[0].split('#')[0];
    const segs = path.split('/').filter(Boolean);
    if (segs.length <= 1) return `/${segs.join('/')}`.replace(/\/$/, '') || '/';
    return `/${segs.slice(0, -1).join('/')}/**`;
}

