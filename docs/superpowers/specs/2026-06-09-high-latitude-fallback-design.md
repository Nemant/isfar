# High-latitude fallback prayer times — design

**Date:** 2026-06-09
**Status:** approved design → implementation plan next
**Origin:** A user looked up **BA48 SEA→LHR** (overnight eastbound) and saw the in-flight
sequence go **Maghrib → Dhuhr** with no Isha/Fajr between — confusing. Investigation confirmed it
is *correct* (the route arcs to ~67°N near the June solstice, where Isha/Fajr have no astronomical
time), but the app drops those prayers **silently**. This feature turns that gap into a teaching
moment **and** gives the traveller a prayable estimated time.

## Problem

On routes (or at destinations) that reach high latitudes near a solstice, two things happen:

1. **Twilight not reached** (sun rises/sets, but never gets ~17–18° below horizon): standard
   Fajr/Isha angles have no solution. adhan's *default* (`HighLatitudeRule.MiddleOfTheNight`)
   silently collapses Isha≈Fajr to ~1 minute apart at solar midnight — pastorally useless.
2. **True midnight sun** (sun never sets, e.g. ~67°N): Fajr/Isha *and* sunrise/sunset are all
   undefined; every night-portioning rule returns null.

Today the engine either shows collapsed times or (via the crossing detector) drops the prayer
entirely, with **no explanation**. The DY394 "no true sunset" destination screen explains the
*why* but still shows blank "no time" rows.

## Decisions (locked with user)

- **Give a time, don't just explain.** Each undefined prayer gets an *estimated* time.
- **Positioning:** one recommended time by default, **plus a Settings control** to switch the
  high-latitude method (mirrors the existing calc-method picker).
- **Scope:** **unified** — one engine mechanism feeds both the **in-flight list** (BA48-class) and
  the **destination no-sunset screen** (DY394).
- **Default = "Last seventh of the night" (location-relative).** It divides the traveller's *own*
  sunset→sunrise night, so Isha sits ~1/7 after their real sunset and Fajr ~1/7 before their real
  sunrise. This is honest to where they actually are (e.g. a UK summer night), rather than
  substituting a foreign latitude. (See the Manchester rationale below.)
- **Three-option menu** (Middle-of-the-night deliberately **excluded** — it collapses Isha≈Fajr to
  ~1 min at exactly these latitudes and is adhan's silent default, which is part of what we're
  fixing):
  1. **Last seventh of the night** — *default*; portions your own night
  2. **Nearest latitude (47°)** — substitute the nearest latitude with a real night (aqrab al-bilād)
  3. **Twilight-angle (1/60 of night)** — tighter portioning
- **Nearest-latitude reference = 47°** (not 45°). 47° is the *least-aggressive* (most northern)
  reference that still keeps **Isha before midnight with a ~2.5h Isha→Fajr gap even on the
  solstice** (the worst case). Higher (48°+) tips Isha past midnight and collapses toward the
  twilight threshold (~48.6°N); lower (45°) is needlessly generous/southern.

## Rationale — why "last seventh" default + 47° substitute

**The Manchester insight.** A natural objection is "people live at 53°N (Manchester) with a real
night — why substitute a latitude at all?" But Manchester in deep summer has *no* astronomical
Isha/Fajr either: the sun only reaches ~13.6° below the horizon at solar midnight (London 15.6°,
Edinburgh 11.1°) — short of the 17–18° needed. Its *night* (sunset→sunrise) is short-but-present,
its *twilight* never deepens enough. So the honest fix where a night exists is to **portion that
real night** — "last seventh" puts Isha ~1/7 after the actual sunset, Fajr ~1/7 before the actual
sunrise (Manchester 9 Jun: Isha 22:36, Fajr 03:41 against a real 21:36→04:41 night). This is more
grounded than borrowing a foreign latitude, so it's the default.

**Why a substitute latitude is still needed — and why 47°.** "Last seventh" needs a night to
divide. At **true midnight sun** (~66°N+, sun never sets) there is none, so we must substitute the
nearest latitude that *does* have a real night (aqrab al-bilād). adhan's own built-ins all collapse
here — `PolarCircleResolution.AqrabBalad`/`AqrabYaum` and `HighLatitudeRule` land at the *strict*
boundary (~48.6°N), which near the solstice has a near-zero night:

| Approach (67°N apex, 9 Jun) | Isha | Fajr | Isha→Fajr |
|---|---|---|---|
| adhan `AqrabBalad` (strict nearest place) | 03:43 | 03:49 | **0h06** ⚠️ |
| adhan `MiddleOfTheNight` / portioning | — | — | null (no night) |
| **Nearest latitude 47° (ours)** | 02:12 | 04:59 | **2h47** ✅ (UTC) |

So we substitute a *fixed* 47° (same longitude/date) — far enough south to avoid the collapse, near
enough to stay faithful to "nearest place." Latitude sweep at the **solstice** (worst case) fixes
the value: 48.5°→1h09 gap, 48°→1h47 (Isha past midnight), **47°→2h31 (Isha 23:46, before
midnight)**, 46°→3h03, 45°→3h30. 47° is the most-northern reference that keeps Isha before midnight
with a real gap even on 21 Jun.

In all cases the prayer math stays 100% adhan's — for portioning we set adhan's `HighLatitudeRule`;
for the substitute we call adhan's `PrayerTimes` at the 47° coordinate. We only ever choose the
*rule* or the *coordinate*, never compute a prayer time ourselves (golden rule).

## Engine design (`engine.js`)

### Detection — "does this prayer need an estimate?"
A Fajr/Isha at a position needs an estimate when the **real twilight angle is not reached** on that
date. adhan can't signal this (it always applies a fallback rule; comparing two `HighLatitudeRule`s
does **not** work — verified: they differ even at 35°N because they're applied as caps). Instead use
a **solar-geometry reachability gate** — the same "geometry is ours, prayer-times are adhan's"
split the engine already uses for horizon-dip:

- Sun's altitude at solar midnight (lower culmination) is `|φ + δ| − 90°`, where `δ` is the solar
  declination for the date (standard approximation). The required angle `A` is reached iff
  `|φ + δ| ≤ 90 − A`.
- Read `A` from the **selected method's** adhan params (`fajrAngle` / `ishaAngle`) so the gate is
  method-correct (MWL 18°/17°, ISNA 15°, …).
- Verified thresholds (9 Jun, δ≈22.9°): Isha(17°) fails above ~49.5°N, Fajr(18°) above ~49°N —
  matching where adhan's times empirically degenerate.

The gate decides *whether* a prayer is an estimate; the **time** is always adhan's (the real
angle-based time when reached, or the chosen high-latitude estimate when not). Maghrib/Dhuhr/Asr/
sunrise are sun-disk/solar-noon events, estimated only in the true midnight-sun case — detected via
adhan returning null with `PolarCircleResolution.Unresolved`.

### Estimate helper
`estimatePrayer(lat, lon, refMs, key, rule, params) → { ms, basis }`:
- **`seventhnight` (default) / `twilightangle`:** set `params.highLatitudeRule` to the adhan rule
  (`SeventhOfTheNight` / `TwilightAngle`). If a real night exists at the position → use adhan's
  result, `basis = rule`. If **there is no night at all** (true midnight sun, detected via
  `PolarCircleResolution.Unresolved` → null sunset/sunrise) → **fall back to `nearest`**.
- **`nearest`:** call adhan's `PrayerTimes` at **(sign(lat)·47, lon)** for the date implied by
  `refMs`/longitude; read the key. Always defined. `basis = "nearest"`.
- Returns the time **and** the `basis` *actually used* — so a portioning choice that had to fall
  back is reported honestly as `"nearest"`, and the UI note can say so (see Presentation). Fallback
  is **per-prayer**: on one flight Isha (at a latitude with a night) can be `seventhnight` while
  Fajr (at the midnight-sun apex) is `nearest`.

### compute() integration
- The prayer model entry gains two **additive** fields: `estimated: boolean` and
  `estimateBasis: "nearest"|"seventhnight"|"twilightangle"|null`. Existing fields/consumers
  unchanged.
- **In-flight:** during the great-circle walk, for each Fajr/Isha in `ORDER` whose natural slot
  falls in `[dep, arr]` but which is never captured as a *real* time, insert one `estimated` entry,
  anchored to the aircraft's position during the gap (between the bracketing prayers), placed in
  chronological order.
- **Destination (no-sunset / DY394):** the existing `undefinedKeys` path produces `estimated`
  entries (using `to` position on arrival day) instead of "no time" markers.
- `opts.highLat` (default `"seventhnight"`) selects the rule; threaded from settings.

## Settings (`data.js` + `components.jsx`)
- `data.js`: add `HIGHLAT` (ordered; default `"seventhnight"`):
  - `{key:"seventhnight", label:"Last seventh of the night", blurb:"Divide your own night — Isha a seventh after sunset, Fajr a seventh before sunrise."}`
  - `{key:"nearest", label:"Nearest latitude (47°)", blurb:"Borrow the times of the nearest latitude with a real night."}`
  - `{key:"twilightangle", label:"Twilight angle", blurb:"Scale the night by the twilight angle — a tighter window."}`
- Persist in the existing `isfar.settings` object as `highLat` (alongside `method`/`madhab`);
  back-compat: a missing `highLat` reads as `"seventhnight"`.
- `components.jsx` `SettingsSheet`: a third control **"Far-north prayers"** — a labelled `<select>`
  (same pattern as the Calculation-method picker) listing the three `HIGHLAT` options, with a
  caption below that shows the **selected option's blurb** plus the line: *"Only affects routes that
  reach latitudes with no true night."*
- `Calculator.jsx`: thread `settings.highLat` into `compute(...)`; re-compute on change exactly like
  method/madhab (instant, persisted).

## Presentation (`cards.jsx`, `styles.css`, `Calculator.jsx`)
- **Estimated prayer card:** same dual-zone layout, visually distinct — an **"estimate" tag**, a
  softer/dashed accent, time prefixed `~`.
- **Teaching note** rendered once where estimates appear (in-flight section and the no-sunset
  screen). Copy is **driven by the actual `estimateBasis`** so it never claims a method it couldn't
  use:
  - portioning used (`seventhnight`/`twilightangle`):
    > *No true night over the far north on this route, so Isha & Fajr have no exact time. Estimated
    > by the last seventh of the night. Scholars differ — follow the guidance you trust.*
  - fell back to / chose `nearest`:
    > *The sun never sets on this stretch, so there's no night to divide. Estimated using the
    > nearest latitude with a real night (47°N). Scholars differ — follow the guidance you trust.*
  - If both bases appear on one flight, the note states the primary rule and adds a clause that the
    nearest-latitude was used where there was no night. A subtle affordance points to the
    **Far-north prayers** setting.
- **DY394 no-sunset screen:** reuse the estimate cards (with times) in place of blank "no true
  sunset" rows, keeping its existing scholarly paragraph.

## Files touched
| File | Change |
|---|---|
| `src/lib/engine.js` | detection + `estimatePrayer` helper; `estimated`/`estimateBasis` in model; in-flight + destination integration; `opts.highLat` |
| `src/lib/data.js` | `HIGHLAT` list; `highLat` settings default |
| `src/components/components.jsx` | `SettingsSheet` high-latitude control |
| `src/components/cards.jsx` | estimated-card rendering + teaching note |
| `src/components/Calculator.jsx` | thread `highLat`; NoSunset screen reuses estimate cards |
| `src/styles/styles.css` | estimate-card styling (dashed/tag) |

## Out of scope
- Other calc-method changes; Asr/Maghrib altitude logic; the `adhan` `AqrabYaum` (nearest-day)
  opinion (considered, collapses near solstice — not offered).
- Worker / API changes (this is pure client engine + UI).

## Verification
- **Engine (Node harness):** BA48 (SEA→LHR) now yields an estimated **Isha & Fajr** between Maghrib
  and Dhuhr; DY394 destination shows estimated Fajr/Maghrib/Isha. Assert, per high-lat option, a
  prayable Isha→Fajr gap (default `seventhnight` of a real night ≈ 3–5h; `nearest`-47 ≈ 2.5–3h;
  `twilightangle` tighter). Assert a **true midnight-sun** point still returns a time with
  `estimateBasis==="nearest"` even when `seventhnight`/`twilightangle` is selected (fallback), and
  that `estimated`/`estimateBasis` are set correctly per prayer. Assert a normal mid-latitude flight
  is **unchanged** (no `estimated` entries; identical prayer model to before this change).
- **UI (Playwright on preview):** BA48 renders the estimate cards + note; switching the Settings
  high-latitude option re-renders the times; DY394 shows estimates; a normal flight (SV124) is
  visually unchanged.
