# Analytics (see usage) — design

**Date:** 2026-06-16
**Status:** approved (brainstorm), pre-implementation
**Sub-project A** of the analytics/observability workstream (build order: **B → A → C**).
Implements the "Analytics — see usage" section of `ROADMAP.md`.

## Goal

Two independent signals:
1. **Site traffic** — pageviews / top pages / referrers / geo, cookieless, no
   consent banner (fits the calm/minimal ethos; **not** Google Analytics).
2. **Product/operational events** — per-lookup data from the `isfar-flight`
   Worker, primarily the **cache-hit ratio** (how well the cost-shield works)
   and **top routes** (feeds the GSC-gated SEO waves and sub-project C alerts).

Explicitly **dropped** in brainstorm: a client-side mode-split (manual vs
flight#) / calc-method event. Route-mode lookups never reach the Worker and the
method is client-only, so a worker-only design can't see them — and the user
decided the split isn't worth the added client complexity.

## A1 — Cloudflare Web Analytics beacon

### Facts established
- A Web Analytics property for `isfar.app` **already exists** (`site_tag
  fe65d368751c4df2af43e10aacc820c0`) with a public `site_token`.
- `auto_install` is **true** but is **NOT injecting** into the Worker-served
  HTML (verified: no beacon in live `isfar.app/` or `/prayer-times/`). Automatic
  injection doesn't apply to the static-asset Worker's responses → the **manual
  snippet** is required.
- The CF API token in `~/.isfar_env` **can** read/write the RUM API (verified
  `rum/site_info/list` → success). So Claude fetches the token and flips
  `auto_install` itself; no user dashboard step needed.

### Work
- Fetch the property's `site_token` via the RUM API at implementation time.
- Add the beacon to the **four** `<head>`s (one shared + three bespoke):
  - `src/components/StaticShell.astro` (route pages, hubs, `/ar/`, `/faq`, 404)
  - `src/pages/index.astro`
  - `src/pages/guide/far-north-prayer-times.astro`
  - `src/pages/guide/the-skipped-day.astro` (unlisted but real traffic)
- Snippet (token hardcoded — it is **public by design**, ships to every visitor):
  ```html
  <script defer src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token":"<SITE_TOKEN>"}'></script>
  ```
- **Flip `auto_install` → false** via the RUM API (`PUT
  /accounts/{acct}/rum/site_info/{site_tag}`) so we never double-count if CF's
  injector ever starts working on Worker responses.

### Why this also serves sub-project B
The beacon **auto-tracks SPA route changes** — it overrides `history.pushState`
and listens for `popstate`, emitting a virtual pageview on each client-side
navigation, no reload required ([CF SPA docs]). So B's `?flight=…` / `?from=…`
pushState transitions are counted. Honest caveat: whether the CF dashboard
*splits* counts by query string (vs rolling under `/`) is **uncertain** — but
with mode-split dropped, that doesn't block anything; raw "reached a result"
virtual pageviews fire regardless. Constraints honored by B: string URL (not a
`URL` object), no hash routing.

[CF SPA docs]: https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/

### Non-impact checks (verified)
- `gen-sw-precache.mjs` only collects local `dist/` files and `/_assets/…`
  refs (`ASSET_REF = /_assets\/…/`); the cross-origin beacon is never matched →
  not precached, generator unaffected. (Confirm at build: beacon present in
  emitted HTML, precache count unchanged.)
- The SW fetch handler should ignore cross-origin requests (same-origin guard) —
  confirm the beacon load/sendBeacon to `static.cloudflareinsights.com` /
  `/cdn-cgi/rum` is not intercepted/broken by the SW.
- iOS chrome rule: this is a `<script>`, **not** a `<meta theme-color>` — no
  regression to the translucent-bars behavior.

## A2 — Worker product events (Workers Analytics Engine)

### Binding
Add to `worker/wrangler.toml`:
```toml
[[analytics_engine_datasets]]
binding = "AE"
dataset = "isfar_lookups"
```

### Emission (in `worker/src/index.js`)
One **non-blocking** `env.AE.writeDataPoint(...)` per `/api/flight` request, at
each exit (cache hit, miss-success, notfound, busy). `writeDataPoint` returns
void and buffers locally, so **no `ctx`/`waitUntil` threading is needed**. Guard
on `env.AE` so local `wrangler dev` / tests without the binding still run.

Event shape:
```js
env.AE && env.AE.writeDataPoint({
  blobs:   [route, cacheHitMiss, errorKind],  // strings
  indexes: [route],                            // sampling key (≤96 bytes)
  doubles: [1],                                // count
});
```
- `cacheHitMiss ∈ {"hit","miss"}` — already known at each exit
  (`X-Isfar-Cache`).
- `errorKind ∈ {"ok","notfound","busy"}` — mirrors the response.
- `route` — `"<dep>-<arr>"` IATA from the resolved record (`record.from.iata +
  "-" + record.to.iata`); `""` when unresolved (notfound/busy/blank). On a
  **cache hit**, `JSON.parse(cached)` and read `from.iata`/`to.iata` from it
  (cheap, hit-path only). On miss-success, read from the freshly mapped
  `record`. A single `routeOf(record)` helper covers both.
- Implementation: a small `logEvent(env, {route, cacheHitMiss, errorKind})`
  helper called just before each `return`, keeping handler exits readable.

### Querying — `worker/ANALYTICS.md`
Document ready-to-run queries against the dataset (GraphQL `viewer.accounts.
analyticsEngineAdaptiveGroups` or the SQL API), covering:
- **lookup volume** over time,
- **cache-hit ratio** = hits / total (the cost-shield health number),
- **top routes** by count,
- **error-kind breakdown** (busy/notfound rate).
Include the account id and dataset name and a `curl` example. These queries are
what sub-project C's cron worker will automate.

## Testing (TDD)
- `worker/test/` — currently only `map.test.mjs`. Add an events test with a
  **mock `AE` binding** (`writeDataPoint` spy) and a mock `FLIGHT_CACHE`:
  - cache hit → one event, `cacheHitMiss:"hit"`, `errorKind:"ok"`, route parsed
    from cached body.
  - miss-success → `"miss"` / `"ok"` / route from record.
  - notfound → `"miss"` / `"notfound"` / `route:""`.
  - busy (ceiling or upstream) → `"miss"` / `"busy"` / `""`.
  - `env.AE` **absent** → handler still returns the correct response (no throw).
- Engine/site: `npm test` then `npm run build && npm run preview`; confirm the
  beacon is in the built HTML and the precache count is unchanged.

## Deploy
- **A1 (beacon)** ships via the normal push-to-`main` Workers Build. The
  `auto_install:false` flip is a one-off API call (Claude).
- **A2 (AE binding + event)** requires a separate `wrangler deploy` of
  `isfar-flight` — needs explicit user authorization per the deploy-auth rule.
- Both: deploy only after B is verified live (build order).

## Out of scope
- Client-side product events / mode-split / method (dropped).
- Monitoring, thresholds, alerting (sub-project C — separate spec; consumes the
  KV ceiling counter + this AE dataset).
