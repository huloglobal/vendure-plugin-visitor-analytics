import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NotificationService } from '@vendure/admin-ui/core';

/**
 * The Reports, Goals, Abandoned carts and Settings tabs of Visitors (0.20.0).
 * Every call goes to the plugin's own admin REST routes under /ees.
 */
@Component({
    selector: 'hulo-va-tools',
    standalone: false,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <!-- REPORTS (free) -->
    <ng-container *ngIf="tab === 'reports'">
        <vdr-page-block>
            <div class="vt-grid">
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Traffic sources</h3>
                    <table class="table" *ngIf="sources?.length; else none">
                        <thead><tr><th>Source / medium</th><th class="num">Visitors</th><th class="num">Sessions</th><th class="num">Bounce rate</th><th class="num">Conversions</th><th class="num">Conv. rate</th></tr></thead>
                        <tbody><tr *ngFor="let s of sources"><td>{{ s.source }} <span class="muted">/ {{ s.medium }}</span></td><td class="num">{{ s.visitors }}</td><td class="num">{{ s.sessions }}</td><td class="num">{{ s.bounceRate }}%</td><td class="num">{{ s.conversions }}</td><td class="num">{{ s.conversionRate }}%</td></tr></tbody>
                    </table>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Landing pages</h3>
                    <table class="table" *ngIf="landing?.length; else none">
                        <thead><tr><th>Page</th><th class="num">Sessions</th><th class="num">Bounce rate</th><th class="num">Conv. rate</th></tr></thead>
                        <tbody><tr *ngFor="let p of landing"><td class="url">{{ p.url }}</td><td class="num">{{ p.sessions }}</td><td class="num">{{ p.bounceRate }}%</td><td class="num">{{ p.conversionRate }}%</td></tr></tbody>
                    </table>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Exit pages</h3>
                    <table class="table" *ngIf="exits?.length; else none">
                        <thead><tr><th>Page</th><th class="num">Exits</th></tr></thead>
                        <tbody><tr *ngFor="let p of exits"><td class="url">{{ p.url }}</td><td class="num">{{ p.exits }}</td></tr></tbody>
                    </table>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Events</h3>
                    <table class="table" *ngIf="events?.length; else none">
                        <thead><tr><th>Type</th><th class="num">Count</th><th class="num">Visitors</th></tr></thead>
                        <tbody><tr *ngFor="let e of events"><td>{{ e.type }}</td><td class="num">{{ e.count }}</td><td class="num">{{ e.uniqueVisitors }}</td></tr></tbody>
                    </table>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Audience</h3>
                    <div class="vt-split" *ngIf="breakdown">
                        <div *ngFor="let g of audienceGroups()"><h4>{{ g.label }}</h4>
                            <div class="bar-row" *ngFor="let r of g.rows"><span>{{ r.label }}</span><span class="num">{{ r.visitors }}</span></div>
                            <p class="muted" *ngIf="!g.rows.length">No data.</p>
                        </div>
                    </div>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Site search</h3>
                    <p class="muted" *ngIf="channelId == null">Shows the default channel; pick a channel above for another.</p>
                    <h4>Top searches</h4>
                    <div class="bar-row" *ngFor="let q of searchTop"><span>{{ q.query }}</span><span class="num">{{ q.searches }}</span></div>
                    <h4>No results</h4>
                    <div class="bar-row" *ngFor="let q of searchNone"><span>{{ q.query }}</span><span class="num">{{ q.searches }}</span></div>
                    <p class="muted" *ngIf="!searchTop.length && !searchNone.length">No searches recorded (call hulo.search(query, results) from your storefront).</p>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Frustration</h3>
                    <h4>Rage clicks</h4>
                    <div class="bar-row" *ngFor="let r of rage"><span class="url">{{ r.url }}</span><span class="num">{{ r.rageClicks }}</span></div>
                    <h4>Dead clicks</h4>
                    <div class="bar-row" *ngFor="let r of dead"><span class="url">{{ r.url }}</span><span class="num">{{ r.deadClicks }}</span></div>
                    <p class="muted" *ngIf="!rage.length && !dead.length">No rage or dead clicks recorded.</p>
                </div></div>
            </div>
        </vdr-page-block>
    </ng-container>

    <!-- GOALS -->
    <ng-container *ngIf="tab === 'goals'">
        <vdr-page-block>
            <div class="card"><div class="card-block">
                <h3 class="card-title">Conversion goals <span class="muted">last {{ days }} days</span></h3>
                <p class="muted" *ngIf="!premium">Goals need a licence (or the evaluation). Existing page goals keep counting.</p>
                <table class="table" *ngIf="goals?.length; else noGoals">
                    <thead><tr><th>Goal</th><th>Type</th><th>Matches</th><th class="num">Completions</th><th class="num">Visitors</th><th class="num">Value</th><th></th></tr></thead>
                    <tbody><tr *ngFor="let g of goals">
                        <td><strong>{{ g.name }}</strong> <span class="muted" *ngIf="!g.enabled">(off)</span></td>
                        <td>{{ g.type }}</td>
                        <td class="url">{{ g.type === 'page' ? g.urlPattern : (g.type === 'form' ? 'form ' + g.target + (g.urlPattern ? ' on ' + g.urlPattern : '') : (g.target ? 'method ' + g.target : 'any payment')) }}</td>
                        <td class="num">{{ g.completions }}</td><td class="num">{{ g.uniqueVisitors }}</td><td class="num">{{ money(g.valueMinor) }}</td>
                        <td class="nowrap"><button class="gbtn gbtn-outline gbtn-xs" (click)="toggleGoal(g)">{{ g.enabled ? 'Pause' : 'Resume' }}</button> <button class="gbtn gbtn-outline gbtn-xs" (click)="deleteGoal(g)">Delete</button></td>
                    </tr></tbody>
                </table>
                <ng-template #noGoals><p class="muted">No goals yet.</p></ng-template>
            </div></div>
        </vdr-page-block>
        <vdr-page-block>
            <div class="vt-grid">
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Add a goal</h3>
                    <div class="form-grid">
                        <label>Name <input class="form-input" [(ngModel)]="draft.name" placeholder="Order placed"></label>
                        <label>Type <select class="form-select" [(ngModel)]="draft.type"><option value="page">Page visited</option><option value="form">Form sent</option><option value="payment">Payment settled</option></select></label>
                        <label *ngIf="draft.type !== 'payment'">URL pattern <input class="form-input" [(ngModel)]="draft.urlPattern" [placeholder]="draft.type === 'page' ? '/checkout/confirmation/**' : 'optional, e.g. /contact'"></label>
                        <label *ngIf="draft.type !== 'page'">{{ draft.type === 'form' ? 'Form id or name (* allowed)' : 'Payment method code (optional, * allowed)' }} <input class="form-input" [(ngModel)]="draft.target" [placeholder]="draft.type === 'form' ? 'contact-form' : 'stripe*'"></label>
                        <label>Value per completion (minor units) <input class="form-input" type="number" min="0" [(ngModel)]="draft.valueMinor"></label>
                    </div>
                    <p class="muted"><code>*</code> matches within a path segment, <code>**</code> across segments. Form goals count the <code>form_submit</code> events hulo.js reports (form id or name only). Payment goals count settled Vendure payments; with value 0 they are worth what was paid.</p>
                    <button class="gbtn gbtn-primary gbtn-sm" (click)="createGoal()" [disabled]="busy || !premium">Add goal</button>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Suggestions</h3>
                    <p class="muted" *ngIf="!premium">Suggestions need a licence.</p>
                    <div class="sugg" *ngFor="let s of suggestions">
                        <div><strong>{{ s.name }}</strong> <span class="muted">{{ s.type }} · {{ s.urlPattern || s.target || 'any' }}</span><br><small class="muted">{{ s.reason }}</small></div>
                        <button class="gbtn gbtn-outline gbtn-xs" (click)="useSuggestion(s)" [disabled]="busy">Add</button>
                    </div>
                    <p class="muted" *ngIf="premium && !suggestions.length">Nothing to suggest yet.</p>
                </div></div>
            </div>
        </vdr-page-block>
    </ng-container>

    <!-- ABANDONED CARTS -->
    <ng-container *ngIf="tab === 'carts'">
        <vdr-page-block>
            <div class="card"><div class="card-block">
                <h3 class="card-title">Abandoned carts <span class="muted">last {{ days }} days</span></h3>
                <p class="muted" *ngIf="!premium">Detection, recovery links and reminders need a licence (or the evaluation); carts already recorded stay listed.</p>
                <div class="kpis" *ngIf="cartSummary">
                    <div><span>Carts</span><strong>{{ cartSummary.total }}</strong></div>
                    <div><span>Open</span><strong>{{ cartSummary.openCount }}</strong></div>
                    <div><span>Recovered</span><strong>{{ cartSummary.recoveredCount + cartSummary.convertedCount }} ({{ cartSummary.recoveryRatePct }}%)</strong></div>
                    <div><span>Value recovered</span><strong>{{ money(cartSummary.recoveredValueMinor) }}</strong></div>
                    <div><span>Via link</span><strong>{{ cartSummary.attribution?.convertedViaLink || 0 }}</strong></div>
                </div>
                <div class="filters"><select class="form-select" [(ngModel)]="cartStatus" (ngModelChange)="loadCarts()"><option value="">All</option><option value="abandoned">Open</option><option value="converted">Converted</option><option value="recovered">Recovered</option><option value="dismissed">Dismissed</option><option value="expired">Expired</option></select></div>
                <table class="table" *ngIf="carts?.length; else noCarts">
                    <thead><tr><th>When</th><th>Contact</th><th>Items</th><th class="num">Value</th><th>Status</th><th>Reminders</th><th></th></tr></thead>
                    <tbody><tr *ngFor="let c of carts">
                        <td class="nowrap">{{ c.abandonedAt | date:'d MMM HH:mm' }}</td>
                        <td>{{ c.email || '—' }} <span class="pill" *ngIf="c.email" [class.ok]="isTrue(c.emailVerified)">{{ isTrue(c.emailVerified) ? 'verified' : 'unverified' }}</span></td>
                        <td>{{ c.itemsPreview }}</td>
                        <td class="num">{{ money(c.totalMinor, c.currency) }}</td>
                        <td>{{ c.status }}<span class="muted" *ngIf="c.recoveryStep"> · {{ c.recoveryStep }}</span></td>
                        <td>{{ c.emailsSent || 0 }}</td>
                        <td class="nowrap">
                            <button class="gbtn gbtn-outline gbtn-xs" (click)="recoveryLink(c)" [disabled]="busy">Link</button>
                            <button class="gbtn gbtn-outline gbtn-xs" *ngIf="c.status === 'abandoned'" (click)="setCartStatus(c, 'dismissed')">Dismiss</button>
                        </td>
                    </tr></tbody>
                </table>
                <ng-template #noCarts><p class="muted">No carts.</p></ng-template>
                <p *ngIf="lastLink" class="muted">Recovery link: <code>{{ lastLink }}</code></p>
            </div></div>
        </vdr-page-block>
        <vdr-page-block>
            <div class="card"><div class="card-block">
                <h3 class="card-title">Reminder opt-outs</h3>
                <div class="bar-row" *ngFor="let o of optOuts"><span>{{ o.email }} <small class="muted">{{ o.createdAt | date:'d MMM y' }}</small></span><button class="gbtn gbtn-outline gbtn-xs" (click)="removeOptOut(o)">Remove</button></div>
                <p class="muted" *ngIf="!optOuts.length">Nobody has opted out.</p>
            </div></div>
        </vdr-page-block>
    </ng-container>

    <!-- SETTINGS -->
    <ng-container *ngIf="tab === 'settings' && cfg">
        <vdr-page-block>
            <div class="vt-grid">
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Tracking and privacy</h3>
                    <label class="chk"><input type="checkbox" [(ngModel)]="cfg.cookieless"> Cookieless mode — no cookies or device storage; a visit is a hash of address + browser under a salt replaced every day (visitors are counted per day)</label>
                    <label class="chk"><input type="checkbox" [(ngModel)]="cfg.excludeStaff"> Don't count signed-in administrators</label>
                    <label>Don't count these addresses (IPs or CIDR ranges) <input class="form-input" [ngModel]="cfg.excludeIps.join(', ')" (ngModelChange)="cfg.excludeIps = split($event)" placeholder="203.0.113.0/24, 2001:db8::/32"></label>
                    <p class="muted">Staff can also exclude one browser: open any storefront page once with <code>?hulo_exclude=1</code> (<code>=0</code> to undo).</p>
                    <label class="chk"><input type="checkbox" [(ngModel)]="cfg.stripPrivateParams"> Strip private URL parameters (tokens, keys, passwords, e-mail addresses) before storing</label>
                    <label>Also strip <input class="form-input" [ngModel]="cfg.stripParams.join(', ')" (ngModelChange)="cfg.stripParams = split($event)" placeholder="ref, affiliate_id"></label>
                    <label class="chk"><input type="checkbox" [(ngModel)]="cfg.formAutoTracking"> hulo.js reports form submissions (form id or name only)</label>
                    <p class="muted">Set at install: Do-Not-Track {{ env?.honorDoNotTrack ? 'honoured' : 'ignored' }} · IPs {{ env?.anonymizeIp ? 'anonymised' : 'stored in full' }} · consent {{ env?.requireConsent ? 'required' : 'not required' }} · events kept {{ env?.retentionDays ? env.retentionDays + ' days' : 'forever' }}.</p>
                </div></div>
                <div class="card"><div class="card-block">
                    <h3 class="card-title">Carts <span class="muted" *ngIf="!premium">· licensed</span></h3>
                    <label class="chk"><input type="checkbox" [(ngModel)]="cfg.serverCartCapture" [disabled]="!premium"> Capture carts from Vendure orders (no storefront snapshot needed)</label>
                    <label class="chk"><input type="checkbox" [(ngModel)]="cfg.verifiedEmailOnly" [disabled]="!premium"> Remind verified addresses only (the customer's own, or typed in that visitor's own checkout)</label>
                    <label class="chk"><input type="checkbox" [(ngModel)]="cfg.reminders.enabled" [disabled]="!premium"> Send reminder e-mails</label>
                    <div class="form-grid">
                        <label>First after (hours) <input class="form-input" type="number" min="1" max="168" [(ngModel)]="cfg.reminders.firstAfterHours"></label>
                        <label>Second after (hours, 0 = none) <input class="form-input" type="number" min="0" max="336" [(ngModel)]="cfg.reminders.secondAfterHours"></label>
                        <label>Minimum cart value (minor units) <input class="form-input" type="number" min="0" [(ngModel)]="cfg.reminders.minValueMinor"></label>
                        <label>At most per 5 minutes <input class="form-input" type="number" min="1" max="200" [(ngModel)]="cfg.reminders.maxPerRun"></label>
                        <label>Subject <input class="form-input" [(ngModel)]="cfg.reminders.subject"></label>
                        <label>Shop name <input class="form-input" [(ngModel)]="cfg.reminders.shopName" placeholder="channel code"></label>
                    </div>
                    <p class="muted">Needs SMTP ({{ env?.smtp ? 'set' : 'not set' }}), <code>abandonment.recoveryLinkSecret</code> ({{ env?.recoveryLinkSecret ? 'set' : 'not set' }}) and an opt-out secret ({{ env?.optOutSecret ? 'set' : 'not set' }}). Each cart gets at most two reminders, an address at most one sequence a week; opted-out addresses never; every e-mail carries an unsubscribe link and one-click List-Unsubscribe headers.</p>
                </div></div>
            </div>
            <button class="gbtn gbtn-primary gbtn-sm" (click)="saveSettings()" [disabled]="busy">Save settings</button>
        </vdr-page-block>
        <vdr-page-block>
            <div class="card"><div class="card-block">
                <h3 class="card-title">Personal data</h3>
                <p class="muted">Export or erase what this plugin holds about one person: visits, abandoned carts, cart captures and payment-goal completions. Their reminder opt-out is kept so they are never e-mailed again.</p>
                <div class="form-grid">
                    <label>E-mail <input class="form-input" [(ngModel)]="subject.email" placeholder="customer@example.com"></label>
                    <label>or customer id <input class="form-input" [(ngModel)]="subject.customerId"></label>
                    <label>or visitor id <input class="form-input" [(ngModel)]="subject.visitorId"></label>
                </div>
                <button class="gbtn gbtn-outline gbtn-sm" (click)="exportData()" [disabled]="busy">Export (JSON)</button>
                <button class="gbtn gbtn-outline gbtn-sm" (click)="eraseData()" [disabled]="busy">Erase…</button>
                <p class="muted" *ngIf="privacyResult">{{ privacyResult }}</p>
            </div></div>
        </vdr-page-block>
    </ng-container>
    <ng-template #none><p class="muted">No data for this period.</p></ng-template>
    `,
    styles: [`
        .vt-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
        .num { text-align: right; } .url { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .nowrap { white-space: nowrap; } .muted { color: var(--color-weight-600, #6b7280); }
        .bar-row, .sugg { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid var(--color-weight-100, #f1f5f9); }
        .vt-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 10px 0; }
        .form-grid label, label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; margin: 6px 0; }
        label.chk { flex-direction: row; align-items: flex-start; gap: 8px; }
        .kpis { display: flex; gap: 20px; flex-wrap: wrap; margin: 10px 0; } .kpis div { display: flex; flex-direction: column; } .kpis span { font-size: 12px; color: #6b7280; }
        .pill { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: #fef3c7; } .pill.ok { background: #dcfce7; }
        .filters { margin: 8px 0; } h4 { margin: 10px 0 4px; font-size: 13px; }
    `],
})
export class VisitorsToolsComponent implements OnChanges {
    @Input() tab: string = 'reports';
    @Input() days = 30;
    @Input() channelId: number | null = null;
    @Input() premium = false;

    busy = false;
    sources: any[] = []; landing: any[] = []; exits: any[] = []; events: any[] = []; breakdown: any = null;
    searchTop: any[] = []; searchNone: any[] = []; rage: any[] = []; dead: any[] = [];
    goals: any[] = []; suggestions: any[] = [];
    draft: any = { name: '', type: 'page', urlPattern: '', target: '', valueMinor: 0 };
    carts: any[] = []; cartSummary: any = null; cartStatus = ''; optOuts: any[] = []; lastLink = '';
    cfg: any = null; env: any = null;
    subject: any = { email: '', customerId: '', visitorId: '' }; privacyResult = '';

    constructor(private http: HttpClient, private notify: NotificationService, private cdr: ChangeDetectorRef) {}

    ngOnChanges(): void { this.load(); }

    private q(extra = ''): string { return `days=${this.days}${this.channelId != null ? `&channelId=${this.channelId}` : ''}${extra}`; }
    private get<T = any>(url: string, done: (v: T) => void): void {
        this.http.get<T>(url).subscribe({ next: v => { done(v); this.cdr.markForCheck(); }, error: () => this.cdr.markForCheck() });
    }
    private err(e: any, fallback: string): string {
        if (e?.status === 402) return `${fallback}: this needs a licence (or the evaluation).`;
        return e?.error?.error || e?.error?.message || fallback;
    }

    load(): void {
        if (this.tab === 'reports') {
            this.get<any>(`/ees/visitors/sources?${this.q('&take=15')}`, r => this.sources = r.sources || []);
            this.get<any>(`/ees/visitors/landing-pages?${this.q('&take=15')}`, r => this.landing = r.pages || []);
            this.get<any>(`/ees/visitors/exit-pages?${this.q('&take=15')}`, r => this.exits = r.exitPages || []);
            this.get<any>(`/ees/visitors/top-events?${this.q('&take=15')}`, r => this.events = r.events || []);
            this.get<any>(`/ees/visitors/breakdown?${this.q()}`, r => this.breakdown = r);
            this.get<any>(`/ees/search-analytics/top?${this.q('&limit=10')}`, r => this.searchTop = r.items || []);
            this.get<any>(`/ees/search-analytics/no-results?${this.q('&limit=10')}`, r => this.searchNone = r.items || []);
            this.get<any>(`/ees/journey/rage-clicks?${this.q('&limit=10')}`, r => this.rage = r.items || []);
            this.get<any>(`/ees/journey/dead-clicks?${this.q('&limit=10')}`, r => this.dead = r.items || []);
        } else if (this.tab === 'goals') {
            this.loadGoals();
        } else if (this.tab === 'carts') {
            this.loadCarts();
            this.get<any>(`/ees/abandoned-carts/summary?${this.q()}`, r => this.cartSummary = r);
            this.get<any>(`/ees/abandoned-carts/opt-outs?take=50`, r => this.optOuts = r.items || []);
        } else if (this.tab === 'settings') {
            this.get<any>('/ees/settings', r => { this.cfg = JSON.parse(JSON.stringify(r.settings)); this.env = r.environment; });
        }
    }

    audienceGroups() {
        const b = this.breakdown || {};
        return [{ label: 'Countries', rows: b.countries || [] }, { label: 'Devices', rows: b.devices || [] }, { label: 'Browsers', rows: b.browsers || [] }, { label: 'Operating systems', rows: b.oses || [] }];
    }

    money(minor: number, currency = 'GBP'): string {
        try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((Number(minor) || 0) / 100); } catch { return ((Number(minor) || 0) / 100).toFixed(2); }
    }
    isTrue(v: any): boolean { return v === true || v === 1 || v === '1'; }
    split(v: string): string[] { return String(v || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean); }

    // ── goals
    loadGoals(): void {
        this.get<any>(`/ees/goals/stats?${this.q()}`, r => this.goals = r.goals || []);
        if (this.premium) this.get<any>(`/ees/goals/suggestions?${this.q()}`, r => this.suggestions = r.suggestions || []);
    }
    createGoal(body = this.draft): void {
        this.busy = true;
        this.http.post<any>('/ees/goals', { ...body, channelId: this.channelId ?? 1 }).subscribe({
            next: () => { this.busy = false; this.notify.success('Goal added'); this.draft = { name: '', type: 'page', urlPattern: '', target: '', valueMinor: 0 }; this.loadGoals(); },
            error: e => { this.busy = false; this.notify.error(this.err(e, 'Could not add the goal')); this.cdr.markForCheck(); },
        });
    }
    useSuggestion(s: any): void { this.createGoal({ name: s.name, type: s.type, urlPattern: s.urlPattern, target: s.target, valueMinor: 0 }); }
    toggleGoal(g: any): void {
        this.http.put<any>(`/ees/goals/${g.id}`, { enabled: !g.enabled }).subscribe({ next: () => this.loadGoals(), error: e => this.notify.error(this.err(e, 'Could not update the goal')) });
    }
    deleteGoal(g: any): void {
        if (!confirm(`Delete the goal "${g.name}"? Its past completions stay on the events.`)) return;
        this.http.delete<any>(`/ees/goals/${g.id}`).subscribe({ next: () => this.loadGoals(), error: e => this.notify.error(this.err(e, 'Could not delete the goal')) });
    }

    // ── carts
    loadCarts(): void {
        this.get<any>(`/ees/abandoned-carts?take=50${this.channelId != null ? `&channelId=${this.channelId}` : ''}${this.cartStatus ? `&status=${this.cartStatus}` : ''}`, r => this.carts = r.items || []);
    }
    recoveryLink(c: any): void {
        this.busy = true;
        this.http.post<any>(`/ees/abandoned-carts/${c.id}/recovery-link`, {}).subscribe({
            next: r => { this.busy = false; this.lastLink = r?.url || r?.link || ''; if (!this.lastLink) this.notify.error('No link: set abandonment.recoveryLinkSecret'); this.cdr.markForCheck(); },
            error: e => { this.busy = false; this.notify.error(this.err(e, 'Could not create the link')); this.cdr.markForCheck(); },
        });
    }
    setCartStatus(c: any, status: string): void {
        this.http.post<any>(`/ees/abandoned-carts/${c.id}/status`, { status }).subscribe({ next: () => this.loadCarts(), error: e => this.notify.error(this.err(e, 'Could not update the cart')) });
    }
    removeOptOut(o: any): void {
        if (!confirm(`Allow reminders to ${o.email} again? Only do this when they asked for it.`)) return;
        this.http.post<any>('/ees/abandoned-carts/opt-outs/remove', { email: o.email }).subscribe({ next: () => this.load(), error: e => this.notify.error(this.err(e, 'Could not remove the opt-out')) });
    }

    // ── settings
    saveSettings(): void {
        this.busy = true;
        this.http.post<any>('/ees/settings', this.cfg).subscribe({
            next: r => { this.busy = false; this.cfg = r.settings; this.notify.success('Settings saved'); this.cdr.markForCheck(); },
            error: e => { this.busy = false; this.notify.error(this.err(e, 'Could not save the settings')); this.cdr.markForCheck(); },
        });
    }
    private subjectQuery(): any {
        const s: any = {};
        if (this.subject.email) s.email = String(this.subject.email).trim();
        if (this.subject.customerId) s.customerId = Number(this.subject.customerId);
        if (this.subject.visitorId) s.visitorId = String(this.subject.visitorId).trim();
        return s;
    }
    exportData(): void {
        const s = this.subjectQuery();
        const qs = Object.entries(s).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
        this.busy = true;
        this.http.get(`/ees/privacy/export?${qs}`, { responseType: 'text' }).subscribe({
            next: text => {
                this.busy = false;
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
                a.download = `visitor-data-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                this.privacyResult = 'Export downloaded.';
                this.cdr.markForCheck();
            },
            error: e => { this.busy = false; this.privacyResult = this.err(e, 'Export failed'); this.cdr.markForCheck(); },
        });
    }
    eraseData(): void {
        const s = this.subjectQuery();
        if (!confirm('Erase this person\'s analytics data? This cannot be undone.')) return;
        this.busy = true;
        this.http.post<any>('/ees/privacy/erase', s).subscribe({
            next: r => { this.busy = false; const e = r.erased || {}; this.privacyResult = `Erased ${e.visitorEvents || 0} events, ${e.abandonedCarts || 0} carts, ${e.serverCartCaptures || 0} cart captures, ${e.goalPayments || 0} goal payments.`; this.cdr.markForCheck(); },
            error: e => { this.busy = false; this.privacyResult = this.err(e, 'Erase failed'); this.cdr.markForCheck(); },
        });
    }
}
