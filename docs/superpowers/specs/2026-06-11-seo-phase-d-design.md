# SEO Phase D — design (2026-06-11)

Goal: rank `isfar.app` for (a) head terms ("prayer times during flight", "how to pray on a
plane"), (b) the far-north guide's queries, and (c) the long-tail of per-route queries
("prayer times LHR to JED flight") — the long-tail being the engine that funnels users into
the app. Strategy: **balanced, data-gated expansion** — quality-first waves, expansion decided
by Search Console data, never a bulk dump of templated pages on a brand-new domain.

## Current state (audited 2026-06-11)

- Two indexed pages: `/` and `/guide/far-north-prayer-times/`. Phase-0 meta/OG/JSON-LD solid.
- **Finding 1 — empty homepage body.** The calculator is a `client:only` island; the HTML body
  has zero crawlable text. Google renders JS (slow queue); Bing partially; AI crawlers
  (GPTBot, PerplexityBot, ClaudeBot) execute **no JS** — they see a blank page.
- **Finding 2 — invisible FAQ markup.** `index.astro` carries FAQPage JSON-LD with no visible
  FAQ content — violates Google's structured-data guidelines (markup must reflect visible
  page content); risks the rich result being ignored.
- **Finding 3 — www duplicate.** `www.isfar.app/*` serves the same content (Worker route, no
  redirect). Canonicals mitigate; a 301 is correct.
- No Search Console / Bing Webmaster property; sitemap is hand-maintained in `public/`.
- No 404 page.
- Fonts already include self-hosted Noto Kufi Arabic (RTL-ready).
- Verified: `engine.compute()` + `routeRecord()` run in Node at Astro build time → route pages
  can carry **genuinely unique computed content** (the anti-doorway-page defense).

## What ships TODAY (wave 1)

### 1. Technical fixes
- **Static homepage content** below the island: a calm "how it works" section, the six FAQ
  items **visible** (matching the JSON-LD verbatim — fixes Finding 2), and a footer linking
  the guide, the routes hub, and `/ar/`. Plain HTML in `index.astro`, styled with existing
  tokens; the island remains untouched above it. Fixes Finding 1 for the queries that matter.
- **404 page**: `src/pages/404.astro` + `not_found_handling = "404-page"` in root
  `wrangler.toml`.
- **Sitemap generated at build** (script alongside `gen-sw-precache.mjs`): walks `dist/`
  for `*/index.html`, emits `dist/sitemap.xml` with per-page lastmod. `public/sitemap.xml`
  deleted (it would shadow/duplicate).
- **www → apex 301**: attempt a zone Redirect Rule via the CF API with the existing token; if
  the token lacks the scope, it becomes a 2-minute dashboard action in the user summary
  (canonicals already mitigate).
- robots.txt unchanged (allow all — AI crawlers included, deliberately).

### 2. Programmatic route pages — `/prayer-times/{from}-to-{to}/`
- **Curated wave-1 list (~48 routes)** in `src/lib/routes-wave1.js`: Hajj/Umrah corridors
  (major hubs → JED/MED) + top diaspora corridors (UK/EU/NA ↔ South Asia, Gulf, SE Asia).
  IATA pairs only; airports resolved from the bundled dataset at build.
- **Unique computed content per page** via `src/lib/route-pages.js` (pure, vitest-covered):
  for 3 representative dates (June solstice, equinox, December solstice) × 2 departure
  buckets (morning ~09:00, evening ~21:00 local), synthesize the route record
  (duration from great-circle distance at ~850 km/h + 45 min) and run `engine.compute()`.
  Output per page: seasonal table of which prayers fall before/in-flight/after, route facts
  (distance, typical duration, time-zone shift, qibla-at-midpoint clock note), method note,
  honest caveat ("typical schedule — check your exact flight"), CTA deep-link into the app.
- **Per-route FAQPage JSON-LD** (3–4 route-specific Q&As, visible on page) +
  **BreadcrumbList**. Title pattern: "Prayer times on a LHR → JED flight (Fajr to Isha)".
- **Hub page `/prayer-times/`** listing all routes grouped by corridor; linked from the new
  homepage footer and from each route page (related routes cross-links).
- Quality bar: a route page must answer "which prayers will I pray on this flight and when"
  without opening the app. No page ships that is only boilerplate.

### 3. App deep-link prefill
`Calculator.jsx` reads `?from=LHR&to=JED` → opens route mode with airports prefilled.
Route-page CTA uses it. (Also a real UX feature; small diff.)

### 4. i18n wave 1 — Arabic
- `/ar/` static landing (RTL, Noto Kufi Arabic, dir=rtl, lang=ar): what Isfar does, the same
  FAQ in Arabic, link into the (English-for-now) app.
- `/ar/prayer-times/{route}/` Arabic versions of all wave-1 route pages + `/ar/prayer-times/`
  hub, from a translations module (`src/lib/i18n-ar.js`): fixed template strings + Arabic
  prayer names (already in data) + Arabic city names for the wave-1 airport set.
- **hreflang** alternates (`en`, `ar`, `x-default`) on every localized pair, both directions.
- The app island stays English this wave (full island i18n is wave 2 — keeps today's diff
  reviewable and the island risk at zero).

### 5. Measurement (user's only action — ~10 min)
Add `isfar.app` as a Domain property in Search Console; Claude adds the DNS TXT via the CF
API when the user pastes the token; submit `https://isfar.app/sitemap.xml`; import into Bing
Webmaster Tools. Documented in the ship summary; nothing today blocks on it.

## Dated timeline (future waves — deliberately not today)

Spacing publication avoids the bulk-templated-pages signature on a low-authority domain and
lets GSC data steer expansion. Owner: Claude unless marked [User].

| Date | Work |
|---|---|
| **2026-06-12** | [User] GSC + Bing properties; sitemap submitted. Claude: DNS TXT, verify indexing of wave 1 begins. |
| **2026-06-18** | Guide #2: **"How to pray on a plane"** — the head query (seat vs standing, wudu/tayammum, qibla, madhab notes, FAQ schema). Internal links home ↔ routes ↔ guide. |
| **2026-06-25** | Route **wave 2** (+~100 routes, same quality bar) — selection informed by first GSC impressions. Guide #3: **"Qibla on a plane"** (we compute it — unique angle). |
| **2026-07-09** | **i18n wave 2**: app island Arabic (RTL UI), Arabic guides; Urdu route pages if GSC shows Pakistani-corridor impressions. |
| **2026-07-23** | Route **wave 3** — purely GSC-driven (expand corridors with impressions; prune zero-impression pages from sitemap). Guide #4: qasr & jam' deep-dive (GUIDANCE data exists). |
| **2026-08-06** | i18n wave 3: Indonesian + Turkish route pages/landing (largest Muslim populations); hreflang audit. |
| **2026-12-09** | Guide #5: **"Fasting on a flight"** — published ~10 weeks before Ramadan 2027 (~Feb 18) so it's indexed and aged before the seasonal spike. |
| Ongoing | Per-route OG images (programmatic, branded) once route pages prove out; cruise-altitude follow-up feeds better tables. |

Off-page (user-driven, any time): Product Hunt launch, Muslim-travel/Hajj-Umrah communities,
pitch the far-north guide (genuinely linkable: unique animations + methodology) to aviation /
Muslim blogs.

## Architecture notes

- Route + Arabic pages are **pure SSG** (zero JS islands), same pattern as the far-north guide:
  own `<head>`, pre-paint theme script, `blog.css`-style layer (new `src/styles/routes.css` or
  reuse). Build-time compute only — no client engine calls.
- `route-pages.js` is the tested unit: `routeFacts(fromIata, toIata)` → distance/duration/tz
  shift/qibla; `seasonalSchedule(from, to)` → the 3×2 prayer-status matrix. Deterministic
  (fixed dates), so tests pin exact outputs for LHR→JED.
- Sitemap script keys lastmod off a per-page date map (routes get the build date the page
  content last changed, not every build) — wave 1 ships with a single date constant.
- The five sample-flight chips, engine, worker: **untouched**. `engine.js` consumer contract
  frozen as ever.

## Risks & mitigations

- **Thin-content classification**: mitigated by computed tables, route-specific FAQs, curated
  scale (~48), staged waves, hub+internal links, honest copy.
- **Island regression**: homepage change is additive static HTML below `#root`; Calculator
  diff is confined to a mount-time query-param read. Playwright verifies both.
- **Arabic copy quality**: template strings are few and reviewed in the diff; city names for
  48 routes only. Flag in summary for the user's review (user reads Arabic).
- **Build-time engine drift**: route pages recompute every deploy; if adhan or policy changes,
  pages update automatically — tests pin the wave-1 LHR→JED table so drift is visible.

## Done when (today)

`npm test` green (new route-pages tests included) · `npm run build` clean · Playwright on
preview: homepage static section + visible FAQ, `/prayer-times/lhr-to-jed/` EN+AR render with
correct tables, 404 works, `dist/sitemap.xml` lists all pages · pushed to `main` →
auto-deploy → spot-check live · ROADMAP updated · user summary delivered.
