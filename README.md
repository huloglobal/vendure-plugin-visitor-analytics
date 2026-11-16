<p align="center"><a href="https://huloglobal.com/vendure-plugins/visitor-analytics/"><img src="https://huloglobal.com/vendure-plugins/logos/visitor-analytics.svg?v=2" width="96" height="96" alt="HULO Visitor Analytics logo"></a></p>

# @huloglobal/vendure-plugin-visitor-analytics

Self-hosted full-funnel visitor analytics for Vendure storefronts.
Pageviews, time-on-page, exit pages, configurable funnel, UTM
attribution, conversion goals with URL-glob matching, bot detection,
and a per-visitor profile drawer with parsed user-agent and MaxMind
geo. Privacy-first defaults: DNT, IP anonymisation, optional consent
gate.

Since 0.8.0 the plugin also ships **cart abandonment** (detection,
signed recovery links, Slack notification, admin dashboard),
**co-view product recommendations** (`also-viewed` / `personal` /
`trending`), **site search analytics** (top queries, zero-result
queries, search-to-cart conversion) and **journey-drawer buffs**
(rage-click + dead-click hot-spot lists, per-session `intent`
labels).

Since 0.20.0: **cookieless mode**, staff and IP exclusion, private URL
parameter stripping, landing-page, bounce-rate, conversion-per-source and
OS reports, personal-data export/erase, **form and payment goals** with
form auto-tracking and goal suggestions, **verified e-mail capture**,
**server-side cart capture** from Vendure order events and **abandoned-cart
reminder e-mails** — with Reports, Goals, Abandoned carts and Settings tabs
in the admin.

Maintained by Wayne Garrison.

## Tiers

| Free | Licensed (or the 14-day evaluation) |
| --- | --- |
| Every event recorded — no daily cap | Live visitors view |
| Dashboard, funnel, journeys, visitor profiles | Abandoned-cart detection, recovery links, Slack alerts |
| Reports: sources (bounce rate, conversions), landing pages, exit pages, events, countries / devices / browsers / OS, site search, rage and dead clicks | Abandoned-cart reminder e-mails, verified e-mail capture, server-side cart capture |
| Cookieless mode, staff and IP exclusion, URL parameter stripping, DNT, IP anonymisation, consent gate | Conversion goals (page, form, payment) and goal suggestions; existing page goals keep counting on the free tier |
| Personal-data export and erase | CSV export |
| | Weekly report and set-up checklist |

Licensed endpoints answer `402` with a buy link on the free tier; nothing
answers 403 for lack of a licence.

## Buy

14-day evaluation (no card needed, start it from the admin), then **£9.95/month**, or **£199 one-off lifetime** at
[elite.charity/licence/buy/vendure-plugin-visitor-analytics](https://elite.charity/licence/buy/vendure-plugin-visitor-analytics).
Start the trial (or buy) from the plugin's admin page — checkout opens in a new tab and the key installs itself.

## Install

```bash
yarn add @huloglobal/vendure-plugin-visitor-analytics
```

```ts
import { VisitorAnalyticsPlugin } from '@huloglobal/vendure-plugin-visitor-analytics';

export const config: VendureConfig = {
    plugins: [
        VisitorAnalyticsPlugin.init({
            publicBaseUrl: 'https://shop.example.com',
            licenceKey: process.env.HULO_LICENCE_KEY_VISITOR_ANALYTICS,

            // -- Privacy (defaults shown) --
            honorDoNotTrack: true,
            anonymizeIp: true,
            requireConsent: false,
            dropBotEvents: false,

            // -- Security (recommended in production) --
            signingSecret: process.env.HULO_VISITOR_SIGNING_SECRET,
            corsAllowedOrigins: [
                'https://shop.example.com',
                'https://www.example.com',
            ],
            rateLimit: { capacity: 240, windowMs: 60_000 },

            // -- Retention (opt-in) --
            retention: { days: 365, maxRows: 50_000_000 },

            // -- Cart abandonment (opt-in, since 0.8.0) --
            // Storefront must fire cart_snapshot events (see below).
            abandonment: {
                windowMinutes: 30,
                slackMinValueMinor: 5000,
                slackWebhookUrl: process.env.HULO_ABANDONMENT_SLACK_URL,
                recoveryLinkSecret: process.env.HULO_ABANDONMENT_SECRET,
                recoveryLinkTtlHours: 72,
                storefrontBaseUrl: 'https://shop.example.com',
                // Opt-out link signing (0.18.0). Falls back to
                // recoveryLinkSecret, then signingSecret.
                optOutSecret: process.env.HULO_ABANDONMENT_OPTOUT_SECRET,
            },
        }),
    ],
};
```

Add `VisitorAnalyticsPlugin.uiExtensions` to your `compileUiExtensions`
config to pick up the admin page (**Marketing → Visitor Analytics** in the
nav, since 0.19.0), the licence/evaluation banner and the dashboard widget
(**Dashboard → Add widget → Visitor Analytics**).


> **Since 0.18.2:** events are pruned after 400 days by default
> (`retention`); the visitor IP is `req.ip` unless you list proxy headers in
> `trustedIpHeaders`; `hulo.js` carries first-party visitor/session ids so
> cross-origin storefronts count uniques correctly.
>
> **Since 0.19.2:** a trusted `x-forwarded-for` is read from its right-most
> entry (the hop your proxy appended); edge country/region headers
> (`CF-IPCountry`, Akamai, Fastly, `cf-region-code`) are used only when the
> request came through a proxy Vendure trusts (`apiOptions.trustProxy`) or
> `trustedIpHeaders` is set — otherwise the GeoLite2 lookup is used. Admin
> reads are channel-scoped: an administrator whose roles cover only some
> channels sees only those channels' visitors and abandoned carts.

## Storefront helpers

The plugin ships a **drop-in JS helper** at `/ees/hulo.js` — one script
tag and every event API below is available on `window.hulo`. It handles
batching, `sendBeacon` on unload, auto rage-click + dead-click
detection, and an on-mount `pageview`. Bare minimum:

```html
<script src="https://shop.example.com/ees/hulo.js" defer></script>
```

For a first-party integration (recommended — one bundle instead of a
second script tag), copy the equivalent typed helpers into your
storefront. The [elite.charity Qwik storefront](https://elite-software.co.uk)
uses this pattern. Every helper below is a thin wrapper around
`POST /ees/track` with a specific `meta.eventType` — the plugin's
server-side scanners look those event types up by name.

| Helper | When to call | What it feeds |
| --- | --- | --- |
| `hulo.pageview()` | first mount + every route change | pageview funnel, exit-page report |
| `hulo.productView(productId, variantId?)` | on the PDP | co-view aggregation, `also-viewed`, `trending`, `personal` recs |
| `hulo.addToCart(variantId, qty, unitPriceMinor)` | on the "add" button | search-to-cart conversion |
| `hulo.cartSnapshot({ currency, totalMinor, itemCount, items, email? })` | every cart change (add / remove / qty) | **cart abandonment detection** |
| `hulo.search(query, resultsCount)` | on every executed search | top-queries, zero-result queries |
| `hulo.checkoutCompleted(orderCode, totalMinor)` | on the thank-you page | closes any open `abandoned_cart` row for this session |
| `hulo.rageClick(selector)` / `hulo.deadClick(selector)` | fire yourself if you have a better signal than the auto-detector | rage-click / dead-click hot-spot lists |
| `hulo.restoreCart(token)` | on your `/cart/restore?t=...` route | rebuild a cart from a signed recovery link |
| `hulo.resumeCart(token)` | same route, when you can resume the visitor's open order | as above, plus `resumeOrderCode` while the bound order is still open (0.18.0) |
| `hulo.recoveryConverted(orderCode)` | on the thank-you page | attributes the order to the recovery link the visitor arrived through (0.18.0) |

Full payload shapes:

```ts
hulo.cartSnapshot({
    currency: 'GBP',              // ISO-4217
    totalMinor: 4995,             // in pence / cents
    itemCount: 2,
    items: [
        { variantId: 42, name: 'Blue T-shirt (M)', qty: 1, unitPriceMinor: 1995, sku: 'BT-M' },
        { variantId: 88, name: 'Wool socks',        qty: 1, unitPriceMinor: 3000 },
    ],
    email: 'buyer@example.com',   // optional — captured at checkout step 1
    countryCode: 'GB',            // optional
});

hulo.productView(product.id, selectedVariant.id);
hulo.search('rgb keyboard', 42);           // (query, resultsCount)
hulo.checkoutCompleted('S2BZ54TEK', 12500); // (orderCode, totalMinor)
```

### Cart-restore route

The recovery link the admin mints (see below) lands on
`https://shop.example.com/cart/restore?t=<token>`. Your storefront
needs a route that:

1. Reads `?t=` from the URL
2. Calls `GET /ees/recover-cart?t=<token>` to fetch `{ items: [...] }`
   (or `POST /ees/recover-cart/resume?t=<token>` — see below)
3. Re-adds each `{ variantId, qty }` via your Vendure order API (usually
   `addItemToOrder(productVariantId, quantity)`) — check the result is an
   `Order`, not an `ErrorResult` (out of stock, purchase limit…)
4. Shows the basket when done — open your cart drawer or navigate to your
   cart page, whichever your storefront has (don't assume a `/cart` route)
5. On the thank-you page, calls `hulo.recoveryConverted(order.code)` (or
   `POST /ees/recover-cart/converted { t, orderCode }`) so the cart is
   attributed to the link — the helper remembers `t` in `sessionStorage`
   from step 2, so this is a no-op for visitors who did not arrive through
   a recovery link

**Resuming the visitor's order (0.18.0).** When the host mints the link
with `issueRecoveryLink(id, { resumeOrderCode })`, both recovery endpoints
return `orderCode`, `orderState` and `resumable`, and the `resume` endpoint
adds `resumeOrderCode` — non-null only while that order is still in
`AddingItems` / `ArrangingPayment`. The Shop API cannot adopt an order
anonymously, so treat it as a hint: a signed-in owner already has it as
their active order (skip the re-add), a guest gets the items re-added as
usual. Either way the `items` array is always present as the fallback.

Guard against silently overwriting a live cart — if the visitor
already has items, show a "you already have items in your cart"
message and let them reconcile. See
[elite.charity's `src/routes/cart/restore/index.tsx`](https://github.com/exceeded/elite-software-frontend/blob/main/src/routes/cart/restore/index.tsx)
for a working reference implementation.

### Legacy: hand-rolled tracker

If you prefer to skip `/ees/hulo.js`, the raw POST shape is unchanged:

```ts
const body = JSON.stringify({
    channelId: 1,
    events: [{
        type: 'event',
        url: location.href,
        meta: { eventType: 'product_view', productId: 42 },
    }],
});
navigator.sendBeacon('/ees/track', body) ||
    fetch('/ees/track', {
        method: 'POST', body, credentials: 'include',
        headers: { 'content-type': 'application/json' }, keepalive: true,
    });
```

## Feature tour

### Lightweight ingest

- `POST /ees/track` accepts a batch of up to 50 events at once. The
  `customerId` of a batch comes from the Vendure session of the request
  (never from the body); `OPTIONS /ees/track` answers the CORS preflight.
  With `corsAllowedOrigins` set, a request from any other origin gets no
  `Access-Control-Allow-Origin` header.
- Visitor + session cookies (`ees_vid`, `ees_sid`) issued + refreshed
  automatically. When `signingSecret` is set, cookies are HMAC-signed
  and tampered values are rejected — the visitor gets a fresh id.
- `Secure` flag is set automatically when serving over HTTPS.

### Auto-enrichment

Per event:

- **User-agent** parsed via `ua-parser-js` → browser, version, OS,
  device.
- **Geo** via MaxMind GeoLite2-City (no MaxMind account required — DB
  fetched at install via `geolite2-redist`). Skipped when the upstream
  proxy already provides a country (Cloudflare, Akamai, Fastly).
- **UTM attribution** parsed server-side from every pageview URL:
  `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`. Plus
  `referrerDomain` for grouping by source even when UTM is absent.
- **Bot flag** — known crawler / monitoring / library UAs (Googlebot,
  Bingbot, UptimeRobot, Datadog, curl, Puppeteer, …) marked `isBot=true`.

### Configurable conversion goals (licensed)

**Visitors → Goals** lists every goal with its completions, unique
visitors and value over the selected range, and adds, pauses or deletes
goals. Three types (0.20.0):

- **page** — a page view whose URL matches `urlPattern` (`*` within a
  segment, `**` across segments), e.g. `/checkout/confirmation/**`;
- **form** — a `form_submit` event whose form id or name matches `target`
  (`*` = anything), optionally only on pages matching `urlPattern`.
  hulo.js reports form submissions automatically (the form's id, name or
  action path, never a field value; off in Settings);
- **payment** — a Vendure payment settles (optionally only for payment
  methods matching `target`, e.g. `stripe*`). With value 0 the goal is worth
  what was paid. The completion is attributed to the visit that sent
  `checkout_completed` for that order, else the customer's latest visit.

*Suggestions* proposes ready-made goals from the last 30 days of traffic
(the order confirmation page seen most, "Payment received", the forms sent
most). REST: `POST /ees/goals` (`{ name, type, urlPattern, target,
valueMinor, channelId }`), `PUT|DELETE /ees/goals/:id`,
`GET /ees/goals/stats?days=30&channelId=1`, `GET /ees/goals/suggestions`.

### Privacy controls

- `honorDoNotTrack: true` (default) — `DNT: 1` and `Sec-GPC: 1` requests
  get a 200 with `{stored:0, skipped:'dnt'}`.
- `anonymizeIp: true` (default) — IPv4 last octet dropped before
  storage; IPv6 reduced to the first 3 hextets. `ipHash` still uses the
  raw IP so unique-visitor counts stay accurate.
- `requireConsent: false` (default) — flip on to require a `consent: true`
  body field or an `ees_consent=1` cookie before ingest.
- `dropBotEvents: false` (default) — flip on to skip bot UAs entirely.

**Visitors → Settings** (0.20.0, `GET|POST /ees/settings`; changes need
`UpdateSettings` in the default channel):

- **Cookieless mode** (off by default) — no cookies, no ids in the
  browser's storage (hulo.js stops using localStorage), no credentials on
  the beacon. A visit is an HMAC of address + browser + site under a salt of
  the current UTC day; the salt is replaced every day and the old one
  deleted, so ids cannot be recomputed or linked across days. Visitors are
  therefore counted per day.
- **Exclude staff** (on by default) — signed-in administrators record
  nothing. **Excluded addresses** — IPs / CIDR ranges (v4 and v6). Staff can
  also exclude one browser by opening a storefront page with
  `?hulo_exclude=1` (`=0` undoes it).
- **Strip private URL parameters** (on by default) — `token`, `key`, `t`,
  `e`, `email`, `password`, `auth`, `code`, mailing-tool subscriber ids and
  any parameter whose value is an e-mail address are removed from stored
  URLs and referrers; add more names in *Also strip*.
- **Personal data** — export one person's data as JSON
  (`GET /ees/privacy/export?email=|customerId=|visitorId=`, `ReadCustomer`)
  or erase it (`POST /ees/privacy/erase`, `DeleteCustomer`): visits under
  every visitor id their customer record was seen with, abandoned carts,
  server-side cart captures and payment-goal completions. The reminder
  opt-out of the address is kept, so they are never e-mailed again.

### Cart abandonment (since 0.8.0)

**0.20.0 (licensed):**

- **Verified e-mail capture.** Each cart records whether its address is
  verified: the signed-in customer's own address, the Vendure order's
  customer (server-side capture), or an address typed in the cart's own
  session after it reached the checkout, while its network has attached
  fewer than 3 addresses in 24 hours. Unverified addresses are still stored
  (hosts may read them) but reminders skip them unless *Remind verified
  addresses only* is off.
- **Server-side cart capture** (off by default, Settings → Carts). Carts
  are read from Vendure's own order-line events; an order idle for the
  abandonment window in `AddingItems` / `ArrangingPayment` becomes an
  abandoned cart bound to the order (the recovery link resumes it), and
  `OrderPlacedEvent` converts it. No storefront `cart_snapshot` needed.
- **Reminder e-mails** (off by default, Settings → Carts): a first reminder
  after N hours and an optional second, for carts above a minimum value.
  Deliverability and consent rules: verified addresses only (default),
  never to an opted-out address (checked at send time), at most two per
  cart (claimed with compare-and-set, never sent twice), one sequence per
  address per 7 days, at most `maxPerRun` per 5-minute scan, a plain-text
  part, an unsubscribe link and RFC 8058 `List-Unsubscribe` /
  `List-Unsubscribe-Post` headers. Needs SMTP (`SMTP_*` env with nodemailer),
  `abandonment.recoveryLinkSecret` and an opt-out secret; without them
  nothing is sent. Hosts that already send their own reminders should leave
  this off.
- **Reminder e-mail design** (since 0.21.0): a 600px card with your logo (or
  the shop name), a 3px accent bar, the basket with line prices and total, a
  *Return to your basket* button, a "Kind regards" sign-off with your support
  address and a footer with your legal text and the unsubscribe link. Inline
  styles only, plus a plain-text part. Set the accent colour, logo URL,
  support e-mail and footer text in Settings → Carts, or install-wide with
  the plugin option `email: { accentColor, logoUrl, logoWidth, supportEmail,
  footerText }` (Settings win). *Preview the reminder e-mail* renders it with
  the saved settings and a sample basket.
- **Visitors → Abandoned carts** lists carts with their value, status,
  verified flag and reminders sent, mints recovery links, dismisses carts
  and manages the opt-out list.

Detects sessions that got as far as putting items in the cart but
never fired `checkout_completed`. Turns them into `AbandonedCart` rows
you can send a recovery email against.

> **The `email` on an `AbandonedCart` row is unverified.** It comes from the
> storefront's anonymous `cart_snapshot` beacon, so anyone can put any
> address there. Do not send reminders to it as-is: mail the Vendure order's
> customer (`setCustomerForOrder`) or a signed-in customer's address, and
> limit sends per address.

**How detection works.**
The plugin runs a worker-only sweep every 5 minutes. It looks at every
session that fired at least one `cart_snapshot` event, and:

- If a `checkout_completed` landed later — do nothing (or if an
  `abandoned_cart` row already exists, promote it to `converted`).
- If the last `cart_snapshot` is older than `abandonment.windowMinutes`
  (default 30) — open an `abandoned_cart` row, keyed on `sessionId`
  (unique — you can't double-open the same session).
- Otherwise leave the session alone. It may still convert.

**Recovery link.**
`POST /ees/abandoned-carts/:id/recovery-link` mints a signed opaque
token and returns `{ ok: true, url: '<storefront>/cart/restore?t=...' }`.
The token is time-bounded (`recoveryLinkTtlHours`, default 72) and
non-reusable. The storefront exchanges it via
`GET /ees/recover-cart?t=<token>` to get back the persisted item list.

Multi-storefront installs: set `abandonment.storefrontBaseUrls` to a map of
channel code → storefront origin (for example
`{ licensedock: 'https://license-dock.com' }`) and each cart's link points
at the storefront it was abandoned on; channels not listed fall back to
`storefrontBaseUrl`.

Set `abandonment.recoveryLinkSecret` in plugin options to enable this —
without it, the endpoint returns `{ error: 'recovery-disabled-or-not-found' }`.

**Attribution (0.18.0).**
Every `abandoned_cart` row carries `recoveryStep` — `link_issued` →
`link_opened` → `resumed` → `converted`, never moving backwards — plus
`convertedAt`, `convertedOrderId`, `convertedOrderCode` and
`resumeOrderCode`. Steps advance as the link is minted, exchanged
(`recover-cart`), resumed (`recover-cart/resume`) and finally reported
converted by the storefront (`POST /ees/recover-cart/converted
{ t, orderCode }` — token-bound, the order must exist and be past
`AddingItems`). The scanner's own `checkout_completed` match still marks
rows `converted` and stamps `convertedAt`, but leaves `recoveryStep`
alone — so "converted via link" is exactly `recoveryStep = 'converted'`.
`GET /ees/abandoned-carts/summary` returns an `attribution` block:

```json
{ "linkIssued": 120, "linkOpened": 41, "resumed": 9, "convertedViaLink": 14,
  "convertedViaLinkValueMinor": 184950, "convertedTotal": 37, "optOuts": 3 }
```

**Email opt-out (0.18.0).**
Recovery emails must carry an unsubscribe link. Build it with
`abandonedCartService.buildOptOutLink(email)` and add the headers from
`abandonedCartService.buildListUnsubscribeHeaders(email)`
(`List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`)
so Gmail / Outlook / Yahoo show their native "Unsubscribe" button. Both
point at `GET|POST /ees/abandoned-carts/opt-out?e=<token>` on the Vendure
server: GET renders a small confirmation page, POST is the RFC 8058
one-click form. The token is `base64url(email).hmac(email)` signed with
`abandonment.optOutSecret` (default: `recoveryLinkSecret`, then
`signingSecret`) — nobody can unsubscribe someone else.

Before every send call `await abandonedCartService.isOptedOut(email)`;
it fails closed (a DB error counts as opted out). Opt-outs live in
`abandoned_cart_opt_out` (keyed by the SHA-256 of the lower-cased
address). Admin: `GET /ees/abandoned-carts/opt-outs`,
`POST /ees/abandoned-carts/opt-outs/remove { email }` after an explicit
customer request; `GET /ees/abandoned-carts/:id` reports `optedOut`.

**Schema.** The 0.18.0 columns and the opt-out table are added at boot
(an information-schema check, then `ALTER TABLE … ADD COLUMN` /
`CREATE TABLE IF NOT EXISTS` — MariaDB, MySQL 8 and PostgreSQL). Installs
that run TypeORM migrations for plugins can generate one as usual — the
`AbandonedCart` entity declares the same columns, so the generator finds
nothing to add once the plugin has booted. Closed carts (expired /
converted / dismissed) older than 180 days are pruned monthly on the
worker; every raw statement in the plugin is checked against PostgreSQL
17 and MariaDB by `tests/pg-corpus.test.ts`.

**Slack notification.**
`abandonment.slackWebhookUrl` + `abandonment.slackMinValueMinor`
control an at-most-once Slack post per abandonment above the value
threshold. Useful for sales teams that follow up on high-value drops
manually.

**Admin dashboard.**
Under **Analytics → Abandoned carts**. Filters by status / min value /
email / window. Actions per row: mint recovery link (copies URL to
clipboard), mark recovered manually, dismiss. CSV export.

### Product recommendations (since 0.8.0)

A `ProductCoView` aggregate table holds a per-triple counter
`(productIdA, productIdB, channelId) → viewsTogether`. Rebuilt every 6
hours from the last 24h of `product_view` events, bounded to 20 events
per session so runaway bot sessions can't skew the table.
Denormalised — we store both `(A, B)` and `(B, A)` — so read-side
lookups are one indexed scan.

Three endpoints, all safe from the storefront (no PII). Since 0.21.0 they
share a rate limit of 120 requests a minute per client IP (429 above it):

| Endpoint | Use |
| --- | --- |
| `GET /ees/recommendations/also-viewed?productId=42&limit=10` | product-page rail: "customers who viewed X also viewed…" |
| `GET /ees/recommendations/personal?visitorId=abc&limit=10` | homepage / cart recs for a returning visitor. Uses their last 10 `product_view` events over 30 days, excludes the seeds so the same product never appears |
| `GET /ees/recommendations/trending?hours=24&limit=10` | homepage rail: most-viewed products in the window. Reflects real intent (not search-console clicks) |

`GET /ees/recommendations/aggregate-now` (SuperAdmin only) runs the
sweep now. It is idempotent: events up to the persisted end of the last
sweep are not counted again, so it is safe to call after the 6-hourly
cron. Add `?force=1` to rebuild regardless (e.g. after truncating
`product_co_view`). Pairs not refreshed in 90 days are pruned monthly.

### Site search analytics (since 0.8.0)

Zero-schema-cost queries over the existing `visitor_event` table where
the storefront has fired `hulo.search(query, resultsCount)` events.

| Endpoint | Use |
| --- | --- |
| `GET /ees/search-analytics/top?days=7` | top queries by volume with average results count |
| `GET /ees/search-analytics/no-results?days=7` | queries that returned zero hits — direct catalogue-gap intel |
| `GET /ees/search-analytics/conversion?days=7` | of sessions that searched, what fraction went on to `add_to_cart` |

### Journey drawer buffs (since 0.8.0)

| Endpoint | Use |
| --- | --- |
| `GET /ees/journey/rage-clicks?days=7` | rage-click hot-spot list per URL. Pages where visitors are frustrated |
| `GET /ees/journey/dead-clicks?days=7` | dead-click hot-spot list per URL. Elements that LOOK clickable but aren't |
| `GET /ees/journey/session-summary?visitorId=abc` | per-session summary with a heuristic `intent` label (`purchase` / `abandon` / `frustrate` / `consider` / `browse` / `bounce`) |

Rage-click auto-detector fires on ≥3 pointerdown events within 500ms
and a 20-pixel radius. Dead-click auto-detector fires when a click
lands on a non-interactive element and no navigation / significant
scroll follows within 400ms. Both are conservative heuristics — the
signal is direction-of-frustration, not a metric to optimise against.

### Live-now widget

SSE stream at `GET /ees/visitors/live` pushes the active-visitor count
and the 20 most recent URLs every 5 seconds. Auto-reconnects.

### Per-visitor journey

Click any visitor for the full timeline: pages, custom events,
time-on-page, country, browser, OS.

### CSV export

`GET /ees/visitors/export.csv?days=N` (max 90 days) returns the raw
events with full enrichment, streamed in id order (up to 200 000 rows);
`GET /ees/abandoned-carts/export.csv?days=N` streams up to 50 000 carts.

### Weekly report, setup checklist and dashboard widget (since 0.19.0)

The report and the dashboard widget total every channel, so since 0.21.0
only administrators of the default channel (or SuperAdmins) can read the
report settings, change the recipient, preview it or send a test; the widget
shows channel-scoped administrators no store-wide figures.

Since 0.20.0 the weekly report and the set-up checklist are licensed (or
evaluation) features: on the free tier nothing is mailed, *Send me a test*
answers 402 and `GET /ees/setup` returns no items (`premium: false`). The
report's settings are kept and it resumes when a licence is active.

**Weekly report.** Every Monday at 08:00 (server-local time) the worker
emails a short "what Visitor Analytics did for you" report for the previous
seven days: unique visitors, sessions, page views, abandoned carts detected,
carts recovered and their value, conversion goals completed — each with the
change against the week before — plus up to three next steps taken from the
setup checklist, and the licence notice when a trial or key is about to end.
Every figure comes from the same tables the admin page reads.

- **Recipient.** The admin page's *Weekly report* card (just under the
  licence card) has the enabled toggle and a recipient field. When the
  field is empty the report goes to the licence holder's email, or to the
  address given to *Email me before it ends* during the evaluation; the
  placeholder shows which. *Send me a test* mails the week-to-date report
  now; *Preview* opens it in a new tab. The same settings are available at
  `GET|POST /ees/digest/settings` (`{ enabled?, recipient? }`),
  `POST /ees/digest/send-test` (`{ to? }`) and `GET /ees/digest/preview`.
- **Turning it off.** Untick *Enabled* (or `POST /ees/digest/settings`
  `{ "enabled": false }`). Nothing is sent when no recipient can be
  resolved.
- **SMTP.** The plugin has no mailer of its own: it uses the host's
  `SMTP_SERVER` (or `SMTP_HOST`), `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
  and `SMTP_FROM` environment variables through `nodemailer`, which is an
  optional peer dependency — install it (`yarn add nodemailer`) to enable
  the report. Without SMTP the card still works but *Send me a test*
  reports why nothing went out; the rest of the plugin is unaffected.
- **Multi-worker safe.** The send is claimed with a compare-and-set on a
  shared `hulo_plugin_prefs` row, so several worker replicas send one
  report, not one each.

**Setup checklist.** The top of the admin page lists what still needs
doing, from real checks: tracking events arriving in the last 7 days,
`publicBaseUrl` pointing at a public host, a storefront URL for recovery
links, at least one conversion goal, and Slack alerts or recovery links
enabled. It disappears once everything is done, or when you hide it — and
comes back if something it had ticked stops being true. `GET /ees/setup`
returns the same items.

**Dashboard widget.** *Dashboard → Add widget → Visitor Analytics* shows
unique visitors, page views and carts recovered for the last 7 days, the
licence notice when there is one, and a link to the full page
(`GET /ees/widget`).

**Usage counters.** The same 30-day numbers (no personal data) travel with
the daily heartbeat and the evaluation ping so renewal and win-back emails
from HULO can say what the plugin did for the store.

## HTTP endpoints

**Public** (no auth — CORS-permissive for browser calls from any
storefront origin):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/ees/track` | ingest a batch of visitor events |
| `GET`  | `/ees/hulo.js` | typed storefront helper JS (since 0.8.1) |
| `GET`  | `/ees/recover-cart?t=<token>` | resolve a recovery token → items (+ `orderCode`, `orderState`, `resumable` since 0.18.0); 30/min per IP |
| `POST` | `/ees/recover-cart/resume?t=<token>` | as above plus `resumeOrderCode` while the bound order is open (0.18.0); 30/min per IP |
| `POST` | `/ees/recover-cart/converted` | `{ t, orderCode }` — attribute a placed order to its recovery link (0.18.0); 10/min per IP |
| `GET`/`POST` | `/ees/abandoned-carts/opt-out?e=<token>` | email opt-out; POST is RFC 8058 one-click (0.18.0); 10/min per IP |
| `GET`  | `/ees/recommendations/also-viewed?productId=…` | co-view recs |
| `GET`  | `/ees/recommendations/personal?visitorId=…` | personalised recs |
| `GET`  | `/ees/recommendations/trending?hours=…` | most-viewed products |

**Admin** (Vendure `ReadCustomer` unless noted; requires a
Vendure admin session cookie):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`  | `/ees/visitors/summary` | top-line + daily series |
| `GET`  | `/ees/visitors/sources` | top sources by visits |
| `GET`  | `/ees/visitors/top-pages` | most-visited URLs |
| `GET`  | `/ees/visitors/funnel` | configurable funnel |
| `GET`  | `/ees/visitors/exit-pages` | top exit pages |
| `GET`  | `/ees/visitors/top-events` | top custom events |
| `GET`  | `/ees/visitors/live` | SSE live-now stream |
| `GET`  | `/ees/visitors/journey/:visitorId` | per-visitor timeline |
| `GET`  | `/ees/visitors/recent` | recent events |
| `GET`  | `/ees/visitors/export.csv` | CSV export |
| `GET`  | `/ees/goals` | list conversion goals |
| `POST` | `/ees/goals` | create a goal |
| `PUT`  | `/ees/goals/:id` | update a goal |
| `DELETE`| `/ees/goals/:id` | delete a goal |
| `GET`  | `/ees/goals/stats` | per-goal completion stats |
| `GET`  | `/ees/visitors/status` | version + update status |
| `GET`  | `/ees/licence/status` | licence/evaluation state + lifecycle notice, premium list, 30-day figures (0.19.0; `capReached` is always false since 0.20.0) |
| `GET`  | `/ees/visitors/landing-pages` | entry pages with sessions, bounce rate, conversions (0.20.0) |
| `GET`  | `/ees/goals/suggestions` | ready-made goals from recent traffic (0.20.0, licensed) |
| `GET`  | `/ees/settings` | Settings tab: settings + what the install has configured (0.20.0, `ReadSettings`) |
| `POST` | `/ees/settings` | partial settings update (0.20.0, `UpdateSettings`, default channel) |
| `GET`  | `/ees/privacy/export` | one person's data as JSON (0.20.0, `ReadCustomer`, default channel) |
| `POST` | `/ees/privacy/erase` | erase it (0.20.0, `DeleteCustomer`, default channel) |
| `POST` | `/ees/eval/remind-me` | `{ email }` — email the admin before the evaluation ends (0.19.0, `UpdateSettings`) |
| `GET`  | `/ees/setup` | setup checklist items (0.19.0) |
| `GET`  | `/ees/widget` | dashboard widget payload, last 7 days (0.19.0) |
| `GET`  | `/ees/digest/settings` | weekly report settings (0.19.0) |
| `POST` | `/ees/digest/settings` | `{ enabled?, recipient? }` (0.19.0, `UpdateSettings`) |
| `POST` | `/ees/digest/send-test` | `{ to? }` — send the week-to-date report now (0.19.0, `UpdateSettings`) |
| `GET`  | `/ees/digest/preview` | this week's report as HTML (0.19.0) |
| `GET`  | `/ees/abandoned-carts` | paginated list w/ filters (0.8.0) |
| `GET`  | `/ees/abandoned-carts/summary` | totals + recovery rate (0.8.0) |
| `GET`  | `/ees/abandoned-carts/:id` | detail incl. parsed items (0.8.0) |
| `POST` | `/ees/abandoned-carts/:id/recovery-link` | mint signed URL (0.8.0, `UpdateCustomer`); body `{ resumeOrderCode? }` binds it to an order (0.18.0) |
| `GET`  | `/ees/abandoned-carts/opt-outs` | opted-out addresses (0.18.0) |
| `POST` | `/ees/abandoned-carts/opt-outs/remove` | `{ email }` — re-enable after an explicit request (0.18.0, `UpdateCustomer`) |
| `POST` | `/ees/abandoned-carts/:id/status` | mark recovered/dismissed (0.8.0, `UpdateCustomer`) |
| `GET`  | `/ees/abandoned-carts/export.csv` | CSV export (0.8.0) |
| `GET`  | `/ees/recommendations/aggregate-now` | force co-view sweep (0.8.0, `SuperAdmin`) |
| `GET`  | `/ees/search-analytics/top` | top queries (0.8.0) |
| `GET`  | `/ees/search-analytics/no-results` | zero-result queries (0.8.0) |
| `GET`  | `/ees/search-analytics/conversion` | search→cart rate (0.8.0) |
| `GET`  | `/ees/journey/rage-clicks` | rage-click hot spots (0.8.0) |
| `GET`  | `/ees/journey/dead-clicks` | dead-click hot spots (0.8.0) |
| `GET`  | `/ees/journey/session-summary?visitorId=…` | per-session intent labels (0.8.0) |

## Documentation

User manual + screenshots:
[huloglobal.com/vendure-plugins/visitor-analytics/docs/](https://huloglobal.com/vendure-plugins/visitor-analytics/docs/)

## Lost your licence key?

Re-send every active key on file at
[elite.charity/licence/forgot](https://elite.charity/licence/forgot).

## Licence

Commercial. Buy at
[elite.charity/licence/buy/vendure-plugin-visitor-analytics](https://elite.charity/licence/buy/vendure-plugin-visitor-analytics).
