# High-latitude banded methodology — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-facing high-latitude *toggle* with one automatic house methodology — chosen angle ≤55°, seventh-of-the-night 55–60°, borrow latitude-60 above 60° — and explain it in the app.

**Architecture:** A near-surgical engine change: `estimateBasisFor` gains a one-line 60° split; the latitude-60 borrow lives entirely in a new `rawInstants`/`instantsAt` pair; `makeParams` drops the toggle and always sets `SeventhOfTheNight` (dropping `AqrabBalad`); `compute` gates the midnight-sun banner on a true no-cycle destination. The settings control is removed and a methodology note added. All prayer times still come from adhan (we only choose *where* to ask).

**Tech Stack:** Astro + React island, adhan-js 4.x (npm), Node assertion harness (`scripts/test-highlat.mjs`, no test framework), Vite build, Playwright on the preview.

**Verification oracle:** `node scripts/test-highlat.mjs` (must print `N passed, 0 failed`), then `npm run build`, then Playwright on `npm run preview`.

**Reference:** design spec `docs/superpowers/specs/2026-06-09-high-latitude-banded-methodology.md`.

---

### Task 1: Engine — the banded methodology

**Files:**
- Modify: `src/lib/engine.js`
- Test: `scripts/test-highlat.mjs`

This task changes the math and labels together (they are interdependent: removing
`AqrabBalad` makes the polar case rely on the new borrow), and updates the harness to the
new contract in the same commit.

- [ ] **Step 1: Update the harness to the new contract (red)**

In `scripts/test-highlat.mjs`, change the shared options and the test hook destructuring,
drop the toggle-switch test, and add the new assertions.

Change `OPTS` (remove `highLat`):

```js
const OPTS = { method: 'isna', madhab: 'shafi' };
```

In the "Task 2: detection gate" block, change the `makeParams` calls to two args and add
the 60°-split assertions. Replace the whole block body with:

```js
{
  const { estimateBasisFor, makeParams } = ISFAR_TEST;
  const isna = makeParams('isna', 'shafi');                    // fajr/isha angle 15
  const sols = Date.parse('2026-06-21T12:00:00Z');             // June solstice
  const dec  = Date.parse('2026-12-21T12:00:00Z');             // December solstice
  ok('45N Isha is real (15deg reached)',   estimateBasisFor('isha', 45, sols, isna) === 'real');
  ok('60N Isha is portioned (<=60 floor)', estimateBasisFor('isha', 60, sols, isna) === 'portioned');
  ok('60.19N June Fajr is substituted (>60)', estimateBasisFor('fajr', 60.19, sols, isna) === 'substituted');
  ok('64N June Fajr is substituted (>60)', estimateBasisFor('fajr', 64, sols, isna) === 'substituted');
  ok('64N December Fajr is real (winter night)', estimateBasisFor('fajr', 64, dec, isna) === 'real');
  ok('70N Isha is substituted (no night)', estimateBasisFor('isha', 70, sols, isna) === 'substituted');
  ok('70N Dhuhr is real (noon always)',    estimateBasisFor('dhuhr', 70, sols, isna) === 'real');
  ok('70N Maghrib is substituted',         estimateBasisFor('maghrib', 70, sols, isna) === 'substituted');
  const uaq = makeParams('ummalqura', 'shafi');                // interval Isha
  ok('60N UmmAlQura Isha real (interval)', estimateBasisFor('isha', 60, sols, uaq) === 'real');
}
```

Add a new block (after that one) that proves the latitude-60 borrow via the exposed
`instantsAt`:

```js
// --- latitude-60 borrow: above 60 the twilight prayers come from lat 60, Asr stays local ---
{
  const { instantsAt, makeParams } = ISFAR_TEST;
  const p = makeParams('isna', 'shafi');
  const lon = 18.92, ref = Date.parse('2026-06-21T12:00:00Z');
  const at69 = instantsAt(69.68, lon, ref, p);
  const at60 = instantsAt(60, lon, ref, p);
  ok('69N June Fajr is borrowed from lat 60', at69.fajr && at60.fajr && at69.fajr.getTime() === at60.fajr.getTime());
  ok('69N June Isha is borrowed from lat 60', at69.isha && at60.isha && at69.isha.getTime() === at60.isha.getTime());
  ok('69N June Asr stays local (differs from 60)', at69.asr && at60.asr && at69.asr.getTime() !== at60.asr.getTime());
}
```

Delete the entire "Task 8: switching the high-lat rule changes portioned times" block
(the toggle no longer exists):

```js
// --- Task 8: switching the high-lat rule changes portioned times ---
{
  const seven = compute(BA48, { method: 'isna', madhab: 'shafi', highLat: 'seventhnight' });
  const twi   = compute(BA48, { method: 'isna', madhab: 'shafi', highLat: 'twilightangle' });
  const iS = seven.prayers.find(p => p.key === 'isha' && p.status === 'inflight');
  const iT = twi.prayers.find(p => p.key === 'isha' && p.status === 'inflight');
  ok('twilight-angle changes the portioned Isha time', iS && iT && iS.ms !== iT.ms);
}
```

- [ ] **Step 2: Run the harness to confirm it fails**

Run: `node scripts/test-highlat.mjs`
Expected: FAIL — `ISFAR_TEST` has no `instantsAt` yet, and `makeParams('isna','shafi')`
still sets the old rule. Several assertions fail / throw.

- [ ] **Step 3: Add the `HIGHLAT_FLOOR` constant**

In `src/lib/engine.js`, alongside the other top-of-IIFE constants (after the
`BEFORE_CAP, AFTER_CAP` line ~26), add:

```js
  const HIGHLAT_FLOOR = 60;  // above this latitude, borrow twilight times from lat 60
```

- [ ] **Step 4: Split the final branch of `estimateBasisFor`**

In `src/lib/engine.js`, change ONLY the last line of `estimateBasisFor` (currently
`return depth >= angle ? "real" : "portioned";`) to:

```js
    if (depth >= angle) return "real";
    return Math.abs(lat) > HIGHLAT_FLOOR ? "substituted" : "portioned";
```

Leave the rest of the function (the `noCycle`, `maghrib`, interval-Isha branches)
untouched.

- [ ] **Step 5: Simplify `makeParams` (drop toggle + AqrabBalad)**

Replace the `HIGHLAT_RULE` const and the `makeParams` function (current lines ~89–107)
with:

```js
  function makeParams(method, madhab) {
    const M = adhan.CalculationMethod;
    const map = {
      mwl: M.MuslimWorldLeague, isna: M.NorthAmerica, moonsighting: M.MoonsightingCommittee,
      egyptian: M.Egyptian, ummalqura: M.UmmAlQura, dubai: M.Dubai, qatar: M.Qatar,
      kuwait: M.Kuwait, karachi: M.Karachi, singapore: M.Singapore, turkey: M.Turkey,
      tehran: M.Tehran
    };
    const p = (map[method] || M.MuslimWorldLeague)();
    p.madhab = (madhab === "hanafi") ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
    // High-latitude policy: portion the local night by sevenths when the chosen method's
    // twilight angle has no moment to mark — SeventhOfTheNight is a no-op wherever the
    // angle still resolves, so it is safe to set everywhere. Above 60° we borrow latitude
    // 60's twilight times in instantsAt. adhan's AqrabBalad is intentionally NOT used: it
    // slides to the nearest valid latitude (can be a sliver of a night); a fixed 60° floor
    // is steadier and is the rule we explain to users.
    p.highLatitudeRule = adhan.HighLatitudeRule.SeventhOfTheNight;
    return p;
  }
```

- [ ] **Step 6: Add `rawInstants` + the borrowing `instantsAt`, and delegate `sunriseAt`**

Replace the current `instantsAt` (lines ~111–120) and `sunriseAt` (lines ~123–130) with:

```js
  /* prayer instants at a position for the local calendar date implied by the
     longitude (mean solar offset) around a reference instant — raw adhan output */
  function rawInstants(lat, lon, refMs, params) {
    const localApprox = new Date(refMs + (lon / 15) * 3600000);
    const d = new Date(Date.UTC(localApprox.getUTCFullYear(),
                                localApprox.getUTCMonth(),
                                localApprox.getUTCDate(), 12));
    const pt = new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
    const out = {};
    ORDER.forEach(k => { const v = pt[k]; out[k] = (v && !isNaN(v.getTime())) ? v : null; });
    out.sunrise = (pt.sunrise && !isNaN(pt.sunrise.getTime())) ? pt.sunrise : null;
    return out;
  }

  /* Banded high-latitude policy. Below the 60° floor the local times stand
     (SeventhOfTheNight already portions any too-bright night). Above 60° the
     twilight-dependent prayers with no dependable local event are taken from latitude 60
     — the furthest north with a settled night — while Dhuhr and Asr (always defined) stay
     local, and Maghrib/sunrise stay local wherever the sun still crosses the horizon. */
  function instantsAt(lat, lon, refMs, params) {
    const local = rawInstants(lat, lon, refMs, params);
    if (Math.abs(lat) <= HIGHLAT_FLOOR) return local;
    const borrow = rawInstants(Math.sign(lat) * HIGHLAT_FLOOR, lon, refMs, params);
    const out = Object.assign({}, local);
    ORDER.forEach(k => {
      if (k === "dhuhr" || k === "asr") return;
      if (estimateBasisFor(k, lat, refMs, params) === "substituted") out[k] = borrow[k];
    });
    if (!local.sunrise) out.sunrise = borrow.sunrise;
    return out;
  }

  /* sunrise instant at a position (when Fajr ends) — follows the same banded policy */
  function sunriseAt(lat, lon, refMs, params) {
    return instantsAt(lat, lon, refMs, params).sunrise;
  }
```

- [ ] **Step 7: Drop the `highLat` argument in `compute`**

In `src/lib/engine.js`, in `compute` (line ~206), change:

```js
    const params = makeParams(opts.method || "mwl", opts.madhab || "shafi", opts.highLat || "seventhnight");
```

to:

```js
    const params = makeParams(opts.method || "mwl", opts.madhab || "shafi");
```

- [ ] **Step 8: Gate `destSub` and the banner on a true no-cycle destination**

In `src/lib/engine.js`, replace the two lines (current ~251–252):

```js
    const inst = instantsAt(to.lat, to.lon, arr, params);
    const destSub = ORDER.filter(k => estimateBasisFor(k, to.lat, arr, params) === "substituted");
```

with:

```js
    const inst = instantsAt(to.lat, to.lon, arr, params);
    const _arrDecl = solarDeclination(arr);
    const destNoCycle = Math.abs(to.lat + _arrDecl) > 90 || Math.abs(to.lat - _arrDecl) > 90;
    // Only a TRUE no-cycle destination (midnight sun / polar night) gets the special
    // dedup + roll-forward + banner. An above-60 destination that still has a real night
    // (e.g. Oslo in summer) borrows latitude-60 twilight times but otherwise flows through
    // the normal before/in-flight/after placement — and shows no "sun won't set" banner.
    const destSub = destNoCycle
      ? ORDER.filter(k => estimateBasisFor(k, to.lat, arr, params) === "substituted")
      : [];
```

Then inside the `if (destSub.length) {` block, remove the now-redundant local declination
recompute (current line ~284 `const _decl = solarDeclination(arr);`) and use `_arrDecl` in
the `kind` expression (line ~288):

```js
        kind: Math.abs(to.lat + _arrDecl) > 90 ? "midnightsun" : "polarnight",
```

- [ ] **Step 9: Expose `instantsAt` on the test hook**

In `src/lib/engine.js`, change the `_test` object on the return (line ~364):

```js
  return { compute, greatCircle, _test: { estimateBasisFor, makeParams, solarDeclination, instantsAt } };
```

- [ ] **Step 10: Run the harness to confirm it passes**

Run: `node scripts/test-highlat.mjs`
Expected: PASS — `N passed, 0 failed` (all gate, borrow, winter-real, DY394 banner, and
winter polar-night assertions green).

- [ ] **Step 11: Commit**

```bash
git add src/lib/engine.js scripts/test-highlat.mjs
git commit -m "High-lat: banded methodology (angle <=55, 1/7 to 60, borrow lat-60 above) — drop AqrabBalad"
```

---

### Task 2: Remove the far-north settings toggle

**Files:**
- Modify: `src/lib/data.js`
- Modify: `src/components/components.jsx`
- Modify: `src/components/Calculator.jsx`

- [ ] **Step 1: Remove the `HIGHLAT` export from `data.js`**

In `src/lib/data.js`, delete the `HIGHLAT` const (current lines ~197–205, the comment
block plus the array). Then remove `HIGHLAT` from the `return { ... }` object (line ~207)
and from the `export const { ... }` destructuring (line ~210).

- [ ] **Step 2: Remove the settings field + import in `components.jsx`**

In `src/components/components.jsx`, change the data import (line 5) from:

```js
import { METHODS, GUIDANCE, COLOR, HIGHLAT } from '../lib/data.js';
```

to:

```js
import { METHODS, GUIDANCE, COLOR } from '../lib/data.js';
```

Then change `SettingsSheet`'s signature (line ~64) from
`function SettingsSheet({ open, onClose, method, madhab, highLat, onChange }) {` to:

```js
function SettingsSheet({ open, onClose, method, madhab, onChange }) {
```

and delete the entire "Far-north prayers" `set-field` block (current lines ~99–106):

```js
          <div className="set-field">
            <label htmlFor="set-highlat">Far-north prayers</label>
            <p className="set-desc">{(HIGHLAT.find(h => h.key === highLat) || HIGHLAT[0]).blurb} Only affects routes that reach latitudes with no true night.</p>
            <select id="set-highlat" className="set-select" value={highLat}
                    onChange={(e) => onChange("highLat", e.target.value)}>
              {HIGHLAT.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
          </div>
```

- [ ] **Step 3: Drop `highLat` from `Calculator.jsx`**

In `src/components/Calculator.jsx`:

Settings default (line ~45):

```js
    const def = { method: "isna", madhab: "shafi" };
```

The memo (lines ~93–97):

```js
  const data = React.useMemo(() => {
    if (!raw || !raw.found) return raw;
    try { return compute(raw, { method: settings.method, madhab: settings.madhab }); }
    catch (e) { console.error("compute failed", e); return raw; }
  }, [raw, settings.method, settings.madhab]);
```

The compute call inside `submit` (line ~169) — change `compute(res, { method: settings.method, madhab: settings.madhab, highLat: settings.highLat })` to:

```js
      let model; try { model = compute(res, { method: settings.method, madhab: settings.madhab }); } catch (e) { model = res; }
```

The `SettingsSheet` mount (line ~212–213) — remove the `highLat` prop:

```js
        <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)}
                       method={settings.method} madhab={settings.madhab} onChange={setSetting} />
```

- [ ] **Step 4: Build to confirm no unresolved imports**

Run: `npm run build`
Expected: PASS — Vite resolves all imports (a stale `HIGHLAT` reference would fail the
build here). `node scripts/test-highlat.mjs` still prints `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data.js src/components/components.jsx src/components/Calculator.jsx
git commit -m "High-lat: remove the far-north toggle (one automatic house methodology)"
```

---

### Task 3: Explain the methodology + honest estimate copy

**Files:**
- Modify: `src/components/components.jsx` (`MethodSheet`)
- Modify: `src/components/cards.jsx` (`EstimateNote`)

- [ ] **Step 1: Add a "Far-north flights" point to `MethodSheet`**

In `src/components/components.jsx`, in `MethodSheet`'s `points` array, insert this object
immediately after the "Trusted prayer-time methods" entry (the one with `t: "Trusted
prayer-time methods"`):

```js
    { ic: Ic.sunrise, t: "Far-north flights",
      d: "Near the poles the summer sky never truly darkens, so the usual dawn and dusk angles have no moment to mark. Across most of the world — Istanbul, New York — your method's normal angle works all year. Only farther north does it run out: there we round down to 60°N — roughly the latitude of Stockholm, St Petersburg, Helsinki and Anchorage, about as far north as big cities go — and mark those prayers as estimates." },
```

- [ ] **Step 2: Unify the `EstimateNote` message**

The inline card note must not contradict the grouped "round to 60°N" story in *How Isfar
works*, so collapse the two basis-specific messages into one far-north message. In
`src/components/cards.jsx`, replace the `anySub` line and the `text` ternary (current lines
~64–67):

```js
  const anySub = est.some(p => p.estimateBasis === "substituted");
  const text = anySub
    ? "The sun never sets on part of this route, so there's no night to divide — these times are estimated from the nearest latitude that has one. Scholars differ; follow the guidance you trust."
    : "No true night over the far north on this route, so these prayers have no exact time — estimated by portioning the night. Scholars differ; follow the guidance you trust.";
```

with a single string (drop `anySub` entirely; `est` is still used by the early return):

```js
  const text = "The far-north summer night is too short — or absent — for the usual twilight angles, so these times are estimated from a settled night at 60°N. Scholars differ; follow the guidance you trust.";
```

- [ ] **Step 3: Build to confirm it compiles**

Run: `npm run build`
Expected: PASS. `node scripts/test-highlat.mjs` still prints `N passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add src/components/components.jsx src/components/cards.jsx
git commit -m "High-lat: explain the banded methodology + honest estimate copy"
```

---

### Task 4: Full verification on the preview

**Files:** none (verification only).

- [ ] **Step 1: Build and start a clean preview**

Run: `npm run build && npm run preview` (note the local URL; start it as a background
task so the session isn't blocked).
Expected: build PASS, preview serving.

- [ ] **Step 2: DY394 (Oslo → Tromsø, midnight sun) renders the folded layout**

Drive the preview with Playwright: click the `DY394` sample chip. Verify:
- the arc renders with the `✈ IN FLIGHT` band,
- the slim midnight-sun banner reads "The sun won't set at Tromsø …",
- the after-arrival cards are dashed-border estimates with `~` prefixes, in
  chronological order (Maghrib → Isha → Fajr),
- the per-section estimate note shows the **"…use the prayer times at 60°N…"** copy,
- the browser console has zero errors.

- [ ] **Step 3: A normal route (SV124) is unchanged**

Click the `SV124` chip. Verify no `estimate` pills, no banner, no estimate note — every
prayer is a real time. Console clean.

- [ ] **Step 4: The settings sheet no longer offers a far-north control**

Open Settings (gear icon). Verify only **Calculation method** and **Asr time (madhhab)**
remain — no "Far-north prayers" select. Open "How Isfar works" (info icon) and confirm the
new **"Far-north flights"** point is present.

- [ ] **Step 5: Final harness + commit (if any verification fixups were needed)**

Run: `node scripts/test-highlat.mjs`
Expected: `N passed, 0 failed`.
If steps 2–4 required code fixups, commit them; otherwise this task adds no commit.

---

## Self-Review

**Spec coverage:**
- ≤55° chosen angle → emergent from `SeventhOfTheNight` no-op (Task 1 Step 5) + the
  `estimateBasisFor` `real` branch (unchanged). ✓
- 55–60° seventh-of-night → `SeventhOfTheNight` everywhere + `portioned` label (Task 1
  Steps 4–5). ✓
- >60° borrow latitude 60, Dhuhr/Asr local, Maghrib/sunrise local when sun sets → Task 1
  Step 6 `instantsAt`. ✓
- Honest labels by astronomy → `estimateBasisFor` one-line split (Step 4). ✓
- Banner only for true no-cycle → Task 1 Step 8 `destNoCycle`. ✓
- Remove toggle → Task 2. ✓
- Explain methodology → Task 3. ✓
- Golden rule (adhan computes all times) → borrow calls `adhan.PrayerTimes` at
  `Coordinates(60, lon)`; no hand-rolled times. ✓

**Placeholder scan:** none — every code step shows the literal replacement.

**Type/name consistency:** `rawInstants`/`instantsAt`/`sunriseAt` all return objects/Dates
matching existing callers (`inst[k]`, `ORDER.forEach`, `sunriseAt(...).getTime()`).
`HIGHLAT_FLOOR` used in `estimateBasisFor` and `instantsAt`. `_arrDecl` defined once and
reused in `destNoCycle` and `kind`. `instantsAt` added to `_test` before the harness uses
it. `makeParams` two-arg signature matched at all call sites (engine `compute`, harness).
