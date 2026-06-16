# The higher you fly, the later the sun sets — draft notes

> **Status:** outline / draft notes only. Not yet a published page. Captured from the
> 2026-06-16 chat where we shipped the cruise-altitude estimate (`engine.js` `estimateCruiseFt`)
> and worked out where the bare 38,000 ft default actually went wrong.
> Convention: these are draft notes, later canonicalised into a `src/pages/guide/…astro` page
> (as the far-north guide was — `src/pages/guide/far-north-prayer-times.astro`).

## Title

- **The higher you fly, the later the sun sets** ← recommended. Subtitle: "How cruise altitude
  bends Maghrib and Fajr — and why a turboprop at dawn is the case that bites."
- Alternates: *Seeing past the horizon* · *A guess about altitude* · *Six minutes of dawn you
  never had* (the turboprop Fajr hook).

Slug: `/guide/altitude-and-prayer-times`. **Listed and indexed** (methodology piece like the
far-north guide — not noindex). Crosslink with `far-north-prayer-times` and `asr-fails-first`.

## Dek / one-liner

At 38,000 ft the sun sets later and rises earlier than it does for anyone on the ground beneath
you — you can literally see past the curve of the Earth. Isfar has to bake that into Maghrib and
Fajr. But the airline never tells us how high you're flying, so we estimate it from the aircraft
type. Here's the geometry, the guess, and the one flight where guessing wrong actually costs you
prayer time.

## Outline

1. **The horizon is lower from up here.** Stand on a beach and the sea-horizon is exactly level.
   Climb, and it sinks below level by a "dip" angle — you're seeing over the bulge of the planet.
   At cruise the sun is therefore still up for a few minutes after it has set for the city below,
   and rises a few minutes before. For two prayers tied to the literal horizon — **Maghrib**
   (sunset) and the **sunrise that ends Fajr** — that shift is real and we must apply it. (Tie to
   the golden rule: this is *our* observer-geometry, not prayer-calc — adhan gives the sun's
   position, the horizon dip is ours, exactly like great-circle position and qibla bearing.)

2. **The number.** Dip angle ≈ `1.76 · √(height in metres)` arc-minutes; the sky turns at about
   4 minutes of time per degree. So at 38,000 ft (11,580 m) the sun-disk sunset is delayed
   **~12.6 minutes at the equator**. A latitude factor stretches it toward the poles (the sun
   slants in shallow, so the same vertical dip eats more clock): **~20 min at 50°, ~25 min at
   60°, ~36 min near 70°**. This is `altDipMinutes(lat, altFt)` in `engine.js`. It errs
   *slightly late* for Maghrib on purpose — the safe side: you never pray while the sun is still
   visibly up.

3. **The problem: nobody tells us the altitude.** AeroDataBox returns the airline, the route, the
   times, the aircraft *model* — but not a cruise altitude (and a live one only exists once the
   plane is airborne, useless for someone planning before the flight). So for years the engine
   simply assumed **38,000 ft** for everyone.

4. **How wrong is one flat guess?** Across the realistic 31,000–43,000 ft band, surprisingly
   little. The dip changes by under a minute and a half from the 38k assumption at common
   latitudes (±~1 min at 50°, ±~2.4 min at 60°). The headline error is not the wide-body that
   cruises 3,000 ft higher than we guessed — it's the aircraft that flies **far lower**.

5. **The turboprop at dawn — where it actually bites.** A Widerøe Dash-8 hopping up the Norwegian
   coast cruises near **24,000 ft**, not 38,000. The dip is *subtracted* from the Fajr-ending
   sunrise, so over-assuming altitude closes the Fajr window **early**:
   - At ~65°N the 38k assumption pulls the displayed sunrise **29.9 min** earlier than ground
     level; the true 24k value is only **23.7 min**.
   - Net: Fajr's window shown ending **~6 minutes too early**. A passenger trusting the app would
     think dawn had lapsed — or rush the prayer — while the sun is still six minutes below the
     real horizon from their seat.
   - Same effect, smaller, at common latitudes: ~4 min early at 50°N, ~5 min at 60°N.
   The mirror case (a wide-body stepped up to FL430 late in a long sector) shows Maghrib ~1.3 min
   *early* at 50°N — also the unsafe side, but small.

6. **The honest caveat that shrinks the scare.** The dip is only applied to a **real** Maghrib /
   **real** Fajr-ending sunrise — never to a portioned or borrowed one (estimates get no dip). The
   biggest dip errors live near the poles — but that's exactly where, in summer, those prayers
   stop being real and get portioned instead, so the dip isn't applied there at all. Where it
   genuinely fires (a real sunrise/sunset exists), the worst real-world residual is the
   mid-latitude turboprop above — a handful of minutes, not the half-hour the raw poleward numbers
   suggest.

7. **What Isfar does about it now.** `estimateCruiseFt(aircraftModel, distanceNm)`:
   - **Type is the dominant signal.** A small family table keyed off the model string —
     turboprop ≈ 25,000; regional jet ≈ 37,000; narrowbody ≈ 38,000 (= the old default, so most
     jets don't move); long-haul widebody ≈ 41,000.
   - **A short-leg clamp.** No aircraft reaches its ceiling on a brief hop (the step-climb never
     finishes), so legs under 250 / 500 / 1,000 nm are capped at 28k / 33k / 36k.
   - **Fallback.** Unknown model at cruise distance → the same 38,000 ft as before. Zero new API
     calls — `aircraft.model` is already in the response and the distance is already computed for
     the great-circle path. An explicit per-flight altitude on the record still overrides the
     estimate.

8. **Closing thought.** The sky-math here is fourteen centuries old and assumes your feet are on
   the ground. Flight breaks that one quiet assumption — the horizon itself moves. Most of the
   time a single sensible guess is within a minute of the truth; the craft is knowing the one
   place it isn't (a propeller aircraft climbing into a high-latitude dawn) and spending exactly
   the data you already have to fix it.

## Animations

1. **The dip, drawn.** Cross-section of the curved Earth, an observer at height *h*, the level
   line, and the horizon line sinking below it by the dip angle as a slider raises altitude 0 →
   43,000 ft. The sun sits just below the level line and pops back into view as you climb. Reduced
   motion: three stacked poses (ground / 25k / 41k).
2. **Minutes vs. altitude, by latitude.** The `altDipMinutes` curve plotted for equator / 50° /
   60° / 70°; a marker at 38k shows the default, a draggable marker shows "your" altitude and the
   delta. Makes "±1 min at mid-latitudes, but a cliff toward the pole" visible at a glance.
3. **Type → altitude bars (centerpiece).** The family table as a horizontal bar chart: turboprop
   25k, regional 37k, narrowbody 38k, widebody 41k, with example tails (Dash-8, E175, A320, 787).
   The 38k default line drawn across — the point is how far the turboprop bar sits below it.
4. **The escaping dawn.** Day as a band; the Fajr-ending sunrise marker at ground level, then
   pulled earlier by the dip — show the 38k assumption (−29.9 min) overshooting the true 24k
   value (−23.7 min) at 65°N, the 6-minute gap shaded as "dawn you never had."
5. **Static figure — which prayers get the dip.** Two of five prayers lit (Maghrib, Fajr-sunrise),
   the other three dimmed, with a note: only when *real*, never when portioned/borrowed.

## Production notes

- Same shell as `far-north-prayer-times.astro`: zero-JS-island SSG, pre-paint theme script,
  BlogPosting (+ FAQPage — "Does my altitude change my prayer times?" and "Why is sunset later on
  a plane?" are real user questions).
- Data-driven figures import `ISFAR_TEST` (now exposing `estimateCruiseFt` / `distanceNm`) and
  `altDipMinutes` at build time; the minutes-vs-altitude table should be generated, not hand-typed.
- Crosslinks: far-north guide ↔ this post (both lean on horizon geometry); `asr-fails-first` ↔
  this post (the "three kinds of prayer definition" taxonomy — Maghrib as a *horizon event* is
  exactly the prayer the dip acts on).

## Before publishing — verify

- The dip figures (12.6 / 20 / 25 / 36 min at 38k; the 38k-vs-24k turboprop deltas of 29.9 vs
  23.7 min at 65°N) come straight from `altDipMinutes`. **Pin the worked numbers with a test**
  (alongside `tests/engine-altitude.test.js`) so a future tweak to the dip constant or the family
  table can't silently invalidate the post's claims.
- Re-confirm the "narrowbody == 38,000" claim still holds if the family table is retuned — the
  whole "most jets don't move off the old default" framing depends on it.
- Double-check the safe-side direction language: over-assuming altitude pushes **Maghrib later**
  (safe) but closes **Fajr earlier** (the unsafe one) — the post must not muddle the two.
