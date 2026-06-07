# CLAUDE.md — Rihla development guide

Working context for Claude Code. Read this first; it captures the architecture and the rules
that aren't obvious from any single file.

## What this is

A single-page, mobile-first web app that maps the five daily prayers across a flight. Plain
HTML + in-browser React (Babel Standalone) + adhan-js. **No build step, no package manager.**
Open `Rihla.html` on a static server.

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
| `Rihla.html` | Entry point. Loads scripts in order, registers `sw.js`, links manifest/icons. |
| `data.js` | `window.RIHLA_DATA`: placeholder flights, `lookup()`, `COLOR`, `META`, `METHODS` (12), `GUIDANCE` (qasr/jam'). **Swap `lookup()` for a real flight API here.** |
| `engine.js` | `window.RIHLA_ENGINE.compute(raw, {method, madhab})` → display model. All geometry. |
| `tweaks-panel.jsx` | Tweaks shell (theme, accent warmth). Host-protocol scaffold. |
| `components.jsx` | Icons (`Ic`), `Header`, sheets (`SettingsSheet`, `GuideSheet`, `MethodSheet`), `FlightSummary`, `TzBanner`, `PlaneQibla`, `NextPrayer`. |
| `arc.jsx` | `ArcTimeline` — sun-elevation curve, prayer dots, in-flight band, day-break dividers. |
| `cards.jsx` | `PrayerCard`, `PrayerList` (grouped into Before/In-flight/After sections). |
| `app.jsx` | `App` state machine + `Landing`/`Loading`/`Results`/`ErrorState`/`NoSunset`. Mounts root. |
| `styles.css` | All styling. oklch sun-arc palette; `.rihla[data-theme=light|dark]` tokens. |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | PWA: offline caching + install. |

## Conventions (important)

- **Each `<script type="text/babel">` has its own scope.** Components are shared by assigning to
  `window` at the end of each file (`Object.assign(window, {...})`), and referenced as
  `window.Foo` or destructured. When adding a component, export it on `window` and load order in
  `Rihla.html` matters (data → engine → tweaks → components → arc → cards → app).
- **No `const styles = {}`** global objects (name collisions across Babel scripts). Use inline
  styles or uniquely-named objects.
- React/Babel are **pinned with integrity hashes** in `Rihla.html` — keep them.
- Tweak defaults live in `app.jsx` inside `/*EDITMODE-START*/ … /*EDITMODE-END*/`.
- Persisted state: `localStorage` keys `rihla.settings` (method/madhab) and `rihla.recents`.

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
(midnight sun, no-sunset). Any unknown but well-formed code → error state.

## Verifying changes

Open `Rihla.html`, click a sample chip, watch the console. The blurry horizontal band in
html-to-image screenshots is a **capture artifact with `backdrop-filter`**, not a real bug —
confirm layout via DOM/`getBoundingClientRect` or a real pixel screenshot if unsure.

## Known follow-ups

- Wire a real flight API into `data.js` `lookup()` (model shape is ready).
- Read true cruise altitude per flight instead of the 38,000 ft default.
- Optional: live "current/next prayer" highlight already exists via `NextPrayer`.
