# CLAUDE.md — Isfar development guide

Working context for Claude Code. Read this first; it captures the architecture and the rules
that aren't obvious from any single file.

## What this is

A single-page, mobile-first web app that maps the five daily prayers across a flight. **Astro**
static shell + **one React island** (the calculator) + adhan-js. Built with Vite (`npm run build`
→ `dist/`); `npm run dev` for local work. The whole interactive app is the `Calculator` island,
hydrated `client:load`; everything outside it (SEO `<head>`, JSON-LD) is static HTML.

> History: this was a no-build, in-browser-Babel app (plain `index.html` + `*.jsx` loaded as
> `text/babel`, components shared via `window.*`). Phase C ported it to Astro — Babel Standalone
> is gone, globals became ES imports, fonts are self-hosted via `@fontsource`. The `worker/`
> backend was **not** touched by the port.

## Golden rules

1. **Never hand-roll prayer-time math.** All prayer times come from **adhan-js**. Only expose
   calculation methods adhan actually provides (see `data.js` `METHODS`). Geometry that is NOT
   prayer-calc (great-circle position, qibla bearing, horizon dip, timezone conversion) is ours
   to compute and lives in `engine.js`.
2. **Calm and minimal.** One input, one clear answer. No clutter, no slop, no filler. Reverent,
   not kitschy — lean on light/horizon/sky, never clip-art mosques or crescents.
3. **Dual time zones, equal weight.** Every prayer shows origin + destination time as equals
   (airport codes, not city names; never mix). No "local solar time" — that was removed as
   confusing.
4. **Honest copy.** e.g. the offline note says lookups need signal but saved flights work
   offline — don't overstate.

## File map

| File | Role |
|---|---|
| `src/pages/index.astro` | Entry point. Static `<head>` (SEO meta, OG/Twitter, JSON-LD, canonical, manifest/icons), mounts the `Calculator` island `client:load`, imports `fonts.css` + `styles.css`. |
| `src/components/Calculator.jsx` | The **one React island** — `App` state machine + `Landing`/`Loading`/`Results`/`ErrorState`/`NoSunset`. Persisted state (theme/settings/recents) is loaded in a **mount effect**, never during render (else SSG/client hydration mismatch). Tweak defaults in `/*EDITMODE-START*/…/*EDITMODE-END*/`. |
| `src/lib/data.js` | Named exports: sample flights, `lookup()` (sample table), **`lookupRemote(raw,date)`** (async; live `/api/flight` Worker in prod), `useRemoteApi()` (hostname env switch), `COLOR`, `META`, `METHODS` (12), `GUIDANCE`. |
| `src/lib/engine.js` | `compute(raw, {method, madhab})` → display model. All geometry. Imports `adhan` + `META`. |
| `src/components/{components,arc,cards,tweaks-panel}.jsx` | Icons (`Ic`)/`Header`/sheets/`FlightSummary`/`PlaneQibla`/`NextPrayer`; `ArcTimeline`; `PrayerList`/`PrayerCard`; `useTweaks` (theme/warmth — host bridge removed). All ES exports. |
| `src/styles/{styles,fonts}.css` | All styling (oklch sun-arc palette; `.isfar[data-theme]` tokens) + `@fontsource` imports (latin/latin-ext/arabic subsets only). |
| `public/` | Static passthrough: `sw.js` (template), `manifest.webmanifest`, `favicon.ico`, `icon-*.png`, `og-cover.png`, `robots.txt`, `sitemap.xml`. |
| `scripts/gen-sw-precache.mjs` | Post-build: rewrites `dist/sw.js`'s `CORE` list from the real build output. Bump `const CACHE` in `public/sw.js` each cutover. |
| `worker/` | The `isfar-flight` Cloudflare Worker (`/api/flight`): AeroDataBox lookup, `Intl`-derived tz/date, KV cache, daily ceiling, 429-retry. **Standalone — not part of the Astro build.** `CONTRACT.md` freezes the response shape. |

## Conventions (important)

- **ES modules now** — components/helpers are `export`ed and `import`ed (the old `window.*`
  sharing is gone). `adhan` is an npm dep. Vite compiles JSX at build; there is no Babel Standalone.
- **The calculator is one island.** Only `Calculator.jsx` (and what it imports) ships JS to the
  browser; `index.astro` is static. Anything that must be in crawlable HTML (SEO copy) belongs in
  `index.astro`, not the island.
- **Hydration-safe rendering.** The island is server-rendered at build time, so the **initial
  render must be deterministic** — no `localStorage`/`window`/`Date.now()` reads during render.
  Read persisted/device state in a `useEffect` after mount (see `Calculator.jsx`).
- **Persisted state:** `localStorage` keys `isfar.settings` (method/madhab), `isfar.recents`,
  `isfar.theme`.
- **Offline/PWA:** never hand-edit `dist/sw.js`'s precache — it's generated. Bump
  `public/sw.js` `const CACHE` (e.g. `isfar-v4` → `v5`) on any cutover so old caches purge.

## The engine model (`engine.js`)

`compute()` returns `raw` plus: `prayers[]`, `durationMin`, `dep/arr.local`, `cruiseAltFt`,
`multiDay`, and (high-latitude) `noSunset`/`defined`/`undefinedPrayers`.

Each `prayers[]` entry: `{ id, key, en, ar, status (before|inflight|after), t (0..1 sun
fraction), ms, qiblaClock, qiblaRel, sunrise{iata:time}|null, zones{iata:{iata,city,time,date}},
seq }`.

Key internals:
- `greatCircle()` / `initialBearing()` — spherical position + heading.
- crossing detection — walk dep→arr 1-min steps; a prayer is captured when the aircraft clock
  catches its (moving) instant within the flight window. Day-tagged so repeats stay distinct.
- `altDipMinutes(lat, altFt)` — horizon dip; applied to **in-flight Maghrib (later)** and the
  **Fajr-ending sunrise (earlier)** only. Errs slightly late for Maghrib (safe side).
- qibla = `adhan.Qibla(pos)` minus heading → clock position (12 = nose).

## Sample flights (in `data.js`)

`SV124` LHR→JED (normal, crosses dusk) · `BA286` codeshare · `QF10` LHR→PER (9 prayers,
2 days, eastbound) · `EK215` DXB→LAX (stretched day, westbound) · `DY394` OSL→TOS
(midnight sun, no-sunset). Any unknown but well-formed code → live Worker lookup in prod
(error state locally). These five are curated demos: they resolve from the **local table even in
production** so their edge cases stay reliable; every other code hits the real API.

## Production / hosting (LIVE — Milestone 1 shipped)

`isfar.app` is served by **two Cloudflare Workers under one domain via Worker Routes** (not Pages):
- **`isfar`** — static-asset Worker, GitHub-connected (Cloudflare "Connect to Git" made a Worker,
  not Pages). **Auto-deploys on every push to `Nemant/isfar` `main`** — that *is* the deploy.
  Since the Astro cutover it runs a **build command `npm run build`** and serves the **`dist/`**
  output directory (set in the Worker's Build settings). A failed build keeps the last good deploy
  live. Serves `isfar.app/*`.
- **`isfar-flight`** — the `/api/flight` backend (`worker/`). Serves `isfar.app/api/*` (more-specific
  route wins). Holds the AeroDataBox key as a Cloudflare secret; KV cache; per-IP rate limit
  (10 req/10s, free-plan cap); daily `CEILING=1000` upstream bill cap.
- `data.js` `useRemoteApi()` picks live API vs. sample table by hostname (`localhost`/`file://` →
  table). Same-origin `/api/flight` ⇒ no CORS and the SW can cache lookups for offline replay.
- **To deploy app changes:** just `git push` (per [[commit-straight-to-main]]). The Worker source in
  `worker/` deploys separately via `wrangler deploy`. Operational ids/secrets: see the
  `isfar-cloud-infra` memory.

## Verifying changes

`npm run dev` for fast iteration; before shipping run `npm run build && npm run preview` and
drive it with Playwright — click a sample chip, confirm prayers render in both time zones and the
console is clean. **Always test hydration with populated `localStorage`** (a saved recent/theme/
settings) — an empty-storage check won't catch SSG/client mismatches. The blurry horizontal band
in html-to-image screenshots is a **capture artifact with `backdrop-filter`**, not a real bug.

## Known follow-ups

- ~~Wire a real flight API~~ ✅ done (live `/api/flight` Worker + `lookupRemote`).
- ~~Astro port (drop Babel, prerender SEO pages)~~ ✅ done (Phase C) — one React island, fonts
  self-hosted, SW precache generated.
- **Next major work:** Phase D — programmatic per-route SEO pages (`/prayer-times/lhr-to-jed/`),
  guide content, i18n (`hreflang`, RTL). The Astro foundation makes these cheap.
- Read true cruise altitude per flight instead of the 38,000 ft default.
- Worker date resolution is "today UTC + first matching segment"; implement true "next departure ≥ now".
- Optional: live "current/next prayer" highlight already exists via `NextPrayer`.
