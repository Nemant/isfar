# Isfar Astro port (Phase C) — design

**Date:** 2026-06-08
**Branch:** `astro-port`
**Status:** approved design → implementation plan next

## Context

Isfar is a no-build, mobile-first SPA (plain HTML + in-browser React via Babel
Standalone + adhan-js) that maps the five daily prayers across a flight.
Milestone 1 (real `/api/flight` lookups via a Cloudflare Worker) shipped on this
stack. Phase C ports the app to **Astro** (SSG + one React island) to drop Babel,
prerender SEO `<head>`, and lay the foundation for Phase D (programmatic
route/guide pages, i18n).

### This is a re-attempt, not a greenfield port

A full Astro port already reached production and was **reverted**:

- `2f66158` → `051ea72`: built the port (strangler migration, one
  `<Calculator client:load>` island, globals→ES imports, `@fontsource` fonts,
  generated SW precache) and cut over to production.
- `b6055bf`, `d2729d4`, `e0d7e95`, `1ff00b1`: several commits fighting
  **theme-FOUC + white iOS notch/chrome** during island hydration, ending by
  switching the island to `client:only`.
- `700f65d`: gave up — rolled all the way back to the no-build app.
- `23c6d6e`: re-fixed iOS chrome on the *restored* no-build app — now documented
  in `CLAUDE.md` as **"don't regress"** (no `theme-color` meta, `.sky`
  absolute-positioned, pre-paint `<html data-theme>` script, safe-area insets).

**The failure mode that caused the revert was theme/iOS-chrome behaviour during
island hydration.** This design targets that directly.

### Decisions locked with the user

- **Rebuild fresh** (not recover the reverted port from git) — today's no-build
  app is the base, with the current theme/iOS handling correct from commit one.
- **Work on a branch** (`astro-port`), commit incrementally. This deliberately
  overrides the repo's usual "commit straight to main" rule for this risky
  migration; `main` stays untouched until verified.
- **Branch final state = full cutover** — the no-build app removed, Astro the
  only app. The merge to `main` *is* the go-live.
- **Hydration: `client:only="react"`** for the Calculator island (see §A).

## A. Hydration strategy — the crux

The Calculator is **one `client:only="react"` island** (the former `#root` tree).

Rationale:
- The calculator is a pure client-side app (localStorage recents/settings, live
  OS theme flips, the themed canvas). SSR'ing it buys **no SEO** — search value
  lives in the static `<head>` (already present) and the future static
  route/guide pages (Phase D), not the interactive UI.
- `client:only` ⇒ **no server-rendered island HTML ⇒ zero hydration mismatch**,
  which is the entire class of bug that caused the revert. The prior port reached
  the same conclusion (`1ff00b1`) but only after shipping SSR first; we start here
  deliberately.
- It reproduces today's behaviour exactly: `index.astro` emits the static shell +
  root mount node, the pre-paint script runs, React mounts client-side — same as
  the no-build app, just Vite-compiled instead of Babel-in-browser.

`index.astro` keeps verbatim: the pre-paint `<script>` that sets
`<html data-theme>` from `localStorage isfar.theme` (resolving `auto` via the OS)
before first paint; **no `theme-color` meta**; all SEO head (title/meta/OG/Twitter,
both JSON-LD blocks, canonical); manifest/icons; the two above-the-fold font
preloads. The "don't regress" iOS rules in `CLAUDE.md` carry over unchanged
because the rendered HTML is essentially identical to today's.

## B. Module conversion (globals → ES imports)

| Today | After |
|---|---|
| `data.js` IIFE → `window.ISFAR_DATA` | `src/lib/data.js` — named exports (`lookup`, `lookupRemote`, `COLOR`, `META`, `METHODS`, `GUIDANCE`, `SAMPLE`); hostname switch + same-origin `/api/flight` kept verbatim |
| `engine.js` → `window.ISFAR_ENGINE`, global `adhan` | `src/lib/engine.js` — `import * as adhan from 'adhan'` (npm `adhan@4.4.3`, pinned); `compute()` output contract **unchanged** |
| `components.jsx`/`arc.jsx`/`cards.jsx` → `window.Foo` | `src/components/*.jsx` — real `import`/`export`; `Ic`/icons imported, not on `window` |
| `tweaks-panel.jsx` | keep user-facing theme/warmth tweaks; **drop** the `__edit_mode_*` postMessage dev-host bridge |
| `app.jsx` → mounts to `#root` | `src/components/Calculator.jsx` — exported island root; `createRoot` handled by the Astro mount |
| Babel Standalone, CDN React, CDN adhan | **deleted** — npm `react@18.3.1` + `react-dom@18.3.1`, `adhan@4.4.3`; Astro/Vite compiles JSX at build |

`engine.js`'s `compute()` output contract is a hard freeze — it must remain
byte-for-byte compatible with what `app.jsx`/cards/arc consume.

## C. Build, serve & PWA

- `astro.config.mjs`: `output: 'static'` (SSG) + `@astrojs/react`. `npm run build`
  → `dist/`. `npm run preview` for local verification.
- `styles.css` → `src/styles/styles.css`; `fonts/*.woff2` → `public/fonts/`
  (already self-hosted today via `@font-face` in `styles.css`; **reused as-is**,
  no `@fontsource`).
- **SW precache generated from the build manifest** via
  `scripts/gen-sw-precache.mjs` (today's `CORE` list is hand-maintained; the build
  emits hashed asset names so the list must be generated). `npm run build` runs
  the generator after `astro build`. Network-first (same-origin) / cache-first
  (cross-origin) strategy unchanged. Bump cache name **`isfar-v17` → `isfar-v18`**
  (continues the existing series; activate-handler already purges old caches).
- **`dist/` is gitignored**, not committed. The GitHub-connected static-asset
  Worker (`isfar`) runs `npm run build` as its build command and serves `dist/`.
  This is one Cloudflare dashboard setting the user owns; the exact build/output
  values are surfaced at merge time and do **not** block local work.
- The `isfar-flight` Worker (`/api/*`) is **untouched** — it stays standalone on
  its route, owns KV/rate-limit/ceiling, and was shipped in Phase A. Same custom
  domain ⇒ still same-origin ⇒ still no CORS.

## D. Branch & commit plan

`git checkout -b astro-port` (done). Incremental commits:

1. Scaffold Astro alongside the no-build app (`astro.config.mjs`, `package.json`
   with pinned deps, `tsconfig.json`, `.gitignore` for `dist/`/`.astro/`) — both
   apps runnable.
2. `src/pages/index.astro`: static shell + full SEO head + verbatim pre-paint
   script + `<Calculator client:only="react" />` mount.
3. Convert `data.js` + `engine.js` → `src/lib/` ES modules.
4. Convert `components.jsx`/`arc.jsx`/`cards.jsx`/`tweaks-panel.jsx` +
   `app.jsx`→`Calculator.jsx` → `src/components/` modules.
5. Move `styles.css` + `fonts/`; add `scripts/gen-sw-precache.mjs`; SW →
   `isfar-v18`; wire `public/sw.js` registration.
6. **Cutover**: delete root `index.html`, `*.jsx`, `data.js`, `engine.js`,
   `tweaks-panel.jsx`, root `styles.css`/`sw.js`/`manifest.webmanifest`/`fonts/`
   (now under `src/`/`public/`); add the deploy `wrangler.toml` if needed. Final
   tree = Astro only.

## E. Verification

- **Local (this branch, before merge):** `npm run build` clean (no warnings/
  hydration errors); `npm run preview`; Playwright across the 5 sample flights
  (SV124, BA286, QF10, EK215, DY394) — confirm prayers render in both time zones,
  theme toggle (light/dark/auto) works with no flash, recents persist, offline
  serves a saved flight while a new lookup shows the `offline` copy.
- **Honest caveat / required real-device gate:** the theme-FOUC / iOS-chrome
  failure that caused the revert is **not fully reproducible on desktop** — it
  manifests on real iOS Safari's translucent bars. `client:only` is chosen
  specifically to pre-empt this bug class, but a **real iOS Safari check is a
  required gate before merge→go-live**; local-green does not equal safe for that
  specific behaviour.

## Out of scope (this phase)

- Phase D programmatic route/guide pages, i18n.
- Rewriting the `isfar-flight` Worker.
- Self-hosting fonts (already done) / true "next departure ≥ now" date resolution
  (tracked follow-ups, independent of the port).
