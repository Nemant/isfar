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
Design strategy: balanced, quality-first waves.

| Date | Work |
|---|---|
| 2026-06-18 | Guide #2: "How to pray on a plane" (the head query). *(draft in progress: `docs/blog/2026-06-14-asr-fails-first.md`)* |
| 2026-06-25 | Route wave 2 (+~100, GSC-informed) · Guide #3: "Qibla on a plane". |
| 2026-07-09 | i18n wave 2: app island Arabic (RTL UI), Arabic guides; Urdu route pages if GSC warrants. |
| 2026-07-23 | Route wave 3 (purely GSC-driven; prune zero-impression pages) · Guide #4: qasr & jam'. |
| 2026-08-06 | i18n wave 3: Indonesian + Turkish; hreflang audit. |
| 2026-12-09 | Guide #5: "Fasting on a flight" (~10 weeks before Ramadan 2027). |
| ongoing | Per-route OG images; off-page (Product Hunt, Muslim-travel communities — user-driven). |

## Small notes

- **Favicon source:** `favicon.ico` is downscaled from `icon-192.png` via Pillow. If the brand mark
  changes, regenerate it.
