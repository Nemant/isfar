# High-latitude fallback prayer times — design

**Date:** 2026-06-09
**Status:** approved — proceeding to implementation plan.
**Origin:** A user looked up **BA48 SEA→LHR** (overnight eastbound) and saw the in-flight sequence
go **Maghrib → Dhuhr** with no Isha/Fajr between. Investigation confirmed it is *correct* (the route
arcs to ~67°N near the June solstice, where Isha/Fajr have no astronomical time), but the app drops
those prayers **silently**. This feature gives each such prayer a prayable estimated time + a
teaching note.

## Problem

At high latitudes near a solstice, two distinct things happen:

1. **Twilight not reached** — the sun rises/sets, but never gets ~17–18° below the horizon, so the
   standard Fajr/Isha angles have no solution.
2. **No day/night cycle at all** — true midnight sun (sun never sets) or polar night (sun never
   rises); sunrise/sunset themselves are undefined.

Today the engine drops these prayers (or, via adhan's silent default `MiddleOfTheNight`, collapses
Isha≈Fajr to ~1 min), with **no explanation**. The DY394 "no true sunset" screen explains *why* but
still shows blank "no time" rows.

## Guiding principle — take no scholarly position

High-latitude Isha/Fajr is a genuine zone of scholarly disagreement with **no single correct
answer**. So Isfar does exactly what it already does for calculation methods: **expose the
recognized methods adhan provides, default to the most prayable, label the result an estimate, and
defer to the user's own scholar.** We invent no high-latitude math and pick no winner. (Golden rule:
all prayer times come from adhan.)

adhan handles the two situations natively, and — verified — its native combination already yields
the sane behaviour we reasoned to:

- **Night exists, twilight not reached** → `HighLatitudeRule` portions **your own** sunset→sunrise
  night. We expose this choice as a setting.
- **No local day/night cycle** → `PolarCircleResolution` substitutes the nearest latitude that
  *does* have a real day. We set this under the hood.

Verification (adhan `SeventhOfTheNight` + `AqrabBalad`, solstice): at every latitude with a night,
the time uses that night (**Fajr is always before the local sunrise — the "pray Fajr after your sun
is already up" absurdity cannot occur**); the latitude substitution triggers **only** where there is
no local sun cycle to contradict it.

```
 lat    sunset  sunrise   Isha    Fajr    sane?
 60°N   21:28   02:36    22:12   01:52    yes  (own night)
 65°N   23:03   01:01    23:20   00:44    yes  (own night)
 67°N   (no local night) → substitutes nearest valid-day latitude → 23:38 / 00:25
```

## Decisions (locked with user)

- Give a time **and** a teaching note for every prayer with no real (angle-based) time.
- **Default = "Last seventh of the night"** (adhan `SeventhOfTheNight`).
- **Setting "Far-north prayers" — two options**, both portioning your own night:
  1. **Last seventh of the night** — `SeventhOfTheNight` (default)
  2. **Twilight angle** — `TwilightAngle` (tighter window)
  *("Middle of the night" omitted — adhan offers it, but it collapses Isha≈Fajr to ~1 min at exactly
  these latitudes; it's also adhan's silent default, part of what we're fixing.)*
- **No-local-night fallback** = adhan `PolarCircleResolution.AqrabBalad`, set under the hood for both
  options. Not user-exposed.
- **Scope:** unified — the in-flight list (BA48-class) and the destination no-sunset screen (DY394).

## Engine design (`engine.js`)

### Set adhan's high-latitude handling
In `makeParams()`, on the adhan params:
- `params.highLatitudeRule = RULE[opts.highLat]` where `RULE = {seventhnight: SeventhOfTheNight,
  twilightangle: TwilightAngle}` (default `SeventhOfTheNight`).
- `params.polarCircleResolution = adhan.PolarCircleResolution.AqrabBalad`.

With these set, adhan **returns** Isha/Fajr everywhere — they no longer vanish — so the existing
in-flight crossing detector captures them and the destination path resolves them. **The prayer time
is entirely adhan's.**

### Detection — for LABELLING only (factual, not a position)
We tag which prayers are estimates vs real, to drive the "estimate" styling + note wording. Pure
solar geometry (the "geometry is ours" split the engine already uses for horizon-dip) — it never
computes a prayer time:

- Sun's depth below the horizon at solar midnight = `90 − |φ + δ|`, where `δ` = solar declination
  for the date (standard approximation).
- `A` = the **selected method's** Fajr/Isha angle (adhan params `fajrAngle`/`ishaAngle`).
- Per prayer:
  - `|φ + δ| − 90 > 0` → no day/night cycle → `estimateBasis = "substituted"`.
  - else `90 − |φ + δ| < A` → night but twilight not reached → `estimateBasis = "portioned"`.
  - else → real angle-based time → `estimated = false`.

### Model
Prayer entries gain two **additive** fields: `estimated: boolean` and
`estimateBasis: "portioned" | "substituted" | null`. Existing fields/consumers unchanged.
`opts.highLat` (default `"seventhnight"`) threads the chosen rule.

### Integration notes
- **In-flight (portioned):** with the rule set, twilight-zone Isha/Fajr resolve, so the great-circle
  walk captures them; set `estimated`/`estimateBasis` from the gate at the captured position.
- **In-flight (substituted / true midnight sun):** the substituted instant is synthetic, so it may
  need **explicit insertion** (like the destination path) rather than relying on the moving-instant
  crossing detector — to confirm in implementation.
- **Destination (DY394):** the no-sunset path now yields times via `AqrabBalad`; flag `substituted`.

## Settings (`data.js` + `components.jsx`)
- `data.js`: `HIGHLAT` (ordered; default `"seventhnight"`):
  - `{key:"seventhnight", label:"Last seventh of the night", blurb:"Isha a seventh of the night after sunset; Fajr a seventh before sunrise — using your own night."}`
  - `{key:"twilightangle", label:"Twilight angle", blurb:"Scale the night by the twilight angle — a tighter window."}`
  - The `key → adhan.HighLatitudeRule` map lives in `engine.js` (data.js stays adhan-free).
- Persist as `isfar.settings.highLat`; a missing value reads as `"seventhnight"` (back-compat).
- `components.jsx` `SettingsSheet`: a third labelled `<select>` **"Far-north prayers"** (same pattern
  as the Calculation-method picker), showing the selected option's blurb + the caption *"Only affects
  routes that reach latitudes with no true night."*
- `Calculator.jsx`: thread `settings.highLat` into `compute(...)`; re-compute on change (instant,
  persisted), exactly like method/madhab.

## Presentation (`cards.jsx`, `styles.css`, `Calculator.jsx`)
- **Estimated prayer card:** same dual-zone layout, visually distinct — an **"estimate" tag**, a
  softer/dashed accent, time prefixed `~`.
- **Teaching note**, rendered once where estimates appear, **driven by `estimateBasis`** so it never
  claims more than was computed:
  - `portioned`:
    > *No true night over the far north on this route, so Isha & Fajr have no exact time. Estimated
    > by the last seventh of the night. Scholars differ — follow the guidance you trust.*
  - `substituted` (no day/night cycle):
    > *The sun never sets on this stretch, so there's no night to divide. Estimated from the nearest
    > latitude that has one. Scholars differ — follow the guidance you trust.*
  - Method name reflects the actual rule; a subtle affordance points to the **Far-north prayers**
    setting.
- **DY394 no-sunset screen:** reuse the estimate cards (with times) in place of blank "no true
  sunset" rows, keeping its existing scholarly paragraph.

## Files touched
| File | Change |
|---|---|
| `src/lib/engine.js` | set `highLatitudeRule` + `polarCircleResolution`; detection gate; `estimated`/`estimateBasis`; `opts.highLat` + `RULE` map; in-flight substituted-prayer insertion |
| `src/lib/data.js` | `HIGHLAT` list; `highLat` settings default |
| `src/components/components.jsx` | `SettingsSheet` "Far-north prayers" control |
| `src/components/cards.jsx` | estimate-card rendering + `estimateBasis`-driven note |
| `src/components/Calculator.jsx` | thread `highLat`; NoSunset screen reuses estimate cards |
| `src/styles/styles.css` | estimate-card styling (dashed/tag) |

## Out of scope
- User-facing choice between `AqrabBalad` / `AqrabYaum` (we set `AqrabBalad`).
- Polar night (winter flights) — handled automatically by the same machinery; no special UI.
- Other calc-method changes; Asr/Maghrib altitude logic; Worker / API changes.

## Resolved decisions (were open; now locked)
- **In-flight insertion of substituted prayers:** explicit insertion (like the destination path),
  not the moving-instant crossing detector. Anchor: the substituted instant if it lands in
  `[dep, arr]`, else the midpoint of the gap between its bracketing prayers; placed in chronological
  order.
- **"Middle of the night":** not surfaced (omitted).
- **Visual treatment:** calm/subtle, matching the app ethos — a small "estimate" pill + `~` prefix +
  a soft dashed accent; never a loud warning.
- **DY394:** keeps its standalone "the sun won't set" screen, but its rows now show the **estimated
  times** (reusing the estimate card) instead of blank "no time"; the existing scholarly paragraph
  stays. (Not folded into the normal results list.)
- **Note copy:** the two `estimateBasis`-driven variants in Presentation are final for v1.

## Verification
- **Engine (Node harness):** BA48 (SEA→LHR) yields estimated **Isha & Fajr** (`portioned`) between
  Maghrib and Dhuhr; assert **Fajr < local sunrise and Isha > local sunset** at every night-bearing
  latitude (no absurdity); assert a **true midnight-sun** point returns a `substituted` time; DY394
  destination shows estimated Fajr/Maghrib/Isha. Switching the setting (`seventhnight`↔
  `twilightangle`) changes the portioned times. A normal mid-latitude flight (SV124) is **unchanged**
  (no `estimated` entries; identical model to before this change).
- **UI (Playwright on preview):** BA48 renders the estimate cards + note; the Settings control
  re-renders the times; DY394 shows estimates; SV124 visually unchanged.
