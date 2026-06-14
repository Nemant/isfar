# Isfar — Remaining work

`isfar.app` is live and shipped: real abuse-protected flight lookups in dual time zones, the Astro
SSG + `client:only` React island stack, the high-latitude policy engine, and SEO Phase D wave 1
(crawlable homepage, 48 EN+AR route pages + hubs, the far-north guide, build-time sitemap,
hreflang). Operational ids/gotchas live in the `isfar-cloud-infra` memory. Architecture is in
`CLAUDE.md`. This file tracks only what's **left**.

## Observability & scale

The app is static SSG + a stateless Worker + client-side adhan compute — **no origin, DB, or server
render to scale.** Surviving a traffic spike is almost entirely a *plan-tier + API-key* problem, not
an architecture one; the only code-side lever is raising cache hit-rate. So the work here is three
things: see usage, get warned before a free-plan limit bites, and know which upgrade to reach for.

### Analytics — see usage

- **Cloudflare Web Analytics on the static site.** Free, cookieless, no consent banner needed (fits
  the calm/minimal ethos — *don't* add Google Analytics). Drop the beacon into the page shells
  (`index.astro` + the guide/route templates). Gives pageviews, top routes/guides, referrers, geos.
  *[User enables the property; Claude adds the beacon.]*
- **Product events via Workers Analytics Engine.** In `isfar-flight`, `writeDataPoint` one event per
  lookup: `{mode: flight#|route, route, cacheHitMiss, errorKind, method}`. Reveals lookup volume,
  **cache-hit ratio** (how well the cost-shield is working), and which routes are popular — which
  feeds the GSC-gated SEO route waves. Query via the GraphQL/SQL API. *[Claude.]*

### Monitoring & alerting — know when to act

The `isfar-flight` worker already meters cache hit/miss (`X-Isfar-Cache`), the daily `CEILING=1000`
counter, and rate-limit 429s. Surface and alarm on them with a cron-triggered Worker that reads the
KV / Analytics-Engine counters daily (and on threshold breach) and pushes to a channel you actually
watch — email, Telegram/Discord webhook, or Cloudflare Notifications. *[User picks the channel;
Claude builds the cron worker + thresholds.]* Alerts to wire:

- **Ceiling — the upgrade trigger.** Fire at ~80% of the daily upstream `CEILING` so you can raise
  it / upgrade the AeroDataBox tier **before** lookups start returning `busy`.
- **Upstream failure.** AeroDataBox 5xx + RapidAPI **429** (the 1 QPS ceiling) rate over a window —
  the signal to provision more keys (see *Scaling levers*) or bump the tier.
- **Uptime/latency.** External pinger (UptimeRobot free, or Cloudflare Health Checks) hitting
  `isfar.app/` and `/api/flight?code=…` from a couple of regions, alerting on outage independent of
  Cloudflare's own signals. *[User sets up the monitor; Claude supplies the health URLs.]*
- **Zero-code backstop.** Turn on Cloudflare **Notifications** for Worker error-rate, and for the
  daily request/KV-usage trend (the free-plan cliffs below). *[User toggles in the dashboard.]*

### Scaling levers & free-plan limits

What breaks first under a spike, and the lever for each:

- **Worker requests — the real cliff.** Free plan = **100k invocations/day**, shared across *both*
  workers (every page load hits `isfar`, every lookup hits `isfar-flight`). Static assets are
  edge-cached so repeat loads are cheap, but invocations still count. **Lever:** Workers Paid
  (~$5/mo → 10M req/mo, more CPU, longer rate-limit windows) the moment you trend toward 100k/day —
  the first thing to buy if you go viral.
- **KV reads.** Free = **100k reads/day**; every cache-hit lookup is a read. The 6h/30d TTLs already
  maximise hits; a short edge **Cache API** layer in front of KV for hot flights would absorb more.
  **Lever:** Workers Paid raises the limit; the Cache-API layer is the code-side win.
- **AeroDataBox 1 QPS / tier — the upstream bottleneck.** The active key caps upstream at ~1 req/sec.
  Provision several keys (each its own secret, `RAPIDAPI_KEY_1..N`) and round-robin them in the
  Worker, plus a tier upgrade. `CEILING` + the per-IP rate limit keep the bill bounded while you
  react. *[User owns billing/key generation; Claude wires the round-robin.]*

## Engine follow-ups

- **True "next departure ≥ now" date resolution.** The Worker currently uses "today UTC + first
  matching segment"; implement true next-departure resolution + the optional date chip already in
  the UI.
- **Per-flight cruise altitude.** Read true cruise altitude per flight instead of the 38,000 ft
  default.
- **adhan local-getter date drift (pre-existing quirk).** adhan reads the calendar day off the
  `Date` with **local** getters, so on a device whose tz is far from UTC `Date.UTC(y,m,d,12)` can
  map to the adjacent solar day (times shift ~1–4 min). Harmless and uniform; fix would pass adhan a
  date built from local components.

## SEO Phase D — forward timeline

Data-gated: expansion follows Search Console, never bulk page dumps on a young domain.
Design strategy: balanced, quality-first waves. Three parallel workstreams below —
**Guides**, **i18n**, and **Other** (search-console setup + data-gated route waves + off-page).

### Guides — the content moat

Methodology and how-to articles. Two are published: `far-north-prayer-times` (listed/indexed) and
`the-skipped-day` (unlisted + noindex). Each new guide is its own `src/pages/guide/…astro` page
(zero-JS-island SSG, BlogPosting/FAQPage JSON-LD, shared theme machinery — see CLAUDE.md). These are
three **distinct** posts, not one — "how to pray on a plane" is the practical how-to; "asr fails
first" is a far-north methodology piece; "the skipped-day" is the transpolar istiftāʾ.

| Target | Guide | Status |
|---|---|---|
| 2026-06-18 | **How to pray on a plane** — the head query. The practical how-to: when each of the five prayers falls across a flight, dual time zones, qasr/jam' pointer. | not drafted yet |
| 2026-06-25 | **Asr fails first** — far-north methodology companion (why Asr breaks ~13 days before polar night). Listed/indexed; crosslinks `far-north-prayer-times` both ways. | draft notes: `docs/blog/2026-06-14-asr-fails-first.md` |
| _blocked_ | **The skipped-day** — EWR→HKG Dec transpolar istiftāʾ (`/guide/the-skipped-day/`, live but **unlisted + noindex**). Page and figures already built; the open religious questions are written as an istiftāʾ. **Finish once a sheikh answers**, then decide whether to flip it to indexed. | awaiting fatwā |
| 2026-07-23 | **Qibla on a plane**. | planned |
| 2026-08-06 | **Qasr & jam' on a flight**. | planned |
| 2026-12-09 | **Fasting on a flight** (~10 weeks before Ramadan 2027). | planned |

### i18n — one language at a time, whole site each

Each language is a **single self-contained task**: translate the **entire** site in that locale —
the React app island, every guide, and all route/hub pages — then ship it with hreflang wired. We do
**not** split a language across waves (no "Arabic routes now, Arabic app later"). A half-translated
locale never goes live. Order is GSC-prioritized: do the language Search Console shows the most
demand for next.

| Target | Language | Scope (all of it, or it doesn't ship) |
|---|---|---|
| 2026-07-09 | **Arabic** (`ar`, RTL) | App island (RTL UI), all guides, all route/hub pages, hreflang. |
| 2026-08-13 | **Urdu** (`ur`, RTL) | Full site. |
| 2026-09-10 | **Indonesian** (`id`) | Full site. |
| 2026-10-08 | **Turkish** (`tr`) | Full site. |

After each language: hreflang audit + GSC re-check to confirm the next language's demand before
starting it.

### Other — search consoles, route waves, off-page

Mostly user-driven (billing, account verification, outreach); Claude wires whatever is code-side.

- **Google Search Console — the data gate.** Keep the domain property verified and watch
  queries/impressions; it gates every route wave below. *[User.]*
- **Bing Webmaster Tools.** Set up + verify the property, submit `sitemap.xml`; optionally enable
  IndexNow for instant push. Cheap incremental reach (Bing/DuckDuckGo/ChatGPT search). *[User sets
  up; Claude wires IndexNow if wanted.]*
- **Route wave 2** (2026-06-25) — +~100 pages, GSC-informed. *[Claude, once GSC shows demand.]*
- **Route wave 3** (2026-07-23) — purely GSC-driven; **prune zero-impression pages**. *[Claude.]*
- **Per-route OG images** — ongoing. *[Claude.]*
- **Off-page** — Product Hunt launch, Muslim-travel communities. *[User-driven.]*

## Native apps (iOS / Android)

The app is **already a PWA** (manifest, service worker, offline replay of saved flights, install
nudge), so "add to home screen" works on both platforms today — that covers most users for $0. The
open work is only if we want **App Store / Play Store** listings. No rewrite either way: the existing
`dist/` build is the payload.

- **Capacitor wrap — the both-platforms path.** Point Capacitor's `webDir` at `dist`, `cap add ios` /
  `cap add android`, ship real `.ipa`/`.aab` artifacts. Reuses the build verbatim; opens native APIs
  (share sheet, push) if ever wanted. Effort is ~a day of code, then the real cost is **store admin**:
  Apple Developer ($99/yr), Google Play ($25 once), icons/screenshots/review. *[User owns store
  accounts + paperwork; Claude scaffolds the Capacitor projects.]*
- **Android-only shortcut — TWA via PWABuilder/Bubblewrap.** Because we're a clean PWA, PWABuilder can
  generate a thin Play Store wrapper around live `isfar.app` (no bundled assets). Skip on iOS (no TWA
  equivalent — use Capacitor there). *[Claude generates; user submits.]*
- **Caveats to re-test inside a WebView (not Safari):** (1) the iOS edge-to-edge chrome handling
  (`viewport-fit=cover`, no `theme-color`, safe-area insets — see CLAUDE.md) renders differently in a
  Capacitor WebView; re-verify the status-bar look and insets. (2) `/api/flight` lookups are plain
  HTTPS to our Worker — fine in a wrapper, but confirm the WebView allows the same-origin request.
  (3) **Apple review risk:** Apple can reject "just a website" apps; our offline saved-flights +
  focused UI is defensible, but it's the one genuine uncertainty.

## Small notes

- **Favicon source:** `favicon.ico` is downscaled from `icon-192.png` via Pillow. If the brand mark
  changes, regenerate it.
