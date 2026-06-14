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
