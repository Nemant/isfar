# High-latitude policy rewrite — design

**Date:** 2026-06-10 · **Status:** approved (user, this session)
**Scope:** `src/lib/engine.js` (core rewrite), UI honesty fixes (`Calculator.jsx`,
`components.jsx`, `cards.jsx`, `arc.jsx`), new vitest test suite, CLAUDE.md +
guide-page copy alignment.

## Why

A 41-agent audit (verified against adhan-js 4.4.3 source + live engine runs) confirmed
~16 distinct bugs. Root causes, in order of damage:

1. **The engine predicts adhan instead of observing it.** `estimateBasisFor` re-derives
   reachability with its own declination approximation and a refraction-free horizon
   test. In the disagreement bands, prayers silently vanish (Maghrib at Rovaniemi for
   ~a month each summer; interval Isha with Umm al-Qura/Qatar), clamped fallbacks are
   shown unflagged, and the banner contradicts the cards.
2. **The Before/After lists don't roll across days.** Late-evening arrivals (incl. the
   SV124 demo) show an empty After list; red-eye departures show an empty Before list.
3. **The in-flight walk mishandles policy discontinuities.** The rule-1↔2 cliff makes
   the residual sign-flip detector miss prayers entirely (southbound pre-dawn Fajr,
   northbound evening Isha) or capture times from the past (DY394's Maghrib shown
   ~19 min before the visible sunset); adhan's degenerate polar Asr produces bogus
   unflagged captures that also dedup-delete the destination's real Asr.
4. **Real and borrowed times interleave incoherently** (Isha rendered before Maghrib
   at 61–66.5°N in June).
5. **UI honesty gaps:** NextPrayer shows estimates with no `~`; the banner is
   destination-only; the MethodSheet copy describes a two-tier policy that contradicts
   the code; the arc gives estimates no visual/aria distinction.

## The policy (user-stated, 3 rules)

Per prayer, per position (lat, lon), per date:

1. **Real angle.** Fajr/Isha use the chosen method's angle at the **true position**
   whenever the sky reaches it — at any latitude. (Guide's worked example preserved:
   Isha at 62°N on Dec 21 is real and unflagged.)
2. **1/7 of the local night** when the angle is unreachable and |lat| ≤ 60 —
   adhan `SeventhOfTheNight` at the true position. Flagged.
3. **60° floor** when the angle is unreachable and |lat| > 60: the **whole night
   cluster — Maghrib, Isha, Fajr, sunrise — comes from the 60° sky** at the same
   longitude (adhan at `(sign(lat)·60, lon)` with `SeventhOfTheNight`, i.e. the
   method's angle wherever the borrowed sky reaches it, 1/7 of the borrowed night
   otherwise). Dhuhr and Asr stay local and unflagged. Cluster flagged.
   *User decision:* whole-cluster borrow (not angle-only) so prayer order is coherent
   by construction; the visible-sunset mismatch (~10 min at 61°N → ~1 h at 66.4°N) is
   accepted and flagged, largest exactly where the local night is degenerate anyway.

**Overrides (all observation-driven):**

- **No cycle** — adhan's sunrise *or* sunset is Invalid at the true position (midnight
  sun, polar night, including the refraction fringe adhan sees but geometry misses):
  night cluster from 60° as in rule 3. **Dhuhr keeps the local transit, flagged**
  (guide's polar-night example). **Asr:** midnight sun → local real if adhan yields it
  (valid up to ~82°N Hanafi / ~86°N Shafi; borrowed beyond — fixes the transpolar Asr
  drop); polar night → borrowed + flagged (kills the degenerate middle-of-night Asr).
  Banner `kind` = `polarnight` if |lat−decl| > |lat+decl| else `midnightsun`, gated on
  the observed invalidity (no more "won't rise" banners while the sun briefly rises).
- **Moonsighting Committee:** trusted as the method's own rule whenever a cycle exists
  (adhan applies night/7 + seasonal tables internally at ≥55°) — **no estimate flag**
  (user decision: it is the authority's published methodology, same standing as ISNA's
  angles). Joins the cluster borrow when no cycle exists.
- **Interval Isha (Umm al-Qura, Qatar):** real whenever a cycle exists (sunset + 90 min) *and
  the 60° floor hasn't engaged*; when Fajr drags the night to the floor, Isha joins the borrowed
  cluster (= the 60° sunset + interval) so the evening stays coherent. Never goes through
  reachability detection. Likewise, a fajr/isha angle that is itself reachable joins the cluster
  when its partner is not — whole-night coherence wins over a lone real angle.
- **Tehran maghrib angle:** adhan's internal sunset fallback is accepted as the method's
  time (documented; no flag).

**Reachability detection (the heart of the fix):** a Fajr/Isha value from adhan (base
rule `MiddleOfTheNight`) counts as *substituted* iff it equals adhan's own safe-time —
`roundedMinute(sunrise − night/2)` / `roundedMinute(sunset + night/2)` — recomputed
from adhan's outputs (today's sunset, tomorrow's sunrise — each stripped of the method's
sunrise/sunset minute adjustments, since adhan derives night from the unadjusted internals;
Turkey adjusts sunrise −7, Dubai −3), compared with ±2 min tolerance (the minute-rounding of
three reconstructed inputs can stack past 90 s). Otherwise it is the real angle time. This replicates one line of
adhan's substitution arithmetic instead of its astronomy; a coincidental equality on a
boundary day downgrades that day to 1/7 (flagged) — harmless, the policy cliff merely
shifts by a day. Moonsighting skips detection entirely (see above).

**`estimateBasisFor` is deleted.** Each instant carries the `source` of the branch that
produced it: `'angle' | 'method' | 'seventh' | 'borrow60'`. `estimated` ⇔ source is
`seventh`/`borrow60` (plus flagged polar Dhuhr, source `'method'`+`estimated:true` —
the one exception, per the guide). Flag and time can never disagree again.

**Accepted policy artifact:** the rule-1↔2 cliff (a one-time jump of ~2–3 h in
Fajr/Isha at the boundary date/latitude) is inherent to the user's policy. The engine
must handle it losslessly (lists + walk below); both sides are honestly labeled.

## Engine restructure

- **`daySchedule(lat, lon, refMs, params)`** — the only function that calls adhan.
  Returns `{fajr, sunrise, dhuhr, asr, maghrib, isha}`, each
  `{ms, source, estimated}`, for the mean-solar day implied by `lon` around `refMs`.
  **Guaranteed non-null for all six instants at every lat/date/method** — the
  "silently missing prayer" class becomes impossible by construction (test-enforced).
  Internally: pt(true coords), pt(next day, for night length), pt_seventh(true) and/or
  pt_seventh(±60) as the ladder requires. No memo cache — measured cost is far under the perf
  budget and the walk's positions never repeat exactly.
  **Ordering guards (within every daySchedule):** a method whose Maghrib is a depression angle
  after sunset (Tehran 4.5°) can outrun the seventh-of-night Isha — the portion is re-anchored on
  the method's own nightfall (Isha = maghrib + night/7), in both the local seventh tier and the
  borrowed cluster. A borrowed Asr is clamped inside the local day (the 60° afternoon can outlast
  a fringe-latitude day), and a real Asr in midnight sun is borrowed instead when it would land
  after the borrowed dusk.
- **Before/After unified, rolled across days.** Before = last `BEFORE_CAP` instants
  ≤ dep scanning dep-day−1 ∪ dep-day; After = first `AFTER_CAP` instants > arr
  scanning arr-day ∪ arr-day+1. The no-cycle special branch (roll-forward + dedup)
  is deleted; the banner data (`skyNotes`) is computed independently of list assembly.
- **Cliff-aware in-flight capture.** Keep the 1-min walk and residual sign-flip per
  prayer/dayKey, but: capture time `T = pm` when the flip was smooth
  (`ms − pm ≤ STEP`), else `T = ms` (the moment the prayer *became due aloft* after a
  schedule jump). Require `T ∈ [dep, arr]` — including after the Maghrib horizon-dip is
  added (the dip never pushes an in-flight prayer past landing); drop the old `pm ≥ dep`
  guard that swallowed jumped prayers. The prayer's display fields (zones, qibla, sun fraction)
  are evaluated at `T` and the position at `T`.
- **Cross-list dedup:** replace key-equality across heterogeneous dayKeys with a final
  pass over the merged, ms-sorted entries: drop any entry whose `key` already appeared
  within 6 h (same prayer cannot recur that fast; QF10's twin Fajrs are ~22 h apart).
- **Horizon dip** applied only to *real* sun-disk events (source `angle`/`method`
  Maghrib later; real sunrise earlier, for Fajr's end). Estimates get no dip.
- **Model:** `midnightSun` → **`skyNotes`** — an array of
  `{place: 'origin'|'destination', city, iata, latitude, kind, allEstimated, names}`,
  one entry per no-cycle endpoint (origin now included). Everything else in the model
  keeps its shape (`prayers[]` entries gain `source`; `estimated`/`estimateBasis`
  remain for UI compat, `estimateBasis` now = `source` when estimated).

## UI + copy

- **NextPrayer:** `~` before times + "estimated" in the meta line when
  `next.estimated`.
- **Calculator banner:** renders one banner per `skyNotes` entry (origin and/or
  destination), same visual.
- **MethodSheet** "Far-north flights": rewritten to state the 3 real rules (angle →
  1/7 of your night → 60° floor), including that estimates can appear at e.g. 55°N
  in June.
- **EstimateNote** (cards): latitude-neutral wording; names the 1/7 and 60° borrow.
- **Arc:** estimated dots get a dashed halo ring; per-dot aria gains "(estimated)";
  svg aria-label wording softened ("placed by time of day").
- Guide page: one clarifying phrase in the "beyond 60°" bullet (the night's sun
  events — Maghrib and sunrise — are read from the 60° sky too). Flagged to user.

## Tests (vitest, `npm test`)

- `vitest` as devDependency; `"test": "vitest run"` script; tests in `tests/`.
- **Policy matrix:** lat × season × methods (mwl, isna, moonsighting, ummalqura,
  tehran, hanafi asr) asserting source/flag and time agreement with raw adhan where
  real; hemisphere mirror (−70°S ↔ 70°N with seasons swapped).
- **Invariants** (grid + randomized flights): all six instants non-null everywhere;
  within-schedule ordering fajr < sunrise ≤ dhuhr < asr < maghrib < isha for every
  daySchedule; flags ⇔ sources; After length always = AFTER_CAP; Before non-empty
  whenever any prayer precedes dep within 24 h; in-flight T ∈ [dep, arr]; no same-key
  entries within 6 h; compute(QF10) < 2 s.
- **Regression tests, one per confirmed audit bug:** Rovaniemi/HEL→RVN June Maghrib
  present+flagged; SV124 (arr 23:05) After = 2 with next-day Fajr; FRA→CPH evening
  Isha present; LHR→MAD pre-dawn Fajr present; TRD→TOS winter: no middle-of-night
  Asr, destination Asr present; JED red-eye Before non-empty; CPH winter moonsighting
  unflagged and = adhan output; OSL→LYR boundary date: flags consistent with banner;
  TOS→OSL origin banner present; DY394 golden (gap-free, Dhuhr present, no dip on
  substituted Maghrib); QF10 9-prayer golden; EK215 golden; 61–66.5°N June ordering
  (no Isha before Maghrib).

## Verification & ship

`npm test` green → `npm run build` green → `npm run preview` + Playwright over the
four sample chips (banner, pills, ~, order, console clean) → multi-agent adversarial
review workflow over the diff → commit to main → push (auto-deploys isfar.app; user
approved push-when-green).

## Out of scope

True cruise altitude per flight; Worker date resolution; arc sine geometry (the
time-of-day proxy stays, documented); `solarFrac`'s unused lat param cleanup happens
only as drive-by.
