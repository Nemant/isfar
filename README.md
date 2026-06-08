# Isfar — إسفار

**Know your prayers from gate to gate.** A calm, single-page web app that maps the five
daily prayers across an airline flight — telling a Muslim traveller which prayers to pray
before departure, which fall in the air, and which after arrival, in both the origin and
destination time zones.

> _Isfar_ (إسفار) means **daybreak** — the brightening of the sky at first light — from the same
> root (س-ف-ر) as _safar_, "journey." The app is mobile-first, works offline once loaded, needs no
> account, and is built to feel reassuring rather than busy.

**Live at [isfar.app](https://isfar.app)** — real flight lookups via AeroDataBox, served by a
Cloudflare Worker with KV caching and per-IP abuse protection.

---

## What it does

Type a flight number (e.g. `SV124`) and Isfar:

- Looks up the route, departure/arrival times, and time zones.
- Walks the **great-circle flight path** and computes each prayer **at the aircraft's actual
  position** the moment it falls — not just at the origin or destination.
- Shows a **sun-arc timeline** of the journey with each prayer placed by the sun's elevation.
- Lists every prayer grouped by **Before departure / In flight / After arrival**, each in
  **both time zones**.
- Shows the **qibla relative to the aircraft** (a clock position around a little plane),
  since a compass is useless mid-flight.
- Marks when **Fajr ends at sunrise**.
- Corrects **Maghrib and sunrise for cruising altitude** (horizon dip), so the app's Maghrib
  matches the sun you actually see out the window.

### Handled edge cases

- **Ultra-long eastbound** flights that cross **more than five prayers** (a second Fajr, etc.).
- **Westbound "stretched day"** flights where very few prayers fall in the air.
- **High-latitude / midnight-sun** routes where some prayers have **no calculated time**.

---

## The clever bits (geometry, not guesswork)

- **Great-circle interpolation** — positions follow the true curved path across a round Earth.
- **Moving-target crossing detection** — a prayer's instant drifts as the aircraft changes
  longitude, so crossings are found by sign-change while walking the path.
- **Forward azimuth** — the great-circle heading at each point, used to make the qibla
  plane-relative.
- **Horizon-dip altitude correction** — observer geometry for the sun-on-the-horizon events.

**Prayer times themselves come entirely from [adhan-js](https://github.com/batoulapps/adhan-js)** —
no prayer-time math is hand-rolled. Users pick the calculation authority (12 supported:
Muslim World League, ISNA, Moonsighting Committee, Egyptian, Umm al-Qura, Dubai, Qatar,
Kuwait, Karachi, Singapore/MUIS, Diyanet/Turkey, Tehran/Ja'fari) and Asr madhhab in Settings.

---

## Running it

No build step. It's plain HTML + in-browser React/Babel + adhan-js from a CDN.

```bash
# any static server, e.g.
npx serve .
# then open http://localhost:3000/index.html
```

Or open `index.html` through any static host. A **service worker** (`sw.js`) caches the app
and its libraries on first load, so it works offline afterwards, and a web manifest makes it
**installable** ("Add to Home Screen").

> **Local vs. production lookups.** `data.js` decides via `useRemoteApi()`: on `localhost`/
> `file://` it uses the built-in **sample table** (`SV124`, `QF10`, `EK215`, `DY394`, `BA286`)
> so the demo works with no backend and offline. On the live domain it calls the real
> same-origin `/api/flight` Worker for **any** flight number — while the curated sample chips
> still resolve from the local table so they reliably show their edge cases. Everything else
> (prayer math, geometry, offline) is real in both modes.

### Hosting (production)

Two Cloudflare Workers share `isfar.app` via routes: a **GitHub-connected static-asset Worker**
serves the app (auto-deploys on push to `main`), and a **`isfar-flight` Worker** serves
`/api/flight` — looking up AeroDataBox, caching records in KV, and enforcing a per-IP edge rate
limit plus a hard daily upstream ceiling. The API key lives only in a Cloudflare secret, never
in the repo. See `ROADMAP.md` for the full architecture and `worker/` for the Worker source.

---

## Tech

- **React 18** + **Babel Standalone** (JSX transpiled in the browser — no toolchain).
- **adhan-js** for all prayer-time calculation.
- Vanilla CSS with an **oklch sun-arc palette** and light / dark / **auto** themes.
- PWA: service worker + manifest for offline + install.
- `localStorage` for recent searches and settings.

See **CLAUDE.md** for the architecture and file map.

---

## Status & license

**Live** at [isfar.app](https://isfar.app) with real, abuse-protected flight lookups (Milestone 1).
Next: an Astro port (drop Babel, prerender SEO pages) and i18n — see `ROADMAP.md`. Times are
guidance for travellers — verify with a local source on arrival, and follow your own madhhab or a
trusted scholar where rulings differ.

License: **MIT** © 2026 Danish Khan. See [`LICENSE`](./LICENSE).
