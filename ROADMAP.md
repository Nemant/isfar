# Isfar — Remaining work

`isfar.app` is live and shipped: real abuse-protected flight lookups in dual time zones, the Astro
SSG + `client:only` React island stack, the high-latitude policy engine, and SEO Phase D wave 1
(crawlable homepage, 48 EN+AR route pages + hubs, the far-north guide, build-time sitemap,
hreflang). Operational ids/gotchas live in the `isfar-cloud-infra` memory. Architecture is in
`CLAUDE.md`. This file tracks only what's **left**.

## Observability & scale

The app is static SSG + a stateless Worker + client-side adhan compute — **no origin, DB, or server
render to scale.** Surviving a traffic spike is almost entirely a *plan-tier + API-key* problem, not
an architecture one; the only code-side lever is raising cache hit-rate. **Analytics and alerting are
shipped** (below); what's left is the user-side uptime monitor and knowing which upgrade to reach for
(the scaling-lever reference).

### Analytics — see usage ✅ shipped (2026-06-16)

- **Cloudflare Web Analytics** — cookieless beacon live in every page `<head>` (`StaticShell.astro`
  shell + `index.astro` + both guide pages; `auto_install` set to "JS Snippet installation" so the
  manual beacon is the only one — no double-count). Pageviews, top pages, referrers, geo in the
  dashboard. (No Google Analytics, per the calm/minimal ethos.)
- **Workers Analytics Engine** — `isfar-flight` writes one data point per `/api/flight` lookup
  (`blobs:[route, cacheHitMiss, errorKind]`, dataset `isfar_lookups`). Reveals lookup volume, the
  **cache-hit ratio** (cost-shield health), and top routes — which feed the GSC-gated SEO route waves.
  Query cookbook: `worker/ANALYTICS.md`. (Worker-only: route-mode lookups are client-side and the
  calc method is client-only, so the `mode`/`method` split was dropped by design.)

### Monitoring & alerting — know when to act ✅ shipped (2026-06-16)

`isfar-monitor` (`monitor/`) is a separate hourly-cron Worker that emails (Resend, from
`alerts@isfar.app`) on two thresholds, de-duped:

- **Ceiling — the upgrade trigger.** Today's upstream count ≥ 80% of `isfar-flight`'s **live**
  `CEILING` (read via the Workers settings API — single source of truth). One email/day. Raise the
  ceiling / upgrade the AeroDataBox tier **before** lookups start returning `busy`.
- **Busy rate.** `busy/total ≥ 25%` with ≥8 lookups over the last hour (from `isfar_lookups`). One
  email per 6h. A sustained rate is a signal to *investigate* (stampede on a hot flight? upstream
  5xx/429?), not a reflex to provision keys — see the headroom math in `worker/CAPACITY.md`.

Secret-gated probe at `isfar-monitor.isfar-app.workers.dev/?token=…` (`&email=1` sends a test). Full
ops detail in `monitor/README.md`.

**Still to do (user actions):**
- **Uptime/latency.** External pinger (UptimeRobot free, or Cloudflare Health Checks) hitting
  `isfar.app/` and `/api/flight?code=…` from a couple of regions, alerting on outage independent of
  Cloudflare's own signals. Health URLs are in `monitor/README.md`. *[User sets up the monitor.]*
- **Zero-code backstop.** Turn on Cloudflare **Notifications** for Worker error-rate, and for the
  daily request/KV-usage trend (the free-plan cliffs below). *[User toggles in the dashboard.]*

### Scaling levers & free-plan limits

What breaks first under a spike, and the lever for each:

- **Worker requests — the real cliff.** Free plan = **100k invocations/day**, shared across the
  request-serving workers (every page load hits `isfar`, every lookup hits `isfar-flight`;
  `isfar-monitor`'s ~24 cron runs/day are negligible). Static assets are edge-cached so repeat loads
  are cheap, but invocations still count. **Lever:** Workers Paid
  (~$5/mo → 10M req/mo, more CPU, longer rate-limit windows) the moment you trend toward 100k/day —
  the first thing to buy if you go viral.
- **KV reads.** Free = **100k reads/day**; every cache-hit lookup is a read. The 6h/30d TTLs already
  maximise hits; a short edge **Cache API** layer in front of KV for hot flights would absorb more.
  **Lever:** Workers Paid raises the limit; the Cache-API layer is the code-side win.

> **Not on this list: the AeroDataBox 1 QPS rate limit.** It looks like a bottleneck but never binds
> — the `CEILING=1000/day` cost cap and the monthly plan quota are hit first, by ~86×. See
> [`worker/CAPACITY.md`](./worker/CAPACITY.md) for the full Poisson/stampede math. The only upstream
> scaling lever that ever matters is the **monthly quota / tier upgrade**, driven by the Ceiling
> alert above; multi-key round-robin is unnecessary at any plausible scale.

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
| 2026-07-02 | **The higher you fly, the later the sun sets** — altitude/horizon-dip methodology piece: how cruise altitude bends Maghrib and the Fajr-ending sunrise, and why a turboprop at dawn is the case that bites. Listed/indexed; crosslinks `far-north-prayer-times` + `asr-fails-first`. Backs the shipped `estimateCruiseFt` engine change. | draft notes: `docs/blog/2026-06-16-the-higher-you-fly-the-later-the-sun-sets.md` |
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

- **Google Search Console — the data gate.** ✅ Domain property `isfar.app` verified (Cloudflare↔Google
  auto-DNS) and `sitemap.xml` submitted (102 URLs) 2026-06-19. Ongoing: watch the Performance tab —
  queries/impressions gate every route wave below. *[User.]*
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
