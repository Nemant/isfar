# SEO Phase D Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SEO wave 1: crawlable homepage, 48 engine-computed route pages (EN+AR) + hubs, 404, build-time sitemap, hreflang, app deep-link prefill.

**Architecture:** Pure-SSG pages (zero new islands) computed at build by the existing engine via `routeRecord()`. One tested lib (`route-pages.js`) produces all per-route data; Astro templates render it. Arabic pages reuse the same data through a translations module.

**Tech Stack:** Astro SSG, adhan (qibla only — never prayer math by hand), vitest, existing engine/airports libs.

**Spec:** `docs/superpowers/specs/2026-06-11-seo-phase-d-design.md`

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/routes-wave1.js` | Create | The curated 24-corridor (48 directional) route list, as IATA pairs + corridor group labels. |
| `src/lib/route-pages.js` | Create | Build-time route data: `resolveAirport`, `estimateDurationMin`, `routeFacts`, `seasonalSchedule`, `routeSlug`. Pure; Node-safe; tested. |
| `tests/route-pages.test.js` | Create | Pins LHR→JED facts + schedule; invariants over all 48 routes. |
| `src/lib/i18n-ar.js` | Create | Arabic template strings + city-name map for wave-1 airports. |
| `src/pages/prayer-times/[route].astro` | Create | EN route page template (head, JSON-LD, tables, FAQ, CTA, related). |
| `src/pages/prayer-times/index.astro` | Create | EN routes hub, grouped by corridor. |
| `src/pages/ar/prayer-times/[route].astro` | Create | AR route page (RTL). |
| `src/pages/ar/prayer-times/index.astro` | Create | AR hub. |
| `src/pages/ar/index.astro` | Create | AR landing (what Isfar does + FAQ in Arabic). |
| `src/pages/404.astro` | Create | Branded 404. |
| `src/styles/routes.css` | Create | Static-page layer for route pages + homepage static section (token-based, like blog.css). |
| `src/pages/index.astro` | Modify | sr-only h1, static how-it-works + visible FAQ section after `#root`, footer links, hreflang. |
| `src/components/Calculator.jsx` | Modify | Mount-time `?from=&to=` → route mode prefill. |
| `src/components/route-form.jsx` | Modify | Accept initial airport values. |
| `scripts/gen-sitemap.mjs` | Create | Walk `dist/` → `dist/sitemap.xml` with lastmod + hreflang pairs. |
| `public/sitemap.xml` | Delete | Replaced by generated one. |
| `wrangler.toml` | Modify | `not_found_handling = "404-page"`. |
| `package.json` | Modify | Append `node scripts/gen-sitemap.mjs` to build. |
| `ROADMAP.md` | Modify | Phase D wave-1 status + dated timeline. |

Constants shared: `routeSlug(from,to)` = `` `${from}-to-${to}`.toLowerCase() ``; pages live at `/prayer-times/<slug>/`, AR at `/ar/prayer-times/<slug>/`. Seasonal sample dates `['2026-06-21','2026-09-22','2026-12-21']`, departures `['09:00','21:00']`, method `MuslimWorldLeague`, madhab `shafi` (the app defaults). `LASTMOD = '2026-06-11'`.

---

### Task 1: Route list + route-pages lib (TDD)

**Files:** Create `src/lib/routes-wave1.js`, `src/lib/route-pages.js`, `tests/route-pages.test.js`.

- [ ] **Step 1: failing test** — `tests/route-pages.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { CORRIDORS, WAVE1_ROUTES } from '../src/lib/routes-wave1.js';
import { resolveAirport, estimateDurationMin, routeFacts, seasonalSchedule, routeSlug, SEASON_DATES, DEP_TIMES } from '../src/lib/route-pages.js';

describe('routes-wave1', () => {
  it('48 directional routes, all airports resolve, slugs unique', () => {
    expect(WAVE1_ROUTES.length).toBe(48);
    const slugs = new Set();
    for (const r of WAVE1_ROUTES) {
      const from = resolveAirport(r.from), to = resolveAirport(r.to);
      expect(from, r.from).toBeTruthy();
      expect(to, r.to).toBeTruthy();
      slugs.add(routeSlug(r.from, r.to));
    }
    expect(slugs.size).toBe(48);
  });
});

describe('route-pages LHR→JED', () => {
  const from = resolveAirport('LHR'), to = resolveAirport('JED');
  it('facts are sane and pinned', () => {
    const f = routeFacts(from, to);
    expect(f.distanceKm).toBeGreaterThan(4500); expect(f.distanceKm).toBeLessThan(5100);
    expect(f.durationMin).toBe(estimateDurationMin(from, to));
    expect(f.tzShiftHours).toBe(2);            // BST+1 → AST+3 in June
    expect(f.qiblaFrom).toBeGreaterThan(100); expect(f.qiblaFrom).toBeLessThan(130); // ~119°
  });
  it('seasonal schedule: morning June departure prays Dhuhr+Asr aloft', () => {
    const s = seasonalSchedule(from, to);
    expect(s.length).toBe(SEASON_DATES.length * DEP_TIMES.length);
    const juneAM = s.find(c => c.dateISO === '2026-06-21' && c.depTime === '09:00');
    expect(juneAM.inflight).toEqual(['Dhuhr', 'Asr']);
    for (const cell of s) {
      expect(cell.inflight.length + cell.before.length + cell.after.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('all-route invariants', () => {
  it('every route computes a full schedule for every cell', () => {
    for (const r of WAVE1_ROUTES) {
      const s = seasonalSchedule(resolveAirport(r.from), resolveAirport(r.to));
      for (const cell of s) {
        expect(cell.inflight.length + cell.before.length + cell.after.length, `${r.from}-${r.to}`).toBeGreaterThanOrEqual(5);
      }
    }
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/route-pages.test.js` → FAIL (modules missing).
- [ ] **Step 3:** implement `routes-wave1.js` (24 corridors × both directions, grouped: `umrah`, `gulf`, `southasia`, `seasia`, `other`) and `route-pages.js`:

```js
// route-pages.js (shape — full code in implementation)
import { Qibla, Coordinates } from 'adhan';
import { routeRecord, airportFromRow } from './airports.js';
import { compute } from './engine.js';
import data from '../assets/airports.json';

export const SEASON_DATES = ['2026-06-21', '2026-09-22', '2026-12-21'];
export const DEP_TIMES = ['09:00', '21:00'];
export const LASTMOD = '2026-06-11';
const byIata = new Map(data.airports.map(r => [r[0], airportFromRow(r)]));
export const resolveAirport = (iata) => byIata.get(iata) || null;
export const routeSlug = (f, t) => `${f}-to-${t}`.toLowerCase();
export function greatCircleKm(a, b) { /* haversine */ }
export function estimateDurationMin(from, to) { /* km/850*60 + 45, round to 5 */ }
export function routeFacts(from, to) { /* distanceKm, durationMin, tzShiftHours (June noon offsets via civilToUTC deltas), qiblaFrom/qiblaTo via Qibla(new Coordinates(lat,lon)) */ }
export function seasonalSchedule(from, to) {
  // for each date×depTime: arrTime = wall-clock arrival derived from dep + durationMin + tz shift
  // routeRecord({from,to,dateISO,depTime,arrTime}) → compute(rec,{method:'MuslimWorldLeague',madhab:'shafi'})
  // → {dateISO, depTime, before:[en], inflight:[en], after:[en], estimated:boolean (any inflight estimated)}
}
```

  Note: `routeRecord` takes wall-clock `arrTime`; derive it from `dep ms + duration` formatted in the destination tz (use a small `wallClock(ms, tz)` via `Intl`).
- [ ] **Step 4:** run tests → PASS (adjust the pinned `juneAM.inflight` only if the engine's actual output differs — print it first; the pin must equal real engine output, never forced).
- [ ] **Step 5:** commit `feat: wave-1 route list + build-time route data lib`.

### Task 2: EN route pages + hub + styles

**Files:** Create `src/pages/prayer-times/[route].astro`, `src/pages/prayer-times/index.astro`, `src/styles/routes.css`.

- [ ] **Step 1:** `routes.css` — `.static-page` article layer modeled on `blog.css` (`.post-col`-equivalent), token-only colors, RTL-safe (logical properties), table styles for the seasonal matrix, `.sr-only` util, footer-nav styles.
- [ ] **Step 2:** `[route].astro` — `getStaticPaths` maps `WAVE1_ROUTES` → props `{route, from, to, facts, schedule, related}`. Head: title `Prayer times on a {FROM} → {TO} flight (Fajr to Isha)`, meta description with computed facts, canonical, OG (existing og-cover), hreflang en/ar/x-default, BreadcrumbList + FAQPage JSON-LD (FAQ content rendered visibly on page). Body: pre-paint theme script (copy from guide page), h1, intro para (computed facts woven in), seasonal table (3 seasons × 2 departures → before/in-flight/after prayer lists, `~` marker when estimated), qibla note, method note + honest caveat, FAQ `<details>` (4 route-specific Q&As), CTA `→ /?from={FROM}&to={TO}`, related-routes links (same corridor + reverse direction), link to far-north guide + home. No JS islands.
- [ ] **Step 3:** `index.astro` hub — h1 "Prayer times by flight route", corridors grouped lists, links to all 48 + home/guide. CollectionPage JSON-LD optional — skip (YAGNI).
- [ ] **Step 4:** `npm run build` → confirm 48+1 pages emitted; spot-open `dist/prayer-times/lhr-to-jed/index.html` and check title/table/FAQ present in raw HTML.
- [ ] **Step 5:** commit `feat: 48 engine-computed route pages + hub (EN)`.

### Task 3: Homepage static content + visible FAQ + footer

**Files:** Modify `src/pages/index.astro`; reuse `routes.css` classes (import).

- [ ] **Step 1:** add after `#root`: sr-only h1 already? — add `<h1 class="sr-only">` as first body child; `<section class="static-info">` with "How Isfar works" (3 steps), the six FAQ items as `<details><summary>` whose text equals the JSON-LD answers verbatim, and a footer nav: routes hub, far-north guide, `/ar/`, GitHub-less (no clutter). Add `<link rel="alternate" hreflang="ar" href="https://isfar.app/ar/" />` + en/x-default self.
- [ ] **Step 2:** build + preview; verify island unaffected (sample chip renders) and static section visible below the app; check raw `dist/index.html` contains FAQ text.
- [ ] **Step 3:** commit `feat: crawlable homepage — visible FAQ, how-it-works, footer, hreflang`.

### Task 4: 404 + sitemap-at-build

**Files:** Create `src/pages/404.astro`, `scripts/gen-sitemap.mjs`; modify `wrangler.toml`, `package.json`; delete `public/sitemap.xml`.

- [ ] **Step 1:** `404.astro` — minimal branded page (theme script, wordmark, "This page doesn't exist", link home + routes hub).
- [ ] **Step 2:** `wrangler.toml` `[assets]` add `not_found_handling = "404-page"`.
- [ ] **Step 3:** `gen-sitemap.mjs` — glob `dist/**/index.html` (exclude `404`), URL = path with trailing slash, lastmod map: `/`→LASTMOD, `/guide/far-north-prayer-times/`→2026-06-09, route+ar pages→LASTMOD; emit `xhtml:link` hreflang alternates for en/ar pairs; write `dist/sitemap.xml`. Fail loudly if <50 URLs.
- [ ] **Step 4:** `package.json` build: `astro build && node scripts/gen-sw-precache.mjs && node scripts/gen-sitemap.mjs`; `git rm public/sitemap.xml`.
- [ ] **Step 5:** build; inspect `dist/sitemap.xml` (≥100 URLs incl. AR after Task 5 — at this point ≥51). Commit `feat: 404 page + sitemap generated from build output`.

### Task 5: Arabic pages + hreflang (i18n wave 1)

**Files:** Create `src/lib/i18n-ar.js`, `src/pages/ar/index.astro`, `src/pages/ar/prayer-times/[route].astro`, `src/pages/ar/prayer-times/index.astro`.

- [ ] **Step 1:** `i18n-ar.js` — `AR` strings object (title/intro/table headers/FAQ/CTA/footer templates with `{from}`/`{to}` placeholders), `CITY_AR` map for the wave-1 airport set, prayer names come from engine output (`ar` field already exists). Helper `cityAr(airport)` falls back to English name.
- [ ] **Step 2:** AR route template mirrors EN structure: `lang="ar" dir="rtl"`, Noto Kufi font preloads, same computed props, hreflang en/ar/x-default(→en), canonical to self, BreadcrumbList+FAQPage JSON-LD in Arabic.
- [ ] **Step 3:** `/ar/` landing — what Isfar does, FAQ (Arabic translations of the six), CTA into app, hreflang pair with `/`.
- [ ] **Step 4:** build; verify `dist/ar/prayer-times/lhr-to-jed/index.html` RTL + Arabic content; sitemap now ~100 URLs with alternates. Commit `feat: Arabic route pages, hub, landing — hreflang wired (i18n wave 1)`.

### Task 6: Deep-link prefill

**Files:** Modify `src/components/Calculator.jsx`, `src/components/route-form.jsx`.

- [ ] **Step 1:** read both files; on island mount, parse `location.search`; if `from`+`to` are 3-letter codes → set lookup mode `route` (existing persisted-mode state) and pass `initialRoute={{from,to}}` down; `RouteForm` resolves codes against the lazy airport dataset on open (it already loads it) and prefills its combo fields. Strip the params from the URL after consuming (`history.replaceState`) so refresh behaves.
- [ ] **Step 2:** build + preview; Playwright: visit `/?from=LHR&to=JED` → route mode open, fields prefilled. Also verify plain `/` unaffected.
- [ ] **Step 3:** commit `feat: ?from=&to= deep link opens route mode prefilled`.

### Task 7: Roadmap + verify + ship

- [ ] **Step 1:** ROADMAP.md — Phase D wave-1 shipped entry + the dated timeline table from the spec.
- [ ] **Step 2:** `npm test` (all suites) → green; `npm run build` → clean; preview + Playwright sweep: homepage (island + static section), `/prayer-times/` hub, LHR→JED EN+AR, 404 (preview may not honor 404-page — check raw file exists), sitemap fetch.
- [ ] **Step 3:** fetch+rebase onto origin/main, merge/push to main (auto-deploys). Post-deploy: spot-check live URLs, `curl -4` sitemap, attempt www→apex 301 redirect rule via CF API (fallback: note for user).
- [ ] **Step 4:** final user summary (review list + GSC steps + timeline).

## Self-review

- Spec coverage: homepage content/FAQ ✓ (T3), 404 ✓ (T4), sitemap ✓ (T4), www 301 ✓ (T7 ship step), route pages+hub ✓ (T1-2), deep link ✓ (T6), AR+hreflang ✓ (T5), measurement ✓ (summary), timeline ✓ (T7). Gaps: none.
- Types consistent: `resolveAirport→{iata,city,name,lat,lon,tz}` matches `airportFromRow`; `seasonalSchedule` cell shape used by both templates.
- The `juneAM.inflight` pin must mirror real engine output (verified by an actual run before writing the assertion — already observed `Dhuhr, Asr` for 09:00 2026-06-21).
