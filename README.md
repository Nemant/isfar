# Rihla — رحلة

**Know your prayers from gate to gate.** A calm, single-page web app that maps the five
daily prayers across an airline flight — telling a Muslim traveller which prayers to pray
before departure, which fall in the air, and which after arrival, in both the origin and
destination time zones.

> _Rihla_ (رحلة) means "journey." The app is mobile-first, works offline once loaded,
> needs no account, and is built to feel reassuring rather than busy.

---

## What it does

Type a flight number (e.g. `SV124`) and Rihla:

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
# then open http://localhost:3000/Rihla.html
```

Or open `Rihla.html` through any static host. A **service worker** (`sw.js`) caches the app
and its libraries on first load, so it works offline afterwards, and a web manifest makes it
**installable** ("Add to Home Screen").

> **Note:** flight data is realistic **placeholder** data in `data.js`. A production build
> would swap `RIHLA_DATA.lookup()` for a real flight API (e.g. AeroDataBox) — the model shape
> is already API-ready. Everything else (prayer math, geometry, offline) is real.

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

Prototype / design exploration. Times are guidance for travellers — verify with a local
source on arrival, and follow your own madhhab or a trusted scholar where rulings differ.

License: **MIT** © 2026 Danish Khan. See [`LICENSE`](./LICENSE).
