# SEO.md — Rihla search-optimization plan

A staged plan to take Rihla from a client-rendered single-page app to a search-discoverable
product, **without losing the calm single-page experience**. Work top-down: Phase 0 → 4 in
order. Each task has a **why**, the **files**, and a **done-when** check.

> Architectural principle: keep the SPA as the *app*; add a thin **prerendered layer** of real
> HTML pages (home, per-route, guides) that link into it. SEO wants indexable surface area; the
> SPA stays the product.

---

## Phase 0 — Cheap wins, no architecture change (do first)

These move the needle immediately and touch only `Rihla.html` + a couple of new static files.

- [ ] **Title & meta description.** Real, query-targeted.
  - `<title>Rihla — Prayer times across your flight (Fajr to Isha)</title>`
  - `<meta name="description" content="Enter a flight number to see when each of the five daily prayers falls before departure, in the air, and after arrival — in both time zones.">`
  - Files: `Rihla.html` `<head>`.
  - Done when: both appear in view-source (not injected by JS).

- [ ] **Open Graph + Twitter cards.** So shared links render with the sun-arc icon.
  - `og:title`, `og:description`, `og:image` (make a 1200×630 `og-cover.png`), `og:type=website`,
    `og:url`, `twitter:card=summary_large_image`.
  - Files: `Rihla.html`; new `og-cover.png`.
  - Done when: passes the metatags.io / opengraph.xyz preview.

- [ ] **Canonical + lang.** `<link rel="canonical">`, confirm `<html lang="en">`.

- [ ] **JSON-LD structured data.** Inline `<script type="application/ld+json">` in `Rihla.html`:
  - `WebApplication` (name, description, applicationCategory: TravelApplication, offers: free).
  - `FAQPage` — 4–6 real Q&As ("Can I pray on a plane?", "What is qasr?", "How do I face the
    qibla in flight?"). Earns rich results.
  - Done when: passes Google Rich Results Test.

- [ ] **robots.txt + sitemap.xml** at root. Sitemap lists every static URL (grows in Phase 2).
  - Done when: both fetch 200; sitemap is valid XML.

- [ ] **Self-host fonts.** Replace the Google Fonts `<link>` with local `@font-face` (Newsreader,
  Hanken Grotesk, Noto Kufi Arabic) in `styles.css` + a `/fonts` dir. Kills a render-blocking
  round-trip → better LCP.
  - Done when: no `fonts.googleapis.com` request in the Network tab; text still renders correctly.

---

## Phase 1 — Performance / Core Web Vitals (ranking factor)

The single worst thing for speed today is **Babel-in-the-browser**. Fixing it helps both
rankings and the actual UX.

- [ ] **Precompile JSX, drop Babel Standalone.** Add a tiny build step (esbuild) that compiles
  `*.jsx` → one `app.bundle.js`. Keep the no-framework feel — esbuild is a single command, no
  webpack.
  - Files: add `build.mjs` (esbuild), `package.json` scripts (`build`, `dev`); update
    `Rihla.html` to load the bundle instead of the 6 Babel scripts.
  - **Preserve the conventions in CLAUDE.md** (window exports can go away once it's a real bundle
    with imports — refactor `Object.assign(window, …)` into ES module `export`/`import`).
  - Done when: no `@babel/standalone` in the page; Lighthouse Performance ≥ 90 on mobile.

- [ ] **Pin & subset.** Self-hosted fonts subset to Latin + Arabic ranges used. Defer non-critical
  JS. Inline critical CSS for the hero if LCP still lags.

- [ ] **Measure.** Add Lighthouse CI or just record before/after LCP, INP, CLS.

---

## Phase 2 — Indexable surface area (the biggest opportunity)

Programmatic SEO. This is where the real long-tail traffic is. Requires prerendered HTML.

- [ ] **Pick a prerender approach.** Simplest that fits a no-framework app: a Node script that
  renders each route to static HTML at build time (e.g. `react-dom/server` `renderToString`, or
  Puppeteer snapshotting). Output static files Google can read without JS.

- [ ] **Per-route pages.** Real URLs like `/prayer-times/lhr-to-jed/`. Each prerendered with a
  unique `<title>`/description ("Prayer times on flights from London (LHR) to Jeddah (JED)"),
  the route's typical prayer breakdown as crawlable text, and a link into the live app.
  - People search exactly this. Generate from the routes in `data.js` (and expand with a real
    airport/route dataset later).
  - Done when: `/prayer-times/lhr-to-jed/` returns full HTML in view-source; listed in sitemap.

- [ ] **Per-flight pages** (optional, big): `/flight/sv124/` similar treatment.

- [ ] **Clean URLs, no SPA query params** for these pages. The app can still use client routing
  internally; the *entry* pages are static.

- [ ] **Internal linking.** Home links to top routes/guides; routes cross-link to relevant guides.

---

## Phase 3 — Content hub (earns backlinks, ranks for informational queries)

The calculator alone won't rank for "how to combine prayers when traveling." Guides will, and
they attract links.

- [ ] **Guide pages** (prerendered, real `<h1>`/`<h2>`, ~600–1200 words each, reviewed for fiqh
  accuracy):
  - "Can you pray on an airplane? A traveller's guide"
  - "Qasr: shortening prayers when you travel"
  - "Jam': combining Dhuhr+Asr and Maghrib+Isha in flight"
  - "How to face the qibla on a plane"
  - "Praying during Ramadan while flying / fasting across time zones"
  - Add `HowTo` and/or `Article` JSON-LD per guide.

- [ ] **Honest disclaimer** on every guide: rulings vary by madhhab; verify with a scholar.
  (Matches the app's existing tone — see CLAUDE.md golden rule #4.)

---

## Phase 4 — International (huge untapped audience)

- [ ] **Multi-language** versions: **Arabic, Urdu, Indonesian, Turkish, Malay** first.
  - Implement `hreflang` alternates between language versions + `x-default`.
  - RTL handling for Arabic/Urdu (the app already uses Noto Kufi Arabic; audit layout for `dir`).
  - Done when: hreflang validates (no return-tag errors in Search Console).

- [ ] **Localize titles/descriptions/guides**, not just UI strings — that's where the search
  volume is.

---

## Off-page (ongoing, not code)

- Submit to Google Search Console + Bing Webmaster; verify the property; submit the sitemap.
- Get listed/linked from Muslim travel communities, Hajj/Umrah resources, PWA/app directories.
- Share-driven traffic: the OG cards from Phase 0 make every shared link a mini-ad.

---

## Guardrails (don't break the product)

- Keep the SPA experience calm and uncluttered — SEO pages are a **layer around** it, not bolted
  into the results UI.
- Don't hand-roll prayer math for SEO copy either; if a guide states a time, it must come from
  the engine/adhan, or be clearly illustrative.
- Maintain the dual-timezone, airport-code, honest-copy rules from `CLAUDE.md`.

## Suggested order of attack

1. Phase 0 entirely (a day; pure win).
2. Phase 1 JSX precompile (unblocks performance + makes Phase 2 prerender easier).
3. Phase 2 per-route pages (the traffic).
4. Phase 3 guides (the links).
5. Phase 4 i18n (the scale).
