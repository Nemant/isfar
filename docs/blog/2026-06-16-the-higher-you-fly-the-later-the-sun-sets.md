# The higher you fly, the later the sun sets — draft notes

> **Status:** outline / draft notes only. Not yet a published page. Captured from the
> 2026-06-16 chat where we shipped the cruise-altitude estimate (`engine.js` `estimateCruiseFt`)
> and worked out where the bare 38,000 ft default actually went wrong.
> Convention: these are draft notes, later canonicalised into a `src/pages/guide/…astro` page
> (as the far-north guide was — `src/pages/guide/far-north-prayer-times.astro`).

## Title

- **The higher you fly, the later the sun sets** ← recommended. Subtitle: "How cruise altitude
  pushes Maghrib later — and why a Ramadan turboprop is the case that bites."
- Alternates: *Seeing past the horizon* · *A guess about altitude* · *The three minutes you waited
  too long for iftar* (the turboprop Maghrib hook).

Slug: `/guide/altitude-and-prayer-times`. **Listed and indexed** (methodology piece like the
far-north guide — not noindex). Crosslink with `far-north-prayer-times` and `asr-fails-first`.

## Dek / one-liner

From a cruising plane the sun sets later than it does for the city below — you can literally see
past the curve of the Earth, so the disk takes a few more minutes to drop out of view. For someone
fasting, that means Maghrib (iftar) comes later in the air than on the ground. Isfar bakes that in.
But the airline never tells us how high you're actually flying, so we estimate it from the aircraft
type — and on a low-cruising turboprop, the old one-size guess held iftar back about three minutes
too long. Here's the geometry, the guess, and the fix.

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
   **~12.6 minutes at the equator**, and a little more away from it as the sun slants in shallower
   (the same vertical dip eats more clock): **~13.6 min at 24° (Jeddah, Madinah), ~14.6 min at 30°
   (Cairo, Lahore), ~16.6 min at 40° (Istanbul, Tashkent)**. This is `altDipMinutes(lat, altFt)` in
   `engine.js`. It errs *slightly late* for Maghrib on purpose — the safe side: you never pray
   while the sun is still visibly up.

3. **The problem: nobody tells us the altitude.** AeroDataBox returns the airline, the route, the
   times, the aircraft *model* — but not a cruise altitude (and a live one only exists once the
   plane is airborne, useless for someone planning before the flight). So for years the engine
   simply assumed **38,000 ft** for everyone.

4. **How wrong is one flat guess?** Across the realistic 31,000–43,000 ft band, surprisingly
   little. The dip changes by only ~1 minute either side of the 38k assumption at the latitudes
   most travellers fly. The headline error is not the wide-body that cruises 3,000 ft higher than
   we guessed — it's the aircraft that flies **far lower**: a regional turboprop.

5. **Iftar on a turboprop — where it actually bites.** Picture a Ramadan evening hop: an Iran
   Aseman **ATR 72-600**, Tehran → Mashhad, ~36°N, climbing into the sunset as the fast nears its
   end. A turboprop cruises near **25,000 ft**, not 38,000 — and at altitude Maghrib genuinely
   falls *later* than on the ground, because you still see the sun after the city below has lost
   it. The question is *how much* later, and that depends on altitude we have to guess:
   - At ~36°N the dip pushes the in-flight sunset **~12 minutes** past the ground sunset at the
     true 25,000 ft — but **~15 minutes** if you wrongly assume 38,000.
   - Net: the old flat 38k guess put Maghrib **~3 minutes too late** (engine-checked: 2.9 min on
     this flight). Someone breaking their fast by the app would have waited about three minutes
     longer than the sun above the wing actually required.
   - This is the *safe* direction for iftar (you never break early), which is why it sat unnoticed —
     but it's still wrong, and the same ~3 minutes flips to the *unsafe* side for the Fajr-ending
     sunrise (window shown closing early). Both vanish once the altitude is right.

6. **The honest caveat that keeps it proportionate.** The dip is only ever applied to a **real**
   Maghrib / **real** Fajr-ending sunrise — never to a portioned or borrowed one (estimates get no
   dip). The effect grows with latitude, but the far-north latitudes where it would be largest are
   exactly where, in summer, those prayers stop being real and get portioned instead — so the dip
   isn't applied there at all. That leaves the meaningful real-world cases sitting right where most
   Muslims actually fly: the populated mid-latitudes, where a low-cruising turboprop is off by a
   real ~3 minutes and a jet by ~1.

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
   place it isn't (a regional turboprop climbing into a Ramadan sunset) and spending exactly the
   data you already have to fix it.

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
4. **The iftar you waited too long for.** A horizon line with the sun just below it; ground sunset
   marked, then the altitude-delayed Maghrib pushed later by the dip — show the true 25k value
   (+~12 min) and the wrong 38k assumption (+~15 min) for the Tehran→Mashhad ATR, the ~3-minute
   gap shaded as "minutes you waited that the sky didn't ask for."
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

- The dip figures (12.6 / 13.6 / 14.6 / 16.6 min at 38k for 0 / 24 / 30 / 40°; the 38k-vs-25k
  turboprop delta of ~15 vs ~12 min at ~36°N) come straight from `altDipMinutes`. **Pin the worked
  numbers with a test** (alongside `tests/engine-altitude.test.js`) so a future tweak to the dip
  constant or the family table can't silently invalidate the post's claims. The Tehran→Mashhad ATR
  centerpiece is already engine-checked: a real in-flight Maghrib, **2.9 min** later at the 38k
  default than at the true 25k cruise (THR 35.69,51.31 → MHD 36.23,59.64, dep 2026-03-05 14:00Z,
  ATR 72-600). Re-run `compute()` to confirm before printing, and keep the example on a *real*
  in-flight Maghrib (not a portioned one) so the dip actually applies.
- Re-confirm the "narrowbody == 38,000" claim still holds if the family table is retuned — the
  whole "most jets don't move off the old default" framing depends on it.
- Double-check the safe-side direction language: over-assuming altitude pushes **Maghrib later**
  (safe) but closes **Fajr earlier** (the unsafe one) — the post must not muddle the two.
