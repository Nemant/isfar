# Isfar — إسفار

**Know your prayers from gate to gate.** A calm, mobile-first web app that maps the five daily
prayers across an airline flight — which to pray before departure, which fall in the air, which after
arrival — each shown in both the origin and destination time zones. Live at
**[isfar.app](https://isfar.app)**.

> _Isfar_ (إسفار) means **daybreak**, from the same root (س-ف-ر) as _safar_, "journey." Works offline
> once loaded, needs no account, installable as a PWA.

This README is the **developer ramp-up**: stack, how to run it, where everything lives, and how it's
hosted. For the architecture rationale and a per-file map, read **`CLAUDE.md`**. For remaining work,
see **`ROADMAP.md`**.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | **Astro 4** static SSG (`astro.config.mjs`), compiled by Vite |
| Interactivity | **one** React 18 island (`client:only`) — the whole calculator; every other page is zero-JS SSG |
| Prayer times | **adhan-js** (`adhan` npm) — all prayer-time math; never hand-rolled |
| Styling | vanilla CSS, oklch sun-arc palette, light / dark / auto themes |
| Backend | **Cloudflare Worker** (`worker/`) → AeroDataBox via RapidAPI, KV cache, abuse caps |
| Hosting | two Cloudflare Workers on `isfar.app` (static assets + `/api/*`) |
| PWA / offline | service worker (`public/sw.js`, precache generated at build) + web manifest |
| Tests | **vitest** (`tests/`) |

Pinned deps: `astro 4.16`, `react 18.3`, `adhan 4.4`, `@astrojs/react 3.6`, `vitest 4`.
There is **no Babel-in-browser and no CDN** — everything is an npm dep compiled at build (an earlier
no-build version is gone; see `CLAUDE.md` history note).

---

## Running it

```bash
npm install
npm run dev       # astro dev server, hot reload
npm test          # vitest — the engine's behavioral oracle; run this first
npm run build     # astro build → dist/, then gen-sw-precache + gen-sitemap
npm run preview    # serve the built dist/ locally
```

> **Local vs. production lookups.** `src/lib/data.js` `useRemoteApi()` decides by hostname: on
> `localhost`/`file://` it uses the built-in **sample table** (`SV124`, `QF10`, `EK215`, `DY394`,
> `BA286`) so the demo works offline with no backend. On the live domain it calls the real
> same-origin `/api/flight` Worker for **any** flight number, while those curated sample chips still
> resolve locally so their edge cases stay reliable. A non-sample live lookup therefore only works in
> prod (or via `wrangler dev` on the worker), not the static preview.

---

## Project layout

```
src/
  pages/                 Astro pages (SSG)
    index.astro          static shell + full SEO <head>; mounts <Calculator client:only>
    faq.astro, 404.astro
    guide/               long-form guide articles (zero-JS, own <head> + SVG animations)
    prayer-times/        programmatic per-route SEO pages (/prayer-times/{from}-to-{to}/)
    ar/                  Arabic mirror (RTL, hreflang)
  components/
    Calculator.jsx       the React island root (state machine + all views)
    arc.jsx cards.jsx components.jsx route-form.jsx tweaks-panel.jsx
    blog/Anim*.astro     self-contained SVG animation figures for the guides
  lib/
    engine.js            ALL geometry + the high-latitude prayer policy (the core)
    data.js              sample flights, lookup()/lookupRemote(), METHODS, constants
    airports.js          route-mode lookup (city+time → /api/flight record shape, offline)
    recents.js export-card.js route-pages.js faq-home.js i18n-ar.js
  assets/airports.json   generated ~3.8k-airport dataset (regen: scripts/gen-airports.mjs)
  styles/                styles.css (app) + blog.css (guides)

worker/                  the isfar-flight Worker (/api/flight) — standalone, see worker/README.md
  src/index.js           request handler: AeroDataBox lookup, KV cache, rate limit, ceiling
  src/map.js             AeroDataBox → record mapping + Intl tz/date derivation
  CONTRACT.md            freezes the /api/flight response shape (= the data.js record)

scripts/                 build-time helpers (gen-sw-precache, gen-sitemap, gen-airports, verify-blog-times)
tests/                   vitest: engine policy/invariants/regressions, route-pages, recents, export-card
public/                  copied verbatim to dist/: sw.js, manifest, icons, fonts, robots/sitemap
```

The **engine** (`src/lib/engine.js`) is where the real work is: great-circle interpolation,
moving-target prayer-crossing detection, qibla-relative-to-aircraft, horizon-dip altitude
correction, and the observation-driven high-latitude policy. It calls adhan for every prayer instant
and never re-predicts astronomy itself. Its output shape is pinned by `tests/engine-display.test.js`.

---

## Hosting & infrastructure (Cloudflare)

`isfar.app` is served by **two Cloudflare Workers under one domain via Worker Routes** (not Pages):

| Worker | Serves | Config | Deploy |
|---|---|---|---|
| **`isfar`** | `isfar.app/*` — the static app | root **`wrangler.toml`** (assets-only, `directory=./dist`) | **GitHub-connected**: auto-builds (`npm run build`) + deploys on every push to `main` |
| **`isfar-flight`** | `isfar.app/api/*` (more-specific route wins) | **`worker/wrangler.toml`** | `wrangler deploy` from `worker/` |

**Flight API:** [AeroDataBox](https://aerodatabox.com/) via **RapidAPI**. The key is a Cloudflare
secret (`RAPIDAPI_KEY`) — **never** in the repo or client. The Worker:
- normalizes the flight code, resolves a date, calls AeroDataBox (`withLocation=true`), and reshapes
  the response into the frozen record (`worker/CONTRACT.md`);
- **KV cache** (`FLIGHT_CACHE`, key `flight:{code}:{date}`, TTL 6h future / 30d past) — the cost shield;
- **per-IP rate limit** (Cloudflare WAF rule, dashboard-configured) + a **daily upstream `CEILING`**
  (`vars.CEILING=1000`) bill cap; over the ceiling it returns a soft `busy` error.

Secrets are set with `wrangler secret put RAPIDAPI_KEY` (prod) / `worker/.dev.vars` (local,
gitignored). Operational ids and the deploy runbook live in `ROADMAP.md` and the project memory.

---

## Calculation methods

Users pick the calculation authority (12 supported: Muslim World League, ISNA, Moonsighting
Committee, Egyptian, Umm al-Qura, Dubai, Qatar, Kuwait, Karachi, Singapore/MUIS, Diyanet/Turkey,
Tehran/Ja'fari) and Asr madhhab in Settings — see `METHODS` in `src/lib/data.js`. High-latitude
behavior (real angle → seventh-of-night → 60° floor) is documented in `CLAUDE.md` and the far-north
guide page.

---

## Status & license

**Live** with real, abuse-protected lookups; Astro port and SEO Phase D wave 1 shipped. See
`ROADMAP.md` for what's left. Times are guidance for travellers — verify with a local source on
arrival, and follow your own madhhab or a trusted scholar where rulings differ.

License: **MIT** © 2026 Danish Khan. See [`LICENSE`](./LICENSE).
