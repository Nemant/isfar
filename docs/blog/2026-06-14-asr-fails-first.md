# Asr fails first — draft notes

> **Status:** outline / draft notes only. Not yet a published page. Captured from the
> 2026-06-13 chat where building the far-north year-wheel animation surfaced the Asr anomaly.
> Convention mirrors `2026-06-09-prayer-times-far-north.md` (draft notes → later canonicalised
> into a `src/pages/guide/…astro` page).

## Title

- **Asr fails first** ← recommended. Subtitle: "Why the afternoon prayer breaks two weeks
  before the sun stops rising."
- Alternates: *When noon has no afternoon* · *A shadow forty-six times your height* ·
  *We thought our animation had a bug* (better as the opening section heading than the title).

Slug: `/guide/asr-fails-first`. **Listed and indexed** (methodology piece like the far-north
guide — not noindex like the skipped-day istiftāʾ). Crosslink both ways with
`far-north-prayer-times`.

## Dek / one-liner

Polar night silences every prayer clock at once — except it doesn't. Asr goes first, thirteen
days early, while Maghrib and Dhuhr are still keeping honest time. The reason: Asr is the only
prayer defined against your own shadow rather than the sky.

## Outline

1. **The bug report we filed against ourselves.** Building the year wheel for the far-north
   guide, one ring looked wrong: Asr's dashes start mid-November, while Dhuhr and Maghrib beside
   it stay solid until polar night proper (Nov 28). A reader flagged it too. First instinct:
   off-by-one in the arc windows, a rendering glitch. (Honest meta-note: making the animation is
   what surfaced it — none of the per-day tables had made it visible.)

2. **The check.** Swept the engine day by day across the Tromsø year. The figure is exact: Asr
   flips to estimated **Nov 15**, polar night doesn't start until **Nov 28**, and Asr doesn't
   recover until **Jan 21** — five days *after* the sun returns. Thirteen days early in, five
   late out. Not a glitch.

3. **Three kinds of prayer-time definition** — the taxonomy that explains everything:
   - **An event** — the sun crosses a line. Dhuhr (transit — exists every day forever, even in
     polar night); Maghrib (horizon — works until the literal last sunset).
   - **An angle** — the sun reaches a fixed depth below the horizon. Fajr, Isha — these fail
     first at high latitude in *summer* (the far-north guide's story).
   - **A ratio** — Asr alone: wait until your shadow grows one more body-length past its noon
     length. The only prayer defined *relative to noon*, and that's the vulnerability.

4. **The afternoon collapses into noon.** Concrete numbers (Tromsø, 69.68°N, Nov 2026, 15°/ISNA,
   Shafiʿi 1× shadow):
   - Nov 10: noon sun 2.5° up — noon shadow already **23× your height**. Asr 18 min after Dhuhr.
   - Nov 14: shadow 39×, Asr 4 min after Dhuhr.
   - Nov 15: noon altitude 1.2°, shadow 46×, **Asr = Dhuhr to the minute**. The "one more
     body-length" rule is satisfied moments after noon because the shadow is already enormous and
     racing. No afternoon left to mark.

5. **Then the formula starts hallucinating.** Past the boundary the math doesn't return "no
   answer" — it returns garbage: Nov 20, Asr lands *before* Dhuhr (10:54 vs 11:31). Jan 19, Asr
   at **21:43 — eight and a half hours after sunset**, in full darkness. The geometry has no
   solution but the trigonometry keeps emitting numbers. (Framed carefully: not an adhan bug — a
   question the formula was never asked before.)

6. **What Isfar does about it.** The sanity gate (`engine.js` `daySchedule`): an Asr is real only
   if it lands strictly between Dhuhr and sunset; otherwise borrow the 60° afternoon, clamp it
   inside the local day, flag `~`. Ties to the golden rule: observe adhan's outputs, never
   re-predict the sky. Sidebar: the **Hanafi 2× rule** shifts the window (starts ~Nov 18, not 15)
   and in January it *flickers* — real Jan 16–17, fails Jan 18–20, then back for good. The
   boundary is ragged, which is exactly why it's gated empirically rather than predicted.

7. **Closing thought.** The shadow rule worked unmodified for fourteen centuries everywhere
   people lived; it fails only where the noon sun itself barely clears the horizon. Asr failing
   first isn't a defect of the fiqh — it's a measurement of how strange the far-north sky is: the
   place where even *noon* stops implying an afternoon.

## Animations

1. **Borrow: the year wheel** (`AnimYearWheel`) — reuse near the top. Consider an
   `asr-spotlight` variant/prop: other four rings dimmed, Asr's ring full-strength, polar-night
   arc drawn alongside so the 13-day-early / 5-day-late overhang is the visible point. The post's
   origin story makes this figure load-bearing.
2. **New — the shadow stick (centerpiece).** Gnomon + shadow, date scrubber Nov 1 → Dec 1.
   Shadow stretches 15× → 23× → 46× → off-frame; the Asr trigger ("+1 body length") marker slides
   backward into the noon marker until they touch on Nov 15. Reduced-motion: three static poses.
3. **New — the collapsing afternoon.** Dhuhr→Asr gap as a shrinking wedge/bar through November:
   18 min → 4 min → 0 → *negative* (raw output crossing to the wrong side of noon). Could merge
   with #4.
4. **New — the escaping dot.** Day as a band (sunrise→sunset); adhan's raw Asr output as a dot
   that drifts through the band, exits past sunset in January (the 21:43 night-Asr), re-enters
   Jan 21. Makes "the formula keeps emitting numbers" visceral.
5. **Static figure — the taxonomy.** Event / angle / ratio as three small diagrams. Plain SVG,
   no animation needed.

## Production notes

- Same shell as `far-north-prayer-times.astro`: zero-JS-island SSG, pre-paint theme script,
  BlogPosting (+ FAQPage if we add 2–3 FAQs; "Why is Asr estimated when sunset shows normally?"
  is now a real user question).
- Data-driven figures import `ISFAR_TEST` / `daySchedule` at build time (like the skipped-day
  figures); the sweep tables in the post should be generated, not hand-typed.
- Crosslinks: far-north guide ↔ this post. The year-wheel figcaption there could gain a "why
  Asr's ring is wider →" link.

## Before publishing — verify

The section-5 "hallucinating formula" numbers (Nov 20 Asr-before-Dhuhr; Jan 19 Asr 21:43) come
from adhan's raw output. **Pin them with a regression test** (like the other audited-bug tests in
`tests/engine-regressions.test.js`) so a future adhan upgrade that starts returning `null` instead
of garbage doesn't silently invalidate the post's claims. Re-run the Tromsø year sweep to confirm
the Nov 15 / Nov 28 / Jan 21 boundary dates before they go in print.
