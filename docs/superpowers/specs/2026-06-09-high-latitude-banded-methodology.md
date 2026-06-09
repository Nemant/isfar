# High-latitude banded methodology — design spec

**Date:** 2026-06-09
**Supersedes:** `2026-06-09-high-latitude-fallback-design.md` (the two-option toggle).
**Status:** approved in conversation; ready to plan.

## Why

The shipped feature exposed a user setting ("Far-north prayers": *Last seventh of the
night* vs *Twilight angle*). That asks the traveller to pick a scholarly portioning
rule — choice-paralysis, and it leans on adhan's `AqrabBalad`, which slides to the
*nearest* latitude with a horizon crossing. Near the polar boundary that can be a
15-minute "night," producing silly times.

We are replacing the toggle with **one house methodology**, applied automatically, and
**explaining it** in "How Isfar works". No user choice; take a clear, defensible
position and document it.

## The methodology (banded by latitude)

Let `φ` be the latitude where a prayer is evaluated (origin, an in-flight position, or
destination). Fajr and Isha are the only twilight-dependent prayers; Dhuhr and Asr are
always defined; Maghrib/sunrise are sun-disk events that exist whenever the sun crosses
the horizon.

- **|φ| ≤ 55° — the chosen method's angle.** Use whatever fatwa-council angle the user
  selected (ISNA 15°, MWL 18°, …), unchanged. (In deep summer the angle can fail even
  here; the next rule's portioning self-heals it, so there is no hard 55° branch in the
  code — it emerges.)
- **55° < |φ| ≤ 60° — seventh of the local night.** When the angle has no moment to
  mark, portion the traveller's *own* night: Isha a seventh after sunset, Fajr a seventh
  before sunrise. adhan's `HighLatitudeRule.SeventhOfTheNight` does exactly this and is a
  **no-op wherever the angle still resolves** (e.g. winter), so we set it everywhere.
- **|φ| > 60° — borrow latitude 60.** Above 60° a settled night isn't guaranteed, so
  the twilight prayers that can't be resolved locally are taken from **latitude 60°**
  (same longitude) — the furthest north with a dependable night. Dhuhr and Asr stay
  **local** (always defined, and meaningfully latitude-dependent). Maghrib and sunrise
  stay **local wherever the sun still sets** (60–66.5°) and are borrowed from 60° only
  when there is no horizon crossing at all (true midnight sun / polar night).

### Why 60°N (and why those cities)

60° is chosen, not 66.5°, for two reasons that coincide:

- **Astronomical** — 60°N is the furthest latitude with a dependable settled night all
  year. Below the Arctic Circle (66.5°) the sun still sets, but from ~60° up the summer
  night holds no real darkness, and above 66.5° the sun doesn't set at all. 60° is the
  last latitude where "a seventh of the night" rests on a night that is actually hours
  long; higher up the night to divide shrinks toward zero. So the floor caps the
  discomfort — above 60° the night-portion never gets tighter than 60°'s.
- **Demographic** — 60°N is also, in practice, the northern edge of the world's major
  cities, and they cluster right on that line: St Petersburg (59.9°, ~5.6M), Stockholm
  (59.3°, ~2.4M), Oslo (59.9°, ~1.7M), Helsinki (60.2°, ~1.5M), Anchorage (61.2°, ~0.4M)
  — all with substantial, established Muslim communities. Anchoring at 60° covers
  essentially every major place a traveller actually lands; beyond it, the few who reach
  Tromsø or Murmansk get a clearly-flagged 60°N estimate, which is the most defensible
  thing on offer where there is no true night anyway. These cities double as the
  user-facing anchors for "where 60°N is."

> **Footnote (honesty):** it is not literally *nothing* beyond 60°. Mid-size Russian
> Arctic/Siberian centres exist — Arkhangelsk (~350k, 64.5°), Yakutsk (~355k, 62°),
> Murmansk (~270k, 68.9°, the largest city above the Arctic Circle). But there is a sharp
> order-of-magnitude drop past the St Petersburg/Stockholm cluster: nothing million-scale,
> mostly industrial regional centres, and Muslim populations thin quickly. The claim is
> "60° covers the major metros," not "nothing lives north of 60°."

### What stays honest in the labels

`estimateBasisFor(key, φ, ms, params)` keeps returning `"real" | "portioned" |
"substituted"`, by **astronomy**, not by a geographic line:

- `real` — the prayer has a genuine local event (angle reached, or a real sunset, or
  interval-based Isha).
- `portioned` — a local night exists but the angle isn't reached **and** |φ| ≤ 60 →
  we divided the local night into sevenths.
- `substituted` — borrowed from latitude 60: either no day/night cycle at all
  (midnight sun / polar night), **or** the angle isn't reached and |φ| > 60.

The **only** change from the current function is the final branch: where it used to
return `"portioned"` unconditionally when the angle isn't reached, it now returns
`"substituted"` when `|φ| > 60`, else `"portioned"`.

### Banner vs. labels (decoupled)

The "the sun won't set/rise at <city>" banner and the after-arrival dedup/roll-forward
fire **only for a true no-cycle destination** (`|φ+δ| > 90 || |φ−δ| > 90`). An
above-60 destination that still has a real night (Oslo in summer) borrows latitude-60
twilight times and is labelled `substituted`, but flows through the normal
before/in-flight/after placement with **no banner** — because the sun *does* set there.

## Golden-rule compliance

Every time still comes from adhan. The "borrow latitude 60" step calls
`adhan.PrayerTimes` with `Coordinates(60, lon)` — we choose *where* to ask, never
compute a time ourselves. `AqrabBalad` is intentionally dropped in favour of the fixed
60° floor.

## Out of scope / known simplifications

- Below 60° we use real twilight whenever the angle resolves (winter), rather than
  forcing 1/7 across the whole 55–60° band. This is strictly more accurate and matches
  the intent ("reasonable times").
- A polar *over-flight* that lands below 55° will show borrowed-from-60 twilight prayers
  for the arctic leg (same as today under `AqrabBalad`). No regression; not addressed.
- Seasonal shafaq (red/white) and the Moonsighting season-curve are **not** adopted; the
  user's model is "your council's angle + 1/7 + a 60° floor," a deliberate simplification
  of moonsighting.com.

## Surfaces touched

- `src/lib/engine.js` — `makeParams` (drop `highLat`/`AqrabBalad`, always
  `SeventhOfTheNight`), `HIGHLAT_FLOOR`, `estimateBasisFor` (one-line split),
  `rawInstants`/`instantsAt` (60° borrow), `sunriseAt` (delegate), `compute`
  (`destNoCycle` gating of `destSub`/banner).
- `src/lib/data.js` — remove `HIGHLAT` export.
- `src/components/components.jsx` — remove the "Far-north prayers" settings field +
  `HIGHLAT` import; add a "Far-north flights" point to `MethodSheet`.
- `src/components/Calculator.jsx` — drop `highLat` from settings/compute/memo/props.
- `src/components/cards.jsx` — `EstimateNote` copy (portioned vs borrowed-from-60).
- `scripts/test-highlat.mjs` — drop the toggle-switch test; add 60°-borrow + winter-real
  assertions; expose `instantsAt` on the test hook.
