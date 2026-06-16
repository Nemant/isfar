# Analytics (see usage) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** See site usage (Cloudflare Web Analytics beacon on every page) and per-lookup product/operational events (Workers Analytics Engine in `isfar-flight`), centered on the cache-hit ratio and top routes.

**Architecture:** A1 adds the cookieless CF beacon `<script>` to the four page `<head>`s (one shared shell + three bespoke). A2 adds an Analytics Engine binding to the worker and emits one non-blocking `writeDataPoint` per `/api/flight` exit. A3 documents the query API. Live actions (flip `auto_install`, deploy worker) are isolated in a final gated task requiring user deploy authorization.

**Tech Stack:** Astro (SSG), Cloudflare Workers (`isfar-flight`, assets Worker `isfar`), Workers Analytics Engine, `node --test` for worker tests, wrangler.

**Spec:** `docs/superpowers/specs/2026-06-16-analytics-design.md`

**Established facts (verified):**
- Web Analytics property already exists for `isfar.app`: `site_tag fe65d368751c4df2af43e10aacc820c0`, public `site_token 5c747a2726d345e59c36739ba0d4fb15`, `auto_install: true` (NOT injecting into the Worker-served HTML — manual snippet required).
- The CF API token in `~/.isfar_env` (`CLOUDFLARE_API_TOKEN`; `source ~/.isfar_env` first, non-interactive shells don't load it) can read/write the RUM API. Account id `1eb2fd914b081774a2b5fe1db1fcecf0`.
- Worker tests: `worker/package.json` → `"test": "node --test \"test/*.mjs\""`, dependency-free `node:test` + `node:assert/strict`. Worker is `type: module`.
- Record shape (success): `{ found, code, dateISO, from:{iata,tz,...}, to:{iata,tz,...}, depUTC, arrUTC }`.
- `gen-sw-precache.mjs` only matches local `/_assets/…` refs — the cross-origin beacon is never precached (no change needed there).

---

## File Structure
- **Modify** `src/components/StaticShell.astro` — beacon in shared `<head>` (route pages, hubs, `/ar/`, `/faq`, 404).
- **Modify** `src/pages/index.astro` — beacon in the homepage `<head>`.
- **Modify** `src/pages/guide/far-north-prayer-times.astro` — beacon.
- **Modify** `src/pages/guide/the-skipped-day.astro` — beacon (unlisted but real traffic).
- **Modify** `worker/wrangler.toml` — `[[analytics_engine_datasets]]` binding.
- **Modify** `worker/src/index.js` — `routeOf`/`logEvent` helpers + emission at each `handleFlight` exit.
- **Create** `worker/test/events.test.mjs` — node:test for emission.
- **Create** `worker/ANALYTICS.md` — query cookbook.

---

## Task A1: Web Analytics beacon in the four heads

**Files:** Modify `src/components/StaticShell.astro`, `src/pages/index.astro`, `src/pages/guide/far-north-prayer-times.astro`, `src/pages/guide/the-skipped-day.astro`.

The beacon snippet (identical in all four):
```html
<!-- Cloudflare Web Analytics (cookieless, no consent banner). Public site token. -->
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"5c747a2726d345e59c36739ba0d4fb15"}'></script>
```

- [ ] **Step 1: Add the beacon to `StaticShell.astro`**

Open `src/components/StaticShell.astro`. Inside the `<head>` (it ends with the font `<link rel="preload">` lines before `</head>`), add the snippet just before `</head>`. Do NOT add a `<meta theme-color>` (iOS rule). This is a `<script>` only.

- [ ] **Step 2: Add the beacon to `index.astro`**

Open `src/pages/index.astro`. Add the same snippet just before `</head>` (the head is hand-written here; place it after the existing font preloads / JSON-LD, before `</head>`).

- [ ] **Step 3: Add the beacon to both guide pages**

Add the same snippet just before `</head>` in `src/pages/guide/far-north-prayer-times.astro` and in `src/pages/guide/the-skipped-day.astro`.

- [ ] **Step 4: Build and verify the beacon is in every page type**

Run: `npm run build`
Then verify it landed in each distinct page family and the precache count is sane:
```bash
grep -l "cloudflareinsights" dist/index.html dist/faq/index.html dist/prayer-times/index.html dist/prayer-times/*/index.html dist/ar/index.html dist/guide/far-north-prayer-times/index.html dist/guide/the-skipped-day/index.html dist/404.html | head
grep -c "cloudflareinsights" dist/index.html
```
Expected: every listed file matches; `dist/index.html` count is exactly `1`. Confirm the build log still shows `gen-sw-precache` wrote its entries (the cross-origin beacon must NOT appear in `dist/sw.js`):
```bash
grep -c "cloudflareinsights" dist/sw.js
```
Expected: `0`.

- [ ] **Step 5: Commit**
```bash
git add src/components/StaticShell.astro src/pages/index.astro src/pages/guide/far-north-prayer-times.astro src/pages/guide/the-skipped-day.astro
git commit -m "feat(analytics): add Cloudflare Web Analytics beacon to all page heads"
```

---

## Task A2: Workers Analytics Engine per-lookup events

**Files:** Modify `worker/wrangler.toml`, `worker/src/index.js`; Create `worker/test/events.test.mjs`.

- [ ] **Step 1: Write the failing test `worker/test/events.test.mjs`**

```js
// worker/test/events.test.mjs
//
// Dependency-free Node tests for the Analytics Engine emission added to the
// flight handler. We exercise the two exits that need NO upstream fetch:
//   - cache HIT  -> writeDataPoint(['LHR-JED','hit','ok'])
//   - blank code -> writeDataPoint(['','miss','notfound'])
// plus routeOf() purely, and the env.AE-absent no-throw guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { routeOf } from "../src/index.js";

function aeSpy() {
  const points = [];
  return { points, writeDataPoint: (p) => points.push(p) };
}
const req = (qs) => new Request("https://isfar.app/api/flight" + qs);

test("routeOf builds dep-arr or empty", () => {
  assert.equal(routeOf({ from: { iata: "LHR" }, to: { iata: "JED" } }), "LHR-JED");
  assert.equal(routeOf({}), "");
  assert.equal(routeOf(null), "");
});

test("cache hit emits hit/ok with the route", async () => {
  const AE = aeSpy();
  const cached = JSON.stringify({ found: true, from: { iata: "LHR" }, to: { iata: "JED" } });
  const env = { AE, FLIGHT_CACHE: { get: async () => cached, put: async () => {} } };
  const res = await worker.fetch(req("?code=SV124"), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(AE.points.length, 1);
  assert.deepEqual(AE.points[0].blobs, ["LHR-JED", "hit", "ok"]);
  assert.deepEqual(AE.points[0].indexes, ["LHR-JED"]);
});

test("blank code emits miss/notfound with empty route", async () => {
  const AE = aeSpy();
  const env = { AE, FLIGHT_CACHE: { get: async () => null, put: async () => {} } };
  const res = await worker.fetch(req("?code="), env, { waitUntil() {} });
  assert.equal(res.status, 404);
  assert.equal(AE.points.length, 1);
  assert.deepEqual(AE.points[0].blobs, ["", "miss", "notfound"]);
});

test("missing AE binding does not throw", async () => {
  const cached = JSON.stringify({ found: true, from: { iata: "LHR" }, to: { iata: "JED" } });
  const env = { FLIGHT_CACHE: { get: async () => cached, put: async () => {} } };
  const res = await worker.fetch(req("?code=SV124"), env, { waitUntil() {} });
  assert.equal(res.status, 200);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && node --test "test/events.test.mjs"; cd ..`
Expected: FAIL — `routeOf` is not exported / not defined, and emission assertions fail.

- [ ] **Step 3: Add the AE binding to `worker/wrangler.toml`**

Add this block (place it near the `[vars]` / KV section, top-level):
```toml
# --------------------------------------------------------------------------- #
# Workers Analytics Engine — one data point per /api/flight lookup.
#   blobs: [route, cacheHitMiss, errorKind]  indexes: [route]  doubles: [1]
# Query via the GraphQL/SQL API (see ANALYTICS.md). Free-plan friendly.
# --------------------------------------------------------------------------- #
[[analytics_engine_datasets]]
binding = "AE"
dataset = "isfar_lookups"
```

- [ ] **Step 4: Implement `routeOf` + `logEvent` and emit at each exit in `worker/src/index.js`**

Add these helpers near the other small helpers (after the `busy`/`notfound` helpers, before the date helpers):
```js
/* ----------------------------------------------------------------------- *
 * analytics-engine event (best-effort, never blocks or throws)
 * ----------------------------------------------------------------------- */

/** "DEP-ARR" IATA from a record, or "" when unresolved. */
export function routeOf(record) {
  try {
    if (record && record.from && record.to && record.from.iata && record.to.iata) {
      return record.from.iata + "-" + record.to.iata;
    }
  } catch (e) {}
  return "";
}

/** One data point per lookup. No-op when the AE binding is absent (local/test). */
function logEvent(env, route, cacheHitMiss, errorKind) {
  try {
    if (env && env.AE) {
      env.AE.writeDataPoint({
        blobs: [route || "", cacheHitMiss, errorKind],
        indexes: [route || ""],
        doubles: [1],
      });
    }
  } catch (e) {}
}
```

Then add a `logEvent(...)` call immediately before each `return` in `handleFlight`. Apply these edits:

1. Blank code (the `if (!code)` block):
```js
  if (!code) {
    logEvent(env, "", "miss", "notfound");
    return notfound("", { "X-Isfar-Cache": "miss" });
  }
```

2. Cache hit (the `if (cached)` block) — parse the cached body for the route:
```js
  if (cached) {
    let hitRoute = "";
    try { hitRoute = routeOf(JSON.parse(cached)); } catch (e) {}
    logEvent(env, hitRoute, "hit", "ok");
    return new Response(cached, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "X-Isfar-Cache": "hit",
      },
    });
  }
```

3. Turnstile failure:
```js
  if (!tsOk) { logEvent(env, "", "miss", "busy"); return busy(missHeaders); }
```

4. Daily ceiling:
```js
  if (!(await underDailyCeiling(env))) { logEvent(env, "", "miss", "busy"); return busy(missHeaders); }
```

5. AeroDataBox not-ok (both branches):
```js
  if (!adb.ok) {
    if (adb.status === 404) { logEvent(env, "", "miss", "notfound"); return notfound(code, missHeaders); }
    logEvent(env, "", "miss", "busy");
    return busy(missHeaders); // other upstream failure
  }
```

6. mapFlight not found:
```js
  if (!record.found) { logEvent(env, "", "miss", "notfound"); return notfound(code, missHeaders); }
```

7. Success (just before the final `return new Response(body, ...)`):
```js
  logEvent(env, routeOf(record), "miss", "ok");
  return new Response(body, {
```

Leave the top-level `catch (err) { return busy(); }` in the default `fetch` as-is (unexpected-error path; `env` event optional and skipped to keep that path minimal).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd worker && node --test "test/*.mjs"; cd ..`
Expected: all worker tests PASS (the existing `map.test.mjs` + the new `events.test.mjs`).

- [ ] **Step 6: Validate the worker still bundles**

Run: `cd worker && node validate.mjs 2>&1 | tail -5; cd ..` (if `validate.mjs` exists and runs offline). If it requires network/secrets, skip and note it. Do NOT run `wrangler deploy` here.

- [ ] **Step 7: Commit**
```bash
git add worker/wrangler.toml worker/src/index.js worker/test/events.test.mjs
git commit -m "feat(analytics): emit Workers Analytics Engine event per /api/flight lookup"
```

---

## Task A3: Query cookbook `worker/ANALYTICS.md`

**Files:** Create `worker/ANALYTICS.md`.

- [ ] **Step 1: Write `worker/ANALYTICS.md`**

Content:
```markdown
# Isfar analytics — querying usage

Two independent sources:

## 1. Web Analytics (site traffic)
Cloudflare dashboard → **Analytics & Logs → Web Analytics** → site `isfar.app`
(`site_tag fe65d368751c4df2af43e10aacc820c0`). Cookieless pageviews, top pages,
referrers, geo, Core Web Vitals. Beacon is the manual `<script>` in every page
`<head>` (see `src/components/StaticShell.astro` + the bespoke heads).
SPA note: the calculator pushes `?flight=…` / `?from=…` virtual pageviews via
the History API, which the beacon auto-tracks; the dashboard may roll these
under `/` rather than splitting by query string.

## 2. Workers Analytics Engine (`isfar_lookups` dataset)
One data point per `/api/flight` lookup, emitted by `worker/src/index.js`:
- `blob1` = route (`"LHR-JED"`, or `""` when unresolved)
- `blob2` = cache result (`"hit"` | `"miss"`)
- `blob3` = error kind (`"ok"` | `"notfound"` | `"busy"`)
- `index1` = route (sampling key)
- `double1` = 1 (count)

### SQL API
```bash
source ~/.isfar_env   # CLOUDFLARE_API_TOKEN
ACCT=1eb2fd914b081774a2b5fe1db1fcecf0
curl -4 "https://api.cloudflare.com/client/v4/accounts/$ACCT/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "SELECT blob1 AS route, blob2 AS cache, blob3 AS err, sum(_sample_interval) AS n
          FROM isfar_lookups
          WHERE timestamp > now() - INTERVAL '1' DAY
          GROUP BY route, cache, err ORDER BY n DESC"
```

### Cache-hit ratio (the cost-shield health number)
```sql
SELECT
  sumIf(_sample_interval, blob2 = 'hit')  AS hits,
  sum(_sample_interval)                    AS total,
  hits / total                             AS hit_ratio
FROM isfar_lookups
WHERE timestamp > now() - INTERVAL '1' DAY
```

### Top routes (feeds the GSC-gated SEO route waves)
```sql
SELECT blob1 AS route, sum(_sample_interval) AS n
FROM isfar_lookups
WHERE blob1 != '' AND timestamp > now() - INTERVAL '7' DAY
GROUP BY route ORDER BY n DESC LIMIT 25
```

### Error-kind breakdown (busy = ceiling/upstream pressure; feeds alerting)
```sql
SELECT blob3 AS err, sum(_sample_interval) AS n
FROM isfar_lookups
WHERE timestamp > now() - INTERVAL '1' DAY
GROUP BY err ORDER BY n DESC
```

These queries are what the sub-project C cron alert worker will automate.
```

- [ ] **Step 2: Commit**
```bash
git add worker/ANALYTICS.md
git commit -m "docs(analytics): query cookbook for Web Analytics + Analytics Engine"
```

---

## Task A4 (GATED — requires user deploy authorization): go live

Do NOT run any of these until the user explicitly authorizes deploying. Deploying `isfar-flight` and changing the live Web Analytics config are outward-facing actions.

- [ ] **Step 1: Flip `auto_install` → false (avoid future double-counting)**

```bash
source ~/.isfar_env
ACCT=1eb2fd914b081774a2b5fe1db1fcecf0
SITE=fe65d368751c4df2af43e10aacc820c0
curl -4 -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCT/rum/site_info/$SITE" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"zone_tag":"71ce5d732982c453417b9d19f05a4fc8","auto_install":false}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("success:",d.get("success"),"auto_install:",(d.get("result") or {}).get("auto_install"),"errors:",d.get("errors"))'
```
Expected: `success: True auto_install: False`. (If the API rejects the body shape, fetch the current site object first and PUT it back with `auto_install:false`.)

- [ ] **Step 2: Deploy the worker (Analytics Engine binding goes live)**
```bash
source ~/.isfar_env
cd worker && wrangler deploy 2>&1 | tail -15; cd ..
```
Expected: deploy succeeds; the dashboard shows the `isfar_lookups` dataset bound.

- [ ] **Step 3: Ship the beacon** — the beacon is in the site build; it goes live when the branch is merged to `main` (the `isfar` Workers Build deploy). This happens in the branch-finishing step, not here.

- [ ] **Step 4: Verify live (after merge)**
```bash
curl -4 -s https://isfar.app/ | grep -o 'cloudflareinsights' | head -1   # beacon present
curl -4 -s "https://isfar.app/api/flight?code=BA117" -o /dev/null -w "%{http_code} %header{x-isfar-cache}\n"
```
Then after a few minutes, run the cache-hit-ratio SQL query from `ANALYTICS.md` and confirm data points are arriving.

---

## Self-review notes (author)
- **Spec coverage:** A1 beacon in 4 heads (Task A1) + flip auto_install (Task A4 Step 1); A2 binding + per-lookup event with `[route, cacheHitMiss, errorKind]` (Task A2); A3 query doc (Task A3); deploy gating (Task A4). All covered.
- **No client mode-split event** — correctly absent (dropped in brainstorm).
- **iOS rule** honored — beacon is a `<script>`, no `<meta theme-color>`.
- **SW precache** — Step A1.4 asserts `0` beacon refs in `dist/sw.js`.
- **Type consistency:** `routeOf(record)→string`, `logEvent(env, route, cacheHitMiss, errorKind)`, blobs order `[route, cacheHitMiss, errorKind]`, indexes `[route]` — consistent across index.js, the test, and ANALYTICS.md.
- **Worker test style:** `node:test` + `node:assert/strict`, dependency-free, exercises only the no-fetch exits (hit, blank) + pure `routeOf` + AE-absent guard — matches `map.test.mjs` conventions.
