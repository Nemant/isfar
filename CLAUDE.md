# CLAUDE.md — Isfar development guide

Working context for Claude Code. Read this first; it captures the architecture and the rules
that aren't obvious from any single file.

## What this is

A single-page, mobile-first web app that maps the five daily prayers across a flight. **Astro
(static SSG) + one React island + adhan-js**, compiled by Vite. The entire calculator is a single
`client:only="react"` island (the former `#root` tree); `src/pages/index.astro` is the static
shell. Build with `npm run build` (→ `dist/`), preview with `npm run preview`. Babel-in-browser is
gone; `adhan`/`react` are pinned npm deps.

> **History:** an earlier Astro port shipped to prod and was reverted over theme-FOUC / iOS-chrome
> hydration issues. This (second) port deliberately uses **`client:only`** — the island is never
> server-rendered, so there is no hydration mismatch to fight. Don't "optimise" it back to
> `client:load`/SSG without re-reading that history (`docs/superpowers/specs/2026-06-08-astro-port-design.md`).

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

All ES modules now use real `import`/`export` (no `window.*` globals). Cross-references resolve at
build time, not load order.

| File | Role |
|---|---|
| `src/pages/index.astro` | Static shell + the entire SEO `<head>` (title/meta/OG/Twitter/both JSON-LD blocks via `set:html`/canonical/manifest/icons/font preloads). Mounts `<Calculator client:only="react" />` in `#root`. The pre-paint `<script is:inline>` sets `<html data-theme>` before the island mounts (no FOUC); intentionally **no** `theme-color` meta (see iOS chrome note). |
| `src/pages/guide/far-north-prayer-times.astro` | First Phase-D guide page (zero-JS-island, pure SSG + vanilla scripts): the far-north methodology article with its own `<head>` (BlogPosting + FAQPage JSON-LD), the same pre-paint theme script, a no-React theme toggle, and six interleaved animation figures. Canonical copy of the blog post (draft/notes: `docs/blog/2026-06-09-…md`). |
| `src/pages/guide/the-skipped-day.astro` | **Unlisted** istiftāʾ page (EWR→HKG Dec transpolar: the date-line/polar-night "skipped day" and the five-prayers-at-one-instant cliff, written as a question for a scholar). `<meta name="robots" content="noindex">`, deliberately absent from `sitemap.xml`, no JSON-LD, not linked from any indexed page — keep it that way. Same shell/theme machinery as the far-north guide; five interactive figures. |
| `src/components/blog/Anim*.astro` | Self-contained SVG animation figures — six on the far-north guide (tilted Earth, twilight angle, shrinking dip, collapsing night, 60° floor, Tromsø year wheel) and five on the skipped-day page (polar crossing map, eastbound clock, meridian squeeze, skipped-day scrubber, four choices; the data-driven ones import `greatCircle`/`compute`/`ISFAR_TEST` from `engine.js` at build time). Contract: `<figure class="anim" data-anim="…">`, theme tokens only, IntersectionObserver entry at 0.35, full `prefers-reduced-motion` fallbacks, geometry computed in frontmatter. Page-unique SVG ids — don't mount one twice. |
| `src/styles/blog.css` | Guide/blog layer on top of `styles.css` tokens: `.post-col`/`.post` article typography, tables, and the shared `.anim` / `.anim-controls` / `.anim-btn` / `.anim-seg` frame the blog components rely on. |
| `src/lib/data.js` | Named exports: sample flights, `lookup()` (sync, sample table), **`lookupRemote(raw,date)`** (async; calls the live `/api/flight` Worker in prod), `useRemoteApi()` (env switch), `COLOR`, `META`, `METHODS` (12), `GUIDANCE` (qasr/jam'). |
| `src/lib/engine.js` | `compute(raw, {method, madhab})` → display model. All geometry. Imports `adhan` (npm) + `META` from `data.js`. |
| `src/lib/airports.js` | **Route mode**: `searchAirports()` (prefix search over the bundled dataset), `civilToUTC()` (DST-correct via Intl, no tz lib), `routeRecord()` — synthesizes the exact `/api/flight` record shape (incl. the Worker's zone/gmt derivation) from itinerary times, so `compute()` is untouched and route lookups work fully offline. |
| `src/assets/airports.json` | Generated, committed dataset: ~3.8k scheduled-service airports `[iata, city, name, lat, lon, tz]` (~107 KB gz). Lazy-imported only when route mode opens; the built chunk is SW-precached. Regenerate with `node scripts/gen-airports.mjs` (downloads OurAirports + mwgg/Airports at run time — never at build time). |
| `src/lib/recents.js` | Saved flights: `upsertRecent()` stores the **full record** (offline replay needs zero network; dedup `code+dateISO`, cap 6), `recentLabel()`. Legacy code-only entries still replay via lookup. |
| `src/lib/export-card.js` | "Save as image": `cardLines()` (pure, tested layout model) → `drawCard()` (hand-drawn canvas, live theme tokens — deliberate: DOM capture hits the backdrop-filter artifact) → `exportImage()` (Web Share files, download fallback). |
| `src/components/route-form.jsx` | `RouteForm` + `AirportField` combobox (`.input.combo` — no uppercase). Live duration line is the wrong-day safety net; arrival day = first instant ≥ departure. |
| `worker/` | The `isfar-flight` Cloudflare Worker (`/api/flight`): AeroDataBox lookup, `Intl`-derived tz/date, KV cache, daily ceiling. `CONTRACT.md` freezes the response shape (= the `data.js` record). Standalone — **not** ported into Astro. |
| `wrangler.toml` (root) | Config for the **`isfar`** static-asset Worker: assets-only, `[assets] directory="./dist"`. Read by `npx wrangler deploy` after the build. (Separate from `worker/wrangler.toml`.) |
| `scripts/gen-sw-precache.mjs` | Runs after `astro build`; rewrites `dist/sw.js`'s `CORE` list from the build output (hashed asset names never hand-maintained). Fails loudly if its marker is missing. |
| `src/components/Calculator.jsx` | Default-exported island root: `App` state machine + `Landing`/`Loading`/`Results`/`ErrorState`. `Results` renders one banner per `skyNotes` entry. Landing has two lookup modes (flight number / route, top segmented `.mode-seg` switch, persisted `isfar.lookupMode`); date defaults to today with a `Today` reset chip; every view change scrolls to top; the PWA install nudge (`beforeinstallprompt` capture / iOS sheet, shown each session until installed, ✕ = session dismiss) sits above `Results`. |
| `src/components/tweaks-panel.jsx` | Tweaks shell (theme, accent warmth). Dev `__edit_mode_*` postMessage host bridge removed. |
| `src/components/components.jsx` | Icons (`Ic`), `Header`, sheets (`SettingsSheet`, `GuideSheet`, `MethodSheet`), `FlightSummary`, `TzBanner`, `PlaneQibla`, `NextPrayer`. |
| `src/components/arc.jsx` | `ArcTimeline` — sun-elevation curve, prayer dots, in-flight band, day-break dividers. |
| `src/components/cards.jsx` | `PrayerCard`, `PrayerList` (grouped into Before/In-flight/After sections). |
| `src/styles/styles.css` | All styling. oklch sun-arc palette; `[data-theme=light|dark]` tokens (on `<html>` **and** `.isfar`, so the canvas can read them). Font `@font-face` use root-absolute `/fonts/…`. iOS chrome handling (see note). Imported by `index.astro`. |
| `public/` | Static assets copied verbatim to `dist/` root: `sw.js`, `manifest.webmanifest`, `favicon.ico`, `icon-*.png`, `og-cover.png`, `robots.txt`, `sitemap.xml`, `fonts/*.woff2`. |

## Conventions (important)

- **ES modules, real imports.** Components are shared via `import`/`export`; Vite resolves them at
  build time, so load order no longer matters. When adding a component, export it and import where
  used (no `window.*`). `adhan`/`react` are npm deps, pinned in `package.json`.
- **Build / preview / test:** `npm run build` (Astro → `dist/`, then `gen-sw-precache.mjs`),
  `npm run preview`, and **`npm test`** (vitest over `tests/`: policy matrix, invariants over 120
  randomized flights, one regression test per audited high-latitude bug). Tests first, then build,
  then Playwright on the preview.
- **`client:only` island, no SSR.** Reads of `localStorage`/`window`/`navigator` happen only in the
  browser (the island isn't server-rendered), so there's no hydration mismatch to guard against.
- Tweak defaults live in `Calculator.jsx` inside `/*EDITMODE-START*/ … /*EDITMODE-END*/`.
- Persisted state: `localStorage` keys `isfar.settings` (method/madhab), `isfar.theme`
  (`light|dark|auto`), `isfar.recents` (v2: full records — see `recents.js`), and
  `isfar.lookupMode`. `navigator.storage.persist()` is requested on first save. (The old
  `isfar.installNudge` "shown once" flag is gone — the nudge now shows each session until
  installed — and is actively removed from devices that have it.)
- **SW cache rule:** the offline fallback must NOT `ignoreSearch` for `/api/*` (query carries the
  flight identity — ignoring it can return the wrong flight). Everything else keeps `ignoreSearch`.
- **iOS mobile chrome (don't regress).** The page runs edge-to-edge under iOS Safari's
  *translucent* status/address bars via `viewport-fit=cover`, with content scrolling behind
  them. Keep it that way: (1) **no `<meta theme-color>`** — it forces the bars opaque and kills
  the scroll-behind effect; (2) `.sky` must stay `position: absolute` (scrolls) — `fixed` makes
  iOS force the bars solid; (3) iOS tints *both* safe areas from the single `<html>`
  `background-color` (matched to `--bg-top`) — no element behind the bars can override it, so the
  top/bottom edges can't be different colours; (4) `.col` reserves the safe areas with
  `env(safe-area-inset-*)` padding so content isn't clipped. Theme is set on `<html data-theme>`
  by the inline pre-paint script (in `index.astro`) and kept in sync by `Calculator.jsx`.

## The engine model (`engine.js`)

`compute()` returns `raw` plus: `prayers[]`, `durationMin`, `dep/arr.local`, `cruiseAltFt`,
`multiDay`, and `skyNotes[]` — one `{place: origin|destination, city, iata, latitude, kind:
midnightsun|polarnight|shortnight, allEstimated, names, nightMin?}` per notable endpoint:
no-cycle endpoints get midnightsun/polarnight; an endpoint whose real night is under 90 min
(e.g. Akureyri's 37-minute June night) gets `shortnight` + `nightMin` (drives the
combine-Maghrib-and-Isha banner).

Each `prayers[]` entry: `{ id, key, en, ar, status (before|inflight|after), t (0..1 sun
fraction), ms, qiblaClock, qiblaRel, sunrise{iata:time}|null, sunriseMs (fajr only),
estimated, estimateBasis (angle|method|seventh|borrow60 when estimated, else null),
zones{iata:{iata,city,time,date}} }`. This shape is pinned by
`tests/engine-display.test.js` (field list + exact ms values for the sample flights) —
the old `dusk`/`seq`/`source` ride-along fields were removed with their dead consumers.

**The high-latitude policy lives in `daySchedule(lat, lon, refMs, params, method)`** — the only
code that calls adhan. Three rules, decided per prayer/position/date, all **observed from adhan's
outputs** (never re-predicted with our own astronomy):
1. **Real angle** — the method's fajr/isha angle wherever the sky reaches it, at any latitude
   (detected by replicating adhan's middle-of-the-night safe-time arithmetic from its outputs).
2. **Seventh** — angle unreachable but the sun still rises and sets, at **any latitude**: 1/7 of
   the *local* night (adhan `SeventhOfTheNight`), flagged `~`. Coherent with the visible sky by
   construction (Isha after the real sunset, Fajr before the real sunrise). The June flight audit
   (BA48/AC854/FI455 — see the guide article) killed the old above-60° borrow here: it declared
   Maghrib in daylight and Fajr after the cabin had watched the sun rise.
3. **Borrow60** — **only** where no day/night cycle exists at all (adhan's sunrise/sunset
   Invalid — midnight sun / polar night): the **whole night cluster** (maghrib, isha, fajr,
   sunrise) from the 60° sky at the same longitude; nothing local remains to contradict it.
   Dhuhr/Asr stay local; polar-night Dhuhr keeps its real transit but is **flagged**; Asr is
   borrowed when the local sun gives it no sane afternoon. Moonsighting Committee is trusted
   verbatim whenever a cycle exists (it ships its own ≥55° rule); interval isha (ummalqura/qatar)
   is real with a cycle, clustered without one. An angle-based Maghrib that fails while the sun
   still sets (Tehran above ~62° midsummer) falls back to the sun-disk sunset, flagged.
   `daySchedule` **never returns a null instant** — prayers cannot silently vanish (test-enforced).
   The fajr altitude-dip on the displayed sunrise applies only when the Fajr itself is real (a
   ~30-min high-latitude dip would push a portioned Fajr's window-end before its start).

Key internals:
- `greatCircle()` / `initialBearing()` — spherical position + heading.
- before/after lists scan **two days** (dep-day−1∪dep-day, arr-day∪arr-day+1) so red-eyes and
  late-night arrivals still get their 2 prayers; the after list tops up past entries already
  shown aloft.
- crossing detection — walk dep→arr 1-min steps; a sign flip of (clock − instant) captures the
  prayer. When the schedule *jumped* past the clock (the rule-1↔2 cliff), the capture time is the
  moment it became due aloft — never a time from the past. A final same-prayer-within-6h pass
  dedups across the three lists.
- `altDipMinutes(lat, altFt)` — horizon dip; applied to **real** in-flight Maghrib (later, baked in
  before sorting, never past `arr`) and the **real** Fajr-ending sunrise (earlier). Estimates get
  no dip.
- ordering guards inside `daySchedule`: Tehran's angle-based Maghrib re-anchors the seventh Isha
  (= maghrib + night/7); borrowed Asr is clamped inside the local day; midnight-sun Asr borrows
  when it would land after the borrowed dusk. The test suite enforces canonical order for every
  method × madhab across fringe latitudes.
- qibla = `adhan.Qibla(pos)` minus heading → clock position (12 = nose).

## Sample flights (in `src/lib/data.js`)

`SV124` LHR→JED (normal, crosses dusk) · `BA286` codeshare · `QF10` LHR→PER (9 prayers,
2 days, eastbound) · `EK215` DXB→LAX (stretched day, westbound) · `DY394` OSL→TOS
(midnight sun, no-sunset). Any unknown but well-formed code → live Worker lookup in prod
(error state locally). These five are curated demos: they resolve from the **local table even in
production** so their edge cases stay reliable; every other code hits the real API.

## Production / hosting (LIVE — Milestone 1 shipped)

`isfar.app` is served by **two Cloudflare Workers under one domain via Worker Routes** (not Pages):
- **`isfar`** — static-asset Worker, GitHub-connected (Cloudflare "Connect to Git" made a Worker,
  not Pages). **Auto-deploys on every push to `Nemant/isfar` `main`** — that *is* the deploy.
  Serves `isfar.app/*`.
- **`isfar-flight`** — the `/api/flight` backend (`worker/`). Serves `isfar.app/api/*` (more-specific
  route wins). Holds the AeroDataBox key as a Cloudflare secret; KV cache; per-IP rate limit
  (10 req/10s, free-plan cap); daily `CEILING=1000` upstream bill cap.
- `data.js` `useRemoteApi()` picks live API vs. sample table by hostname (`localhost`/`file://` →
  table). Same-origin `/api/flight` ⇒ no CORS and the SW can cache lookups for offline replay.
- **The `isfar` Worker now BUILDS** (since the Astro cutover): its dashboard build command is
  `npm run build` (Astro → `dist/`), deploy command `npx wrangler deploy`, which reads the **root
  `wrangler.toml`** (assets-only, `directory="./dist"`) to upload the build output. A failed build
  keeps the last good deploy live. **To deploy app changes:** push to `main` and the build runs.
  The `worker/` API Worker deploys separately via `wrangler deploy`. Operational ids/secrets: see
  the `isfar-cloud-infra` memory.

## Verifying changes

`npm test` first (the engine's behavioral oracle), then `npm run build && npm run preview`,
open the preview URL, click a sample chip, watch the console
(the build itself fails on any unresolved import). The blurry horizontal band in html-to-image
screenshots is a **capture artifact with `backdrop-filter`**, not a real bug — confirm layout via
DOM/`getBoundingClientRect` or a real pixel screenshot if unsure. Note: non-sample live lookups
need the `/api/flight` Worker, so they only work in prod (or via `wrangler dev`), not the static
preview — the curated sample chips resolve from the local table everywhere.

## Known follow-ups

- ~~Wire a real flight API~~ ✅ done (live `/api/flight` Worker + `lookupRemote`).
- ~~Astro port (drop Babel, ES modules, build step)~~ ✅ done (Phase C). **Next major work:** Phase D
  — SEO build-out (programmatic route/guide pages, i18n) → see `ROADMAP.md`.
- Read true cruise altitude per flight instead of the 38,000 ft default.
- Worker date resolution is "today UTC + first matching segment"; implement true "next departure ≥ now".
- Pre-existing quirk: adhan reads the calendar day off the `Date` with **local** getters, so on a
  device whose tz is far from UTC the engine's `Date.UTC(y,m,d,12)` can map to the adjacent solar
  day (times shift by one day's drift, ~1–4 min). Harmless and uniform; fix would be passing
  adhan a date built from local components.
- ~~Regenerate `og-cover.png` in Newsreader~~ ✅ done. ~~Self-host fonts~~ ✅ done (`public/fonts/` +
  `@font-face` in `styles.css`).
- Optional: live "current/next prayer" highlight already exists via `NextPrayer`.
