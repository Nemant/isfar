# Isfar — Remaining work

`isfar.app` is live and shipped: real abuse-protected flight lookups in dual time zones, the Astro
SSG + `client:only` React island stack, the high-latitude policy engine, and SEO Phase D wave 1
(crawlable homepage, 48 EN+AR route pages + hubs, the far-north guide, build-time sitemap,
hreflang). Operational ids/gotchas live in the `isfar-cloud-infra` memory. Architecture is in
`CLAUDE.md`. This file tracks only what's **left**.

## Infra / throughput

- **Pool additional RapidAPI/AeroDataBox keys (bypass the 1 QPS limit).** The active key caps
  upstream at ~1 request/sec. Provision several keys (each its own secret, `RAPIDAPI_KEY_1..N`) and
  round-robin them in the Worker to raise effective throughput before any wider launch. *[User owns
  the billing/key generation; Claude wires the round-robin.]*

## Observability & scale (pre-viral readiness)

The app is static SSG + a tiny stateless Worker + client-side adhan compute — **no origin, DB, or
server render to scale.** Going viral is almost entirely a *plan-tier + API-key* problem, not an
architecture one. The work here is: see usage, get warned before a limit bites, and know the
upgrade lever.

### Analytics — see app usage

- **Cloudflare Web Analytics on the static site.** Free, cookieless, no consent banner needed (fits
  the calm/minimal ethos — *don't* add Google Analytics). Drop the beacon into the page shells
  (`index.astro` + the guide/route templates). Gives pageviews, top routes/guides, referrers, geos.
  *[User enables the property in the dashboard; Claude adds the beacon.]*
- **Product events via Workers Analytics Engine.** In `isfar-flight`, `writeDataPoint` one event per
  lookup: `{mode: flight#|route, route, cacheHitMiss, errorKind, method}`. Reveals real lookup
  volume, **cache-hit ratio** (how well the cost-shield is working), and which routes are popular —
  which directly feeds the GSC-gated SEO route waves. Query via the GraphQL/SQL API. *[Claude.]*

### API monitoring + alerting — know when to upgrade

The `isfar-flight` worker already meters cache hit/miss (`X-Isfar-Cache`), the daily `CEILING=1000`
counter, and rate-limit 429s. Surface and alarm on them:

- **Ceiling alert (the upgrade trigger).** Notify at ~80% of the daily upstream `CEILING` so you can
  raise it / upgrade the AeroDataBox tier **before** lookups start returning `busy`.
- **Upstream-failure alert.** Alarm on AeroDataBox 5xx and RapidAPI **429** (the 1 QPS ceiling) rate
  over a window — that's the signal to ship the key pool (see *Infra / throughput*) or bump the tier.
- **Delivery.** A cron-triggered Worker reads the KV / Analytics-Engine counters daily (and on
  threshold breach) and pushes to a channel you actually watch — email, Telegram/Discord webhook, or
  Cloudflare Notifications. *[User picks the channel; Claude builds the cron worker + thresholds.]*
- **Zero-code backstop:** turn on Cloudflare **Notifications** for Worker error-rate and the zone.
  *[User toggles in the dashboard.]*

### Viral-survival monitoring + the scaling levers

Free-plan ceilings, in the order they'd break under a spike:

- **Worker requests — the real cliff.** Free plan = **100k Worker invocations/day**, shared across
  *both* workers (every page load hits `isfar`, every lookup hits `isfar-flight`). A viral day blows
  past this. Static assets are edge-cached so repeat loads are cheap, but invocations still count.
  **Upgrade:** Workers Paid (~$5/mo → 10M req/mo, more CPU, longer rate-limit windows) the moment you
  trend toward 100k/day. This is the first thing to buy if you go viral. *Watch:* per-worker daily
  request count (dashboard + a Notification).
- **KV reads.** Free = **100k reads/day**; every cache-hit lookup is a read — same spike risk. The
  6h/30d TTLs already maximise hits; a short edge **Cache API** layer in front of KV for hot flights
  would absorb more. Workers Paid raises the limit. *Watch:* KV daily ops.
- **AeroDataBox 1 QPS / tier.** The genuine upstream bottleneck under load — handled by key pooling
  (*Infra / throughput*) + a tier upgrade. `CEILING` + the rate limit keep the bill bounded while
  you react.
- **Uptime/latency monitor.** External pinger (UptimeRobot free, or Cloudflare Health Checks) hitting
  `isfar.app/` and `/api/flight?code=…` from a couple of regions, alerting on outage independent of
  Cloudflare's own signals. *[User sets up the monitor; Claude supplies the exact health URLs.]*

**Net:** the only code-side scaling lever is raising **cache hit-rate** (TTLs + an edge cache layer)
to keep KV reads and upstream calls flat as traffic climbs. Everything else is a dashboard toggle or
a plan/key upgrade — provisioned *ahead* of need via the alerts above.

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
