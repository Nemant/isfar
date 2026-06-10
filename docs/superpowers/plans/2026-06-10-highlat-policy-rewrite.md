# High-Latitude Policy Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the predictive high-latitude classifier in `engine.js` with an observation-driven 3-rule policy (real angle → 1/7 local night → 60° floor with whole-night-cluster borrow), unify the before/in-flight/after assembly so prayers can never silently vanish, surface estimates honestly in the UI, and lock everything down with a vitest suite including a regression test per confirmed audit bug.

**Architecture:** One new function `daySchedule(lat, lon, refMs, params, method)` becomes the only code that talks to adhan; it returns all six instants (`fajr sunrise dhuhr asr maghrib isha`) as `{ms, source, estimated}` — guaranteed non-null. `compute()` builds Before (last 2 ≤ dep over dep-day−1 ∪ dep-day), After (first 2 > arr over arr-day ∪ arr-day+1), and a cliff-aware in-flight walk; a final same-key-within-6h pass replaces the cross-list dedup keys. `estimateBasisFor`/`instantsAt` and the destination-only no-cycle branch are deleted. `model.midnightSun` becomes `model.skyNotes` (array; origin included).

**Tech Stack:** adhan-js 4.4.3 (pinned), vitest (new devDependency), Astro/Vite build, Playwright MCP for preview verification.

**Spec:** `docs/superpowers/specs/2026-06-10-highlat-policy-rewrite-design.md` — read it first; all policy decisions (whole-cluster borrow, moonsighting trusted, flagged polar Dhuhr, push-when-green) were user-approved there.

---

## Facts the implementer must know (verified during the audit)

- adhan `PrayerTimes` exposes `fajr, sunrise, dhuhr, asr, maghrib, isha` **and `sunset`** as `Date`s. Invalid values are **Invalid Date objects** (truthy, `isNaN(d.getTime())`), never null.
- `dhuhr` (solar transit) is valid at every latitude/date. `sunrise`/`sunset` go Invalid under midnight sun / polar night **as adhan sees them** (refracted disk, −0.833°), which is ~0.83° of latitude before the geometric test says so — that band is where today's prayers vanish.
- With `HighLatitudeRule.MiddleOfTheNight`, an unreachable fajr/isha angle is **substituted** with `sunrise − night/2` / `sunset + night/2` (night = today's sunset → tomorrow's sunrise), then method/user adjustments are added and the result is rounded to the minute. A valid angle time is essentially never clamped by this rule. `SeventhOfTheNight` is the same with `night/7` — but as a *base* rule it clamps real angle times, so it is only ever used in fallback clones.
- `MoonsightingCommittee` at |lat| ≥ 55 ignores `highLatitudeRule` entirely (internal night/7 + seasonal tables). Interval isha (`params.ishaInterval > 0`: ummalqura, qatar) bypasses the rule too.
- adhan's Asr can be a **degenerate valid Date** (e.g. 02:32 at night) when |lat − decl| ≈ 90; guard by range, not validity.
- At |lat| ≤ 40 every exposed method's fajr/isha angle is always reachable: min depth at 40° is 90 − (40 + 23.44) = 26.56°, max method angle 18.5° (ummalqura fajr) — 8° margin. Safe shortcut.
- Min night at |lat| = 60 is ≈ 5 h, so a night < 60 min only occurs above 60° and implies the angle is unreachable (sun barely dips) — safe guard.
- Repo conventions: ES modules, no test suite today, `npm run build && npm run preview` is the oracle, commits go straight to `main` (no branches). Pushing `main` auto-deploys isfar.app — push only at the final task.

---

### Task 1: vitest tooling

**Files:**
- Modify: `/workspaces/isfar/package.json`
- Create: `/workspaces/isfar/tests/smoke.test.js`

- [ ] **Step 1: Install vitest and add the test script**

```bash
cd /workspaces/isfar && npm install --save-dev vitest
```

Then in `package.json` add to `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 2: Write a smoke test that imports the engine**

```js
// tests/smoke.test.js
import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';

describe('smoke', () => {
  it('computes the SV124 sample', () => {
    const m = compute(lookup('SV124'), { method: 'mwl', madhab: 'shafi' });
    expect(m.prayers.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run and verify it passes**

Run: `npm test` — Expected: 1 passed. (This validates engine.js + adhan load under node before any rewrite.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tests/smoke.test.js
git commit -m "Test tooling: vitest + engine smoke test"
```

### Task 2: ground-truth helper for tests

**Files:**
- Create: `/workspaces/isfar/tests/helpers.js`

The tests need an *independent* oracle for "is the angle reachable", taken from adhan's own internals (deep import — fine in tests, never in src).

- [ ] **Step 1: Write the helper**

```js
// tests/helpers.js — test-only oracles and fixtures
import * as adhan from 'adhan';
import SolarTime from '../node_modules/adhan/lib/esm/SolarTime.js';

// Ground truth: does the sun reach `angle` degrees below the horizon on this
// mean-solar date at (lat, lon)? Uses adhan's own SolarTime.hourAngle (NaN ⇒ no).
export function angleReachable(lat, lon, dateUTC, angle) {
  const d = { year: dateUTC.getUTCFullYear(), month: dateUTC.getUTCMonth() + 1, day: dateUTC.getUTCDate() };
  const st = new SolarTime(d, new adhan.Coordinates(lat, lon));
  return !Number.isNaN(st.hourAngle(-angle, false));
}

// Raw adhan PrayerTimes for the same solar-day convention engine.js uses.
export function rawPT(lat, lon, refMs, params) {
  const l = new Date(refMs + (lon / 15) * 3600000);
  const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 12));
  return new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
}

export const validMs = (v) => (v && !isNaN(v.getTime())) ? v.getTime() : null;

// Synthetic flight record factory (shape of data.js records)
export function flight({ code = 'TT1', fromLat, fromLon, fromTz, toLat, toLon, toTz, depUTC, arrUTC,
                         fromIata = 'AAA', toIata = 'BBB' }) {
  return {
    found: true, airline: 'Test', code, aircraft: 'T', dateISO: depUTC.slice(0, 10), date: depUTC,
    from: { iata: fromIata, city: fromIata, airport: fromIata, lat: fromLat, lon: fromLon, tz: fromTz, zone: 'X', gmt: 'GMT' },
    to:   { iata: toIata,   city: toIata,   airport: toIata,   lat: toLat,   lon: toLon,   tz: toTz,   zone: 'X', gmt: 'GMT' },
    depUTC, arrUTC
  };
}
```

- [ ] **Step 2: Verify the deep import works**

Add temporarily to `tests/smoke.test.js` (keep it — it pins the oracle):

```js
import { angleReachable } from './helpers.js';

it('ground-truth oracle works', () => {
  // London June 6: 18° not reached; equinox: reached
  expect(angleReachable(51.47, -0.45, new Date('2026-06-06T12:00:00Z'), 18)).toBe(false);
  expect(angleReachable(51.47, -0.45, new Date('2026-03-20T12:00:00Z'), 18)).toBe(true);
});
```

Run: `npm test` — Expected: pass. If the SolarTime constructor signature differs (Babel default-export shape), check `node_modules/adhan/lib/esm/SolarTime.js` and adapt the import (`SolarTime.default ?? SolarTime`).

- [ ] **Step 3: Commit**

```bash
git add tests/helpers.js tests/smoke.test.js
git commit -m "Tests: adhan ground-truth oracle (deep import, test-only) + flight factory"
```

### Task 3: `daySchedule` — the policy core (TDD)

**Files:**
- Modify: `/workspaces/isfar/src/lib/engine.js` (add new code alongside old; old `compute` still exported and untouched until Task 4)
- Create: `/workspaces/isfar/tests/engine-policy.test.js`

- [ ] **Step 1: Write the failing policy tests**

```js
// tests/engine-policy.test.js
import { describe, it, expect } from 'vitest';
import { ISFAR_TEST } from '../src/lib/engine.js';
import { angleReachable, rawPT, validMs } from './helpers.js';

const { daySchedule, makeParams } = ISFAR_TEST;
const T = (iso) => Date.parse(iso);
const KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

function sched(lat, lon, iso, method = 'mwl', madhab = 'shafi') {
  return daySchedule(lat, lon, T(iso), makeParams(method, madhab), method);
}

describe('rule 1 — real angle at the true position', () => {
  it('mid-latitude equinox: everything real, times = adhan', () => {
    const s = sched(51.47, -0.45, '2026-03-20T12:00:00Z');
    const pt = rawPT(51.47, -0.45, T('2026-03-20T12:00:00Z'), makeParams('mwl', 'shafi'));
    for (const k of KEYS) {
      expect(s[k].estimated).toBe(false);
      expect(s[k].ms).toBe(validMs(pt[k]));
    }
  });
  it('62°N in December (guide worked example): isha is real', () => {
    const s = sched(62.0, 6.0, '2026-12-21T12:00:00Z');
    expect(s.isha.source).toBe('angle');
    expect(s.isha.estimated).toBe(false);
  });
});

describe('rule 2 — 1/7 of the local night (≤60°, angle unreachable)', () => {
  it('London June: fajr+isha portioned, flagged, sun events real', () => {
    const s = sched(51.47, -0.45, '2026-06-06T12:00:00Z');
    expect(s.fajr.source).toBe('seventh');
    expect(s.isha.source).toBe('seventh');
    expect(s.fajr.estimated).toBe(true);
    expect(s.maghrib.source).toBe('method');
    expect(s.maghrib.estimated).toBe(false);
  });
});

describe('rule 3 — 60° floor borrows the whole night cluster (>60°)', () => {
  it('64°N June: fajr/isha/maghrib/sunrise from 60°, dhuhr/asr local real', () => {
    const s = sched(64.0, 18.0, '2026-06-21T12:00:00Z');
    for (const k of ['fajr', 'isha', 'maghrib', 'sunrise']) {
      expect(s[k].source).toBe('borrow60');
      expect(s[k].estimated).toBe(true);
    }
    expect(s.dhuhr.estimated).toBe(false);
    expect(s.asr.estimated).toBe(false);
    // coherent order — the audit's Isha-before-Maghrib inversion is dead
    expect(s.isha.ms).toBeGreaterThan(s.maghrib.ms);
    expect(s.fajr.ms).toBeLessThan(s.sunrise.ms);
  });
  it('cluster times equal the 60° seventh-rule schedule at the same longitude', () => {
    const s = sched(64.0, 18.0, '2026-06-21T12:00:00Z');
    const s60 = sched(60.0, 18.0, '2026-06-21T12:00:00Z');
    expect(s.maghrib.ms).toBe(s60.maghrib.ms);
    expect(s.isha.ms).toBe(s60.isha.ms);
  });
});

describe('no-cycle override (observed from adhan, not geometry)', () => {
  it('Tromsø midnight sun: cluster borrowed, dhuhr+asr real local', () => {
    const s = sched(69.65, 18.92, '2026-06-06T12:00:00Z');
    expect(s.kind).toBe('midnightsun');
    expect(s.maghrib.source).toBe('borrow60');
    expect(s.dhuhr.estimated).toBe(false);
    expect(s.asr.estimated).toBe(false);
  });
  it('Tromsø polar night: dhuhr keeps local transit but is flagged; asr borrowed', () => {
    const s = sched(69.65, 18.92, '2026-12-21T12:00:00Z');
    expect(s.kind).toBe('polarnight');
    expect(s.dhuhr.source).toBe('method');
    expect(s.dhuhr.estimated).toBe(true);
    expect(s.asr.source).toBe('borrow60');
  });
  it('refraction fringe (Rovaniemi June): adhan has no sunset → borrowed, NOT dropped', () => {
    const s = sched(66.56, 25.83, '2026-06-21T12:00:00Z');
    expect(s.maghrib.ms).not.toBeNull();          // the audit's silently-vanished Maghrib
    expect(s.maghrib.estimated).toBe(true);
  });
});

describe('method specials', () => {
  it('moonsighting ≥55° trusted: adhan output verbatim, unflagged', () => {
    const ref = T('2026-01-15T12:00:00Z');
    const s = sched(55.68, 12.57, '2026-01-15T12:00:00Z', 'moonsighting');
    const pt = rawPT(55.68, 12.57, ref, makeParams('moonsighting', 'shafi'));
    expect(s.fajr.ms).toBe(validMs(pt.fajr));
    expect(s.fajr.estimated).toBe(false);
    expect(s.fajr.source).toBe('method');
  });
  it('ummalqura interval isha: real with a cycle; joins the cluster above the floor', () => {
    const low = sched(58.0, 18.0, '2026-06-21T12:00:00Z', 'ummalqura');
    expect(low.isha.source).toBe('method');                  // sunset + 90, real
    expect(low.isha.ms - low.maghrib.ms).toBe(90 * 60000);
    const high = sched(64.0, 18.0, '2026-06-21T12:00:00Z', 'ummalqura');
    expect(high.isha.source).toBe('borrow60');               // whole cluster
    expect(high.isha.ms - high.maghrib.ms).toBe(90 * 60000); // 90 min after the borrowed sunset
  });
});

describe('hemisphere mirror', () => {
  it('−70° in southern summer behaves like +70° in northern summer', () => {
    const south = sched(-70.0, 0.0, '2026-12-21T12:00:00Z');
    expect(south.kind).toBe('midnightsun');
    expect(south.maghrib.source).toBe('borrow60');
    const south60 = sched(-60.0, 0.0, '2026-12-21T12:00:00Z');
    expect(south.maghrib.ms).toBe(south60.maghrib.ms); // borrows −60, not +60
  });
});

describe('detection agrees with adhan ground truth across a grid', () => {
  it('fajr/isha source is "angle" iff the angle is reachable (±1 boundary day tolerated)', () => {
    const params = makeParams('mwl', 'shafi');
    let disagreements = 0, cells = 0;
    for (let lat = 42; lat <= 60; lat += 1.5) {
      for (let m = 0; m < 12; m++) {
        const iso = `2026-${String(m + 1).padStart(2, '0')}-15T12:00:00Z`;
        const s = daySchedule(lat, 10, T(iso), params, 'mwl');
        for (const [k, angle] of [['fajr', 18], ['isha', 17]]) {
          cells++;
          const truth = angleReachable(lat, 10, new Date(iso), angle);
          const claimed = s[k].source === 'angle';
          if (truth !== claimed) disagreements++;
        }
      }
    }
    // mid-month samples sit days away from the seasonal boundary; demand near-perfect agreement
    expect(disagreements / cells).toBeLessThan(0.02);
  });
});

describe('the non-null guarantee', () => {
  it('all six instants exist at every latitude, season, method', () => {
    for (const method of ['mwl', 'isna', 'moonsighting', 'ummalqura', 'tehran']) {
      const params = makeParams(method, 'shafi');
      for (let lat = -88; lat <= 88; lat += 8) {
        for (const iso of ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21']) {
          const s = daySchedule(lat, 18, T(iso + 'T12:00:00Z'), params, method);
          for (const k of KEYS) {
            expect(s[k].ms, `${method} lat=${lat} ${iso} ${k}`).toBeTypeOf('number');
          }
        }
      }
    }
  });
  it('within-day ordering holds everywhere', () => {
    const params = makeParams('mwl', 'shafi');
    for (let lat = -88; lat <= 88; lat += 4) {
      for (const iso of ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21']) {
        const s = daySchedule(lat, 18, T(iso + 'T12:00:00Z'), params, 'mwl');
        const msg = `lat=${lat} ${iso}`;
        expect(s.fajr.ms, msg).toBeLessThan(s.sunrise.ms);
        expect(s.sunrise.ms, msg).toBeLessThanOrEqual(s.dhuhr.ms);
        expect(s.dhuhr.ms, msg).toBeLessThan(s.asr.ms);
        expect(s.asr.ms, msg).toBeLessThan(s.maghrib.ms);
        expect(s.maghrib.ms, msg).toBeLessThan(s.isha.ms);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` — Expected: FAIL with `daySchedule is not a function` (ISFAR_TEST doesn't export it yet).

- [ ] **Step 3: Implement `daySchedule` in engine.js**

Add inside the `ISFAR_ENGINE` IIFE (keep `makeParams`, `seventhParams`, `solarDeclination`, `greatCircle`, `initialBearing`, `altDipMinutes`, formatters as they are). New code:

```js
  const DAY = 86400000, MIN = 60000;
  const SIX_KEYS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  const msOf = (v) => (v && !isNaN(v.getTime())) ? v.getTime() : null;

  /* adhan PrayerTimes for the mean-solar calendar day implied by lon around refMs */
  function ptFor(lat, lon, refMs, params, dayOffset) {
    const l = new Date(refMs + (lon / 15) * 3600000);
    const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(),
                                l.getUTCDate() + (dayOffset || 0), 12));
    return new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
  }

  /* full seventh-rule day at the floor latitude (same longitude) — every value
     defined: at ±60° the sun rises and sets all year, and SeventhOfTheNight
     substitutes any unreachable angle. */
  function borrow60(lat, lon, refMs, params) {
    const pt = ptFor(Math.sign(lat) * HIGHLAT_FLOOR, lon, refMs, seventhParams(params));
    const out = {};
    SIX_KEYS.forEach(k => { out[k] = msOf(pt[k]); });
    return out;
  }

  /* Did adhan substitute this fajr/isha with its middle-of-the-night safe time?
     OBSERVED, not predicted: we replicate adhan's own arithmetic from its outputs
     (night = today's sunset → tomorrow's sunrise; + the method/user minute
     adjustments adhan adds before rounding) and compare within rounding slack. */
  function wasSubstituted(key, outMs, sunriseMs, sunsetMs, nextSunriseMs, params) {
    if (outMs == null) return true;                       // invalid ⇒ certainly no angle
    if (sunriseMs == null || sunsetMs == null || nextSunriseMs == null) return true;
    const night = nextSunriseMs - sunsetMs;
    if (night < 60 * MIN) return true;                    // <1 h night ⇒ no method angle is reachable
    const adj = (((params.adjustments || {})[key] || 0) +
                 ((params.methodAdjustments || {})[key] || 0)) * MIN;
    const safe = key === "fajr" ? sunriseMs - night / 2 : sunsetMs + night / 2;
    return Math.abs(outMs - (safe + adj)) <= 2 * MIN;
  }

  /* ==========================================================================
     daySchedule — THE policy. One mean-solar day at (lat, lon); the only code
     that asks adhan for times. Returns {fajr,sunrise,dhuhr,asr,maghrib,isha}
     each {ms, source, estimated} — ms is ALWAYS a number — plus kind:
     "normal" | "midnightsun" | "polarnight".

     1. REAL ANGLE   — the method's own time wherever the sky reaches it.
     2. SEVENTH      — angle unreachable, |lat| ≤ 60: 1/7 of the LOCAL night.
     3. BORROW60     — angle unreachable, |lat| > 60 (or no day/night cycle at
                       all): the whole night cluster — maghrib, isha, fajr,
                       sunrise — read from the 60° sky at this longitude, so the
                       evening always stays in canonical order. Dhuhr and Asr
                       stay local (Dhuhr flagged in polar night; Asr borrowed
                       when the local sun gives it no sane afternoon).
     Moonsighting Committee is trusted verbatim whenever a cycle exists (the
     method ships its own ≥55° rule). Interval isha (ummalqura/qatar) is real
     with a cycle and joins the cluster without one.
     ========================================================================== */
  function daySchedule(lat, lon, refMs, params, method) {
    const pt = ptFor(lat, lon, refMs, params);
    const real = (ms) => ({ ms, source: "method", estimated: false });
    const out = { dhuhr: real(msOf(pt.dhuhr)) };          // transit: valid at every lat/date

    const sunriseMs = msOf(pt.sunrise), sunsetMs = msOf(pt.sunset);

    if (sunriseMs == null || sunsetMs == null) {
      // ---- no day/night cycle here, as adhan observes it (midnight sun /
      // polar night, including the refraction fringe geometry misses) --------
      const decl = solarDeclination(refMs);
      const polarNight = Math.abs(lat - decl) > Math.abs(lat + decl);
      const b = borrow60(lat, lon, refMs, params);
      const est = (k) => ({ ms: b[k], source: "borrow60", estimated: true });
      out.fajr = est("fajr"); out.sunrise = est("sunrise");
      out.maghrib = est("maghrib"); out.isha = est("isha");
      out.dhuhr.estimated = polarNight;                   // local noon kept, flagged for honesty
      const asrMs = msOf(pt.asr);
      const asrSane = asrMs != null && asrMs > out.dhuhr.ms && asrMs < out.dhuhr.ms + 11 * 3600000;
      out.asr = (!polarNight && asrSane) ? real(asrMs) : est("asr");
      out.kind = polarNight ? "polarnight" : "midnightsun";
      return out;
    }

    // ---- a real day and night exist: sun-disk events + asr are local --------
    out.kind = "normal";
    out.sunrise = real(sunriseMs);
    out.maghrib = real(msOf(pt.maghrib));
    const asrMs = msOf(pt.asr);                           // degenerate near |lat−decl|≈90: range-guard
    out.asr = (asrMs != null && asrMs > out.dhuhr.ms && asrMs < sunsetMs)
      ? real(asrMs)
      : { ms: borrow60(lat, lon, refMs, params).asr, source: "borrow60", estimated: true };

    if (method === "moonsighting") {                      // the method's own high-lat rule: trust it
      out.fajr = real(msOf(pt.fajr));
      out.isha = real(msOf(pt.isha));
      return out;
    }

    // fajr/isha ladder. Shortcut: at |lat| ≤ 40 every exposed angle is always
    // reachable (min depth 26.6° vs max angle 18.5°) — skip the detection calls.
    if (Math.abs(lat) <= 40) {
      out.fajr = { ms: msOf(pt.fajr), source: "angle", estimated: false };
      out.isha = params.ishaInterval > 0 ? real(msOf(pt.isha))
                                         : { ms: msOf(pt.isha), source: "angle", estimated: false };
      return out;
    }

    const nextSunriseMs = msOf(ptFor(lat, lon, refMs, params, 1).sunrise);
    let pt7 = null, floor = false;
    for (const k of ["fajr", "isha"]) {
      if (k === "isha" && params.ishaInterval > 0) { out.isha = real(msOf(pt.isha)); continue; }
      if (!wasSubstituted(k, msOf(pt[k]), sunriseMs, sunsetMs, nextSunriseMs, params)) {
        out[k] = { ms: msOf(pt[k]), source: "angle", estimated: false };
        continue;
      }
      if (Math.abs(lat) > HIGHLAT_FLOOR) { floor = true; continue; }  // resolved below as a cluster
      pt7 = pt7 || ptFor(lat, lon, refMs, seventhParams(params));
      out[k] = { ms: msOf(pt7[k]), source: "seventh", estimated: true };
    }
    if (floor) {
      // rule 3: the whole night cluster from the 60° sky — order-coherent by construction
      const b = borrow60(lat, lon, refMs, params);
      for (const k of ["fajr", "sunrise", "maghrib", "isha"]) {
        out[k] = { ms: b[k], source: "borrow60", estimated: true };
      }
    }
    return out;
  }
```

And extend the test export at the bottom of the IIFE:

```js
  return { compute, greatCircle, _test: { makeParams, solarDeclination, daySchedule } };
```

(Old `estimateBasisFor`/`instantsAt` stay exported from `_test` until Task 4 deletes them — remove them from `_test` now if nothing fails, since tests no longer reference them.)

- [ ] **Step 4: Run the policy tests**

Run: `npm test` — Expected: `engine-policy.test.js` all pass; smoke still passes.
If the grid-agreement test fails: print the disagreeing cells; widen `wasSubstituted` tolerance only if every disagreement is within ±1 day of the seasonal boundary (check by re-running `angleReachable` on adjacent dates); otherwise the replication arithmetic is wrong — fix it, don't widen.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine.js tests/engine-policy.test.js
git commit -m "Engine: daySchedule — observation-driven 3-rule high-latitude policy core"
```

### Task 4: `compute()` rewrite (TDD)

**Files:**
- Modify: `/workspaces/isfar/src/lib/engine.js` (rewrite `compute`; DELETE `estimateBasisFor`, `instantsAt`, `rawInstants`, `sunriseAt`, the old no-cycle destination branch)
- Create: `/workspaces/isfar/tests/engine-regressions.test.js`
- Create: `/workspaces/isfar/tests/engine-invariants.test.js`

- [ ] **Step 1: Write the failing regression tests (one per confirmed audit bug)**

```js
// tests/engine-regressions.test.js — each test names the audit bug it kills
import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { flight } from './helpers.js';

const C = (f, method = 'mwl') => compute(f, { method, madhab: 'shafi' });
const keys = (m, status) => m.prayers.filter(p => p.status === status).map(p => p.key);

it('refraction fringe: HEL→RVN mid-June keeps Maghrib (was silently dropped)', () => {
  const m = C(flight({ fromLat: 60.32, fromLon: 24.96, fromTz: 'Europe/Helsinki', fromIata: 'HEL',
                       toLat: 66.56, toLon: 25.83, toTz: 'Europe/Helsinki', toIata: 'RVN',
                       depUTC: '2026-06-15T08:00:00Z', arrUTC: '2026-06-15T09:20:00Z' }));
  const all = m.prayers.map(p => p.key);
  expect(all).toContain('maghrib');
  const maghrib = m.prayers.find(p => p.key === 'maghrib');
  expect(maghrib.estimated).toBe(true);
});

it('late-evening arrival: SV124 (arr 23:05) shows 2 after-arrival prayers incl. next-day Fajr', () => {
  const m = C(lookup('SV124'));
  const after = m.prayers.filter(p => p.status === 'after');
  expect(after.length).toBe(2);
  expect(after.map(p => p.key)).toContain('fajr');
});

it('northbound evening cliff: FRA→CPH keeps Isha somewhere in the journey', () => {
  const m = C(flight({ fromLat: 50.03, fromLon: 8.56, fromTz: 'Europe/Berlin', fromIata: 'FRA',
                       toLat: 55.62, toLon: 12.65, toTz: 'Europe/Copenhagen', toIata: 'CPH',
                       depUTC: '2026-06-06T21:30:00Z', arrUTC: '2026-06-06T22:50:00Z' }));
  expect(m.prayers.map(p => p.key)).toContain('isha');
});

it('pre-dawn southbound cliff: LHR→MAD red-eye keeps Fajr', () => {
  const m = C(flight({ fromLat: 51.47, fromLon: -0.45, fromTz: 'Europe/London', fromIata: 'LHR',
                       toLat: 40.47, toLon: -3.57, toTz: 'Europe/Madrid', toIata: 'MAD',
                       depUTC: '2026-06-06T01:00:00Z', arrUTC: '2026-06-06T03:25:00Z' }));
  expect(m.prayers.map(p => p.key)).toContain('fajr');
});

it('polar winter: no middle-of-night Asr capture; destination Asr survives (TRD→TOS)', () => {
  const m = C(flight({ fromLat: 63.46, fromLon: 10.92, fromTz: 'Europe/Oslo', fromIata: 'TRD',
                       toLat: 69.68, toLon: 18.92, toTz: 'Europe/Oslo', toIata: 'TOS',
                       depUTC: '2026-12-26T08:00:00Z', arrUTC: '2026-12-26T09:55:00Z' }));
  const asrs = m.prayers.filter(p => p.key === 'asr');
  expect(asrs.length).toBeGreaterThan(0);
  for (const a of asrs) {  // every shown Asr sits in a sane afternoon window vs its own dhuhr-day
    const sameDayDhuhr = m.prayers.find(p => p.key === 'dhuhr');
    if (sameDayDhuhr) expect(Math.abs(a.ms - sameDayDhuhr.ms)).toBeLessThan(8 * 3600000);
  }
});

it('red-eye departure: JED 01:00 local still shows before-departure prayers', () => {
  const m = C(flight({ fromLat: 21.68, fromLon: 39.16, fromTz: 'Asia/Riyadh', fromIata: 'JED',
                       toLat: 51.47, toLon: -0.45, toTz: 'Europe/London', toIata: 'LHR',
                       depUTC: '2026-06-06T22:00:00Z', arrUTC: '2026-06-07T05:00:00Z' }));
  expect(m.prayers.filter(p => p.status === 'before').length).toBe(2);
});

it('origin no-cycle gets a skyNote banner (TOS→OSL June)', () => {
  const m = C(flight({ fromLat: 69.68, fromLon: 18.92, fromTz: 'Europe/Oslo', fromIata: 'TOS',
                       toLat: 60.19, toLon: 11.10, toTz: 'Europe/Oslo', toIata: 'OSL',
                       depUTC: '2026-06-06T10:00:00Z', arrUTC: '2026-06-06T11:55:00Z' }));
  expect(m.skyNotes.length).toBe(1);
  expect(m.skyNotes[0].place).toBe('origin');
  expect(m.skyNotes[0].kind).toBe('midnightsun');
});

it('destination no-cycle skyNote + flag consistency (DY394)', () => {
  const m = C(lookup('DY394'));
  expect(m.skyNotes.length).toBe(1);
  expect(m.skyNotes[0].place).toBe('destination');
  expect(m.skyNotes[0].kind).toBe('midnightsun');
  expect(m.prayers.map(p => p.key)).toContain('dhuhr' /* never silently missing */);
  // no horizon dip on a borrowed maghrib: shown ms must equal a whole adhan minute
  const maghrib = m.prayers.find(p => p.key === 'maghrib' && p.status === 'inflight');
  if (maghrib && maghrib.estimated) expect(maghrib.ms % 60000).toBe(0);
});

it('61–66.5°N June ordering: never Isha before Maghrib (OSL→TRD)', () => {
  const m = C(flight({ fromLat: 60.19, fromLon: 11.10, fromTz: 'Europe/Oslo', fromIata: 'OSL',
                       toLat: 63.46, toLon: 10.92, toTz: 'Europe/Oslo', toIata: 'TRD',
                       depUTC: '2026-06-21T14:00:00Z', arrUTC: '2026-06-21T15:00:00Z' }));
  const isha = m.prayers.find(p => p.key === 'isha');
  const maghrib = m.prayers.find(p => p.key === 'maghrib');
  if (isha && maghrib) expect(isha.ms).toBeGreaterThan(maghrib.ms);
});

it('boundary-date flag consistency: estimated ⇔ has estimateBasis, basis = source', () => {
  const m = C(flight({ fromLat: 60.19, fromLon: 11.10, fromTz: 'Europe/Oslo', fromIata: 'OSL',
                       toLat: 78.25, toLon: 15.47, toTz: 'Arctic/Longyearbyen', toIata: 'LYR',
                       depUTC: '2026-02-19T19:30:00Z', arrUTC: '2026-02-19T22:30:00Z' }));
  for (const p of m.prayers) {
    expect(!!p.estimateBasis).toBe(p.estimated);
  }
});

it('moonsighting at CPH winter: unflagged (the method\'s own rule)', () => {
  const m = C(flight({ fromLat: 55.68, fromLon: 12.57, fromTz: 'Europe/Copenhagen', fromIata: 'CPH',
                       toLat: 51.47, toLon: -0.45, toTz: 'Europe/London', toIata: 'LHR',
                       depUTC: '2026-01-15T10:00:00Z', arrUTC: '2026-01-15T12:00:00Z' }), 'moonsighting');
  const before = m.prayers.filter(p => p.status === 'before');
  for (const p of before) expect(p.estimated).toBe(false);
});
```

- [ ] **Step 2: Write the failing invariant tests**

```js
// tests/engine-invariants.test.js
import { describe, it, expect } from 'vitest';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';
import { flight } from './helpers.js';

// deterministic PRNG — Date.now()-free, reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AIRPORTS = [
  [51.47, -0.45, 'Europe/London'], [21.68, 39.16, 'Asia/Riyadh'], [40.64, -73.78, 'America/New_York'],
  [69.68, 18.92, 'Europe/Oslo'], [60.19, 11.10, 'Europe/Oslo'], [66.56, 25.83, 'Europe/Helsinki'],
  [-31.94, 115.97, 'Australia/Perth'], [-33.94, 18.60, 'Africa/Johannesburg'], [64.13, -21.94, 'Atlantic/Reykjavik'],
  [25.25, 55.36, 'Asia/Dubai'], [35.55, 139.78, 'Asia/Tokyo'], [78.25, 15.47, 'Arctic/Longyearbyen'],
];
const DATES = ['2026-03-20', '2026-06-21', '2026-09-22', '2026-12-21', '2026-02-19', '2026-08-17'];
const METHODS = ['mwl', 'isna', 'moonsighting', 'ummalqura', 'tehran'];

function randomFlights(n) {
  const rnd = mulberry32(20260610);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = AIRPORTS[Math.floor(rnd() * AIRPORTS.length)];
    let b = AIRPORTS[Math.floor(rnd() * AIRPORTS.length)];
    if (b === a) b = AIRPORTS[(AIRPORTS.indexOf(a) + 1) % AIRPORTS.length];
    const date = DATES[Math.floor(rnd() * DATES.length)];
    const depH = Math.floor(rnd() * 24), durMin = 45 + Math.floor(rnd() * 17 * 60);
    const dep = Date.parse(`${date}T00:00:00Z`) + depH * 3600000;
    out.push({
      f: flight({ fromLat: a[0], fromLon: a[1], fromTz: a[2], toLat: b[0], toLon: b[1], toTz: b[2],
                  depUTC: new Date(dep).toISOString(), arrUTC: new Date(dep + durMin * 60000).toISOString() }),
      method: METHODS[Math.floor(rnd() * METHODS.length)],
    });
  }
  return out;
}

describe('invariants over 120 randomized flights', () => {
  const runs = randomFlights(120).map(({ f, method }) =>
    ({ f, method, m: compute(f, { method, madhab: 'shafi' }) }));

  it('after-arrival always has exactly 2 prayers', () => {
    for (const { m, f, method } of runs) {
      expect(m.prayers.filter(p => p.status === 'after').length,
        `${f.from.iata}->${f.to.iata} ${f.depUTC} ${method}`).toBe(2);
    }
  });
  it('before-departure has exactly 2 prayers', () => {
    for (const { m, f, method } of runs) {
      expect(m.prayers.filter(p => p.status === 'before').length,
        `${f.from.iata}->${f.to.iata} ${f.depUTC} ${method}`).toBe(2);
    }
  });
  it('in-flight prayers sit inside the flight window', () => {
    for (const { m, f } of runs) {
      const dep = Date.parse(f.depUTC), arr = Date.parse(f.arrUTC);
      for (const p of m.prayers.filter(p => p.status === 'inflight')) {
        expect(p.ms).toBeGreaterThanOrEqual(dep);
        expect(p.ms).toBeLessThanOrEqual(arr + 40 * 60000);  // + maghrib dip allowance
      }
    }
  });
  it('no same prayer twice within 6 hours; list sorted by ms', () => {
    for (const { m } of runs) {
      const last = {};
      let prev = -Infinity;
      for (const p of m.prayers) {
        expect(p.ms).toBeGreaterThanOrEqual(prev); prev = p.ms;
        if (last[p.key] !== undefined) expect(p.ms - last[p.key]).toBeGreaterThanOrEqual(6 * 3600000);
        last[p.key] = p.ms;
      }
    }
  });
  it('flags and sources always agree', () => {
    for (const { m } of runs) {
      for (const p of m.prayers) {
        expect(!!p.estimateBasis).toBe(p.estimated);
        if (p.estimated) expect(['seventh', 'borrow60', 'method']).toContain(p.estimateBasis);
      }
    }
  });
  it('goldens still behave: QF10 ≥ 8 prayers & multi-day, EK215 computes, DY394 gap-free', () => {
    const qf = compute(lookup('QF10'), { method: 'mwl', madhab: 'shafi' });
    expect(qf.prayers.length).toBeGreaterThanOrEqual(8);
    expect(qf.multiDay).toBe(true);
    expect(compute(lookup('EK215'), { method: 'mwl', madhab: 'shafi' }).prayers.length).toBeGreaterThan(3);
    const dy = compute(lookup('DY394'), { method: 'isna', madhab: 'shafi' });
    expect(dy.prayers.length).toBeGreaterThanOrEqual(4);
  });
  it('performance: the 120-flight suite implies compute() stays fast; QF10 under 2 s', () => {
    const t0 = performance.now();
    compute(lookup('QF10'), { method: 'mwl', madhab: 'shafi' });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
```

- [ ] **Step 3: Run to verify failures**

Run: `npm test` — Expected: regressions + invariants FAIL (`skyNotes` undefined, after-count 0 on SV124, etc.); policy tests still pass.

- [ ] **Step 4: Rewrite `compute()`**

Replace the whole current `compute` (engine.js:243-414) and delete `estimateBasisFor`, `rawInstants`, `instantsAt`, `sunriseAt`. The walk/list logic:

```js
  function compute(raw, opts) {
    opts = opts || {};
    const method = opts.method || "mwl";
    const params = makeParams(method, opts.madhab || "shafi");
    const dep = Date.parse(raw.depUTC), arr = Date.parse(raw.arrUTC);
    const from = raw.from, to = raw.to;
    const sched = (lat, lon, refMs) => daySchedule(lat, lon, refMs, params, method);

    const entries = [];   // {key, status, ms, lat, lon, source, estimated, sunriseMs, sunriseReal}
    const push = (key, status, e, daySched, lat, lon, ms) => entries.push({
      key, status, ms, lat, lon, source: e.source, estimated: e.estimated,
      sunriseMs: daySched.sunrise.ms, sunriseReal: !daySched.sunrise.estimated
    });

    // 1. BEFORE — last few prayers due at the origin, scanning the previous
    //    solar day too so red-eye departures still get their context prayers.
    const before = [];
    for (const off of [-1, 0]) {
      const s = sched(from.lat, from.lon, dep + off * DAY);
      ORDER.forEach(k => { if (s[k].ms <= dep) before.push({ k, s, e: s[k] }); });
    }
    before.sort((a, b) => a.e.ms - b.e.ms).slice(-BEFORE_CAP)
      .forEach(({ k, s, e }) => push(k, "before", e, s, from.lat, from.lon, e.ms));

    // 2. IN-FLIGHT — walk the great circle minute by minute. Each prayer's
    //    instant is a moving target; a sign flip of (clock − instant) marks the
    //    moment it becomes due aloft. The policy is discontinuous at the
    //    rule-1↔2 boundary, so when the schedule JUMPED past the clock we
    //    record the moment of the jump (when it became due), never a time from
    //    the past — and never silently drop it.
    const STEP = MIN;
    const prevResid = {}, captured = {};
    for (let ms = dep; ms <= arr; ms += STEP) {
      const f = (arr === dep) ? 0 : (ms - dep) / (arr - dep);
      const pos = greatCircle(from.lat, from.lon, to.lat, to.lon, f);
      const s = sched(pos.lat, pos.lon, ms);
      ORDER.forEach(k => {
        const e = s[k];
        const dk = k + "@" + dayKeyOf(e.ms, pos.lon);
        const resid = ms - e.ms;
        const prev = prevResid[dk];
        if (prev !== undefined && prev < 0 && resid >= 0 && !captured[dk]) {
          captured[dk] = true;
          const T = Math.min(arr, Math.max(dep, resid <= STEP ? e.ms : ms));
          push(k, "inflight", e, s, pos.lat, pos.lon, T);
        }
        prevResid[dk] = resid;
      });
    }

    // 3. AFTER — the next prayers on the ground at the destination, rolling
    //    into the following day so a late-night arrival still sees tomorrow's
    //    Fajr. Same path for normal and polar destinations.
    const after = [];
    for (const off of [0, 1]) {
      const s = sched(to.lat, to.lon, arr + off * DAY);
      ORDER.forEach(k => { if (s[k].ms > arr) after.push({ k, s, e: s[k] }); });
    }
    after.sort((a, b) => a.e.ms - b.e.ms).slice(0, AFTER_CAP)
      .forEach(({ k, s, e }) => push(k, "after", e, s, to.lat, to.lon, e.ms));

    // 4. MERGE — sort, then drop any same-prayer repeat within 6 h (the same
    //    prayer cannot recur that fast; genuine repeats on long eastbound
    //    flights are ~17 h+ apart). Replaces the old cross-list dedup keys.
    entries.sort((a, b) => a.ms - b.ms);
    const lastAt = {};
    const merged = entries.filter(e => {
      if (lastAt[e.key] !== undefined && e.ms - lastAt[e.key] < 6 * 3600000) return false;
      lastAt[e.key] = e.ms;
      return true;
    });

    // 5. SKY NOTES — a banner per no-cycle endpoint (origin AND destination).
    const skyNotes = [];
    for (const [place, pt, refMs] of [["origin", from, dep], ["destination", to, arr]]) {
      const s = sched(pt.lat, pt.lon, refMs);
      if (s.kind === "normal") continue;
      skyNotes.push({
        place, city: pt.city, iata: pt.iata,
        latitude: Math.abs(pt.lat).toFixed(1) + "° " + (pt.lat >= 0 ? "N" : "S"),
        kind: s.kind,
        allEstimated: ORDER.every(k => s[k].estimated),
        names: ORDER.filter(k => s[k].estimated).map(k => META[k].en)
      });
    }

    // ---- assemble ordered display model (zones/qibla/labels unchanged) ------
    const durationMin = Math.round((arr - dep) / 60000);
    const dateOf = (e) => e.status === "before" ? fmtDate(e.ms, from.tz)
                        : e.status === "after"  ? fmtDate(e.ms, to.tz)
                        : fmtDateSolar(e.ms, e.lon);
    const multiDay = new Set(merged.map(dateOf)).size > 1;
    const counts = {}; merged.forEach(e => { counts[e.key] = (counts[e.key] || 0) + 1; });
    const running = {};

    const prayers = merged.map((a, i) => {
      running[a.key] = (running[a.key] || 0) + 1;
      const seq = counts[a.key] > 1 ? running[a.key] : 0;
      let qiblaClock = null, qiblaRel = null;
      if (a.status === "inflight") {
        const qAbs = adhan.Qibla(new adhan.Coordinates(a.lat, a.lon));
        const hdg = initialBearing(a.lat, a.lon, to.lat, to.lon);
        qiblaRel = ((qAbs - hdg) % 360 + 360) % 360;
        let hr = Math.round(qiblaRel / 30) % 12; if (hr === 0) hr = 12;
        qiblaClock = hr;
      }
      // altitude horizon-dip: only on REAL sun-disk events — an estimate gets
      // no fake precision (Maghrib later aloft; the Fajr-ending sunrise earlier).
      const altFt = a.status === "inflight" ? (raw.cruiseAltFt || 38000) : 0;
      const dipMs = Math.round(altDipMinutes(a.lat, altFt) * 60000);
      const ms = (a.key === "maghrib" && !a.estimated) ? a.ms + dipMs : a.ms;
      const zones = {
        [from.iata]: { iata: from.iata, city: from.city, time: fmtTZ(ms, from.tz), date: fmtDate(ms, from.tz) },
        [to.iata]:   { iata: to.iata,   city: to.city,   time: fmtTZ(ms, to.tz),   date: fmtDate(ms, to.tz) }
      };
      let sunrise = null;
      if (a.key === "fajr" && a.sunriseMs != null) {
        const srMs = a.sunriseMs - (a.sunriseReal ? dipMs : 0);
        sunrise = { [from.iata]: fmtTZ(srMs, from.tz), [to.iata]: fmtTZ(srMs, to.tz) };
      }
      return {
        id: a.key + "-" + i,
        key: a.key, en: META[a.key].en, ar: META[a.key].ar, status: a.status,
        dusk: a.key === "maghrib",
        t: solarFrac(a.lat, a.lon, ms),
        ms,
        qiblaClock, qiblaRel, sunrise,
        estimated: a.estimated, estimateBasis: a.estimated ? a.source : null,
        source: a.source,
        zones, seq
      };
    });

    return Object.assign({}, raw, {
      durationMin,
      dep: { local: fmtTZ(dep, from.tz) },
      arr: { local: fmtTZ(arr, to.tz) },
      from: Object.assign({}, from),
      to:   Object.assign({}, to),
      cruiseAltFt: raw.cruiseAltFt || 38000,
      prayers, multiDay, skyNotes,
      midnightSun: skyNotes.find(n => n.place === "destination") || null  // back-compat, removed in Task 5
    });
  }
```

Note: a `daySchedule` memo is allowed if the perf test demands it (key `${Math.round(lat*50)}|${Math.round(lon*50)}|${dayKeyOf(refMs,lon)}|${method}`), but measure first — the ≤40° shortcut already removes the extra calls for most of most routes.

- [ ] **Step 5: Run the full suite**

Run: `npm test` — Expected: ALL pass (policy + regressions + invariants + smoke).
Debugging notes for likely failures:
- *Before-count = 1 on some runs:* the −1-day schedule's isha may be > dep-day fajr; ordering is fine — check the slice uses the merged sorted array.
- *In-flight T > arr+dip:* the dip is added after capture; the invariant allows +40 min.
- *6 h dedup killing a real repeat:* check QF10 — its repeats are ≳16 h apart; if a genuine <6 h same-key pair appears, it is a capture artifact, not a real repeat.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine.js tests/engine-regressions.test.js tests/engine-invariants.test.js
git commit -m "Engine: rewrite compute() — rolled before/after lists, cliff-aware capture, skyNotes, dip only on real sun events; delete the predictive classifier"
```

### Task 5: UI honesty fixes

**Files:**
- Modify: `/workspaces/isfar/src/components/Calculator.jsx:321-340` (Results banner)
- Modify: `/workspaces/isfar/src/components/components.jsx` (NextPrayer ~, MethodSheet copy)
- Modify: `/workspaces/isfar/src/components/cards.jsx:61-71` (EstimateNote copy)
- Modify: `/workspaces/isfar/src/components/arc.jsx` (estimate ring + aria)
- Modify: `/workspaces/isfar/src/lib/engine.js` (drop the `midnightSun` back-compat field)

- [ ] **Step 1: Results renders one banner per skyNote**

In `Calculator.jsx`, replace the `ms`/banner block in `Results` with:

```jsx
function Results({ f, activeKey, selectPrayer, cardRefs, onBack }) {
  return (
    <main className="results">
      <NextPrayer prayers={f.prayers} order={[f.from.iata, f.to.iata]} />
      <FlightSummary f={f} />
      {(f.skyNotes || []).map((n) => (
        <div className="midnight-banner" role="note" key={n.place}>
          <Ic.sunrise aria-hidden="true" />
          <span>The sun {n.kind === "polarnight" ? "won’t rise" : "won’t set"} at <b>{n.city}</b> ({n.latitude}) — {n.allEstimated ? "prayer times there are estimated" : "some prayer times there are estimates"}.</span>
        </div>
      ))}
      <ArcTimeline f={f} activeKey={activeKey} onSelect={selectPrayer} />
      <PrayerList f={f} activeKey={activeKey} cardRefs={cardRefs} />
      <button className="btn" onClick={onBack} style={{ marginTop: 8 }}><Ic.back style={{width:16,height:16}} aria-hidden="true" /> Look up another flight</button>
      <Foot />
    </main>
  );
}
```

Then remove the `midnightSun` back-compat field from the engine's return (and its line in `compute`).

- [ ] **Step 2: NextPrayer marks estimates**

In `components.jsx` `NextPrayer`, change the meta line and add wording:

```jsx
  const est = next.estimated;
  const statusText = next.status === "inflight" ? "in flight" : next.status === "before" ? "before departure" : "after arrival";
  const zs = (order || Object.keys(next.zones)).map(i => next.zones[i]).filter(Boolean);
  return (
    <div className="nextp" role="status" aria-live="polite" style={{ "--dot": color }}>
      <div className="np-left">
        <div className="np-eyebrow">Next prayer{est ? " · estimated" : ""}</div>
        <div className="np-name">
          <span className="np-en">{next.en}</span>
          <span className="np-ar ar" aria-hidden="true">{next.ar}</span>
        </div>
        <div className="np-meta">{statusText} · {zs.map(z => `${z.iata} ${est ? "~" : ""}${z.time}`).join(" · ")}</div>
      </div>
      ...
```

(Right column unchanged.)

- [ ] **Step 3: MethodSheet far-north copy states the 3 real rules**

Replace the "Far-north flights" entry's `d` in `components.jsx` (~line 163):

```js
    { ic: Ic.sunrise, t: "Far-north flights",
      d: "Your method's own dawn and dusk angles are used wherever the sky actually reaches them — at any latitude. In high summer above roughly 48–55° the sky may never get dark enough: there we divide your own night into sevenths instead (an established convention), and mark the time with a ~. Past 60°, where even the night can vanish, the night's times are borrowed from latitude 60 at your longitude — about as far north as Stockholm, St Petersburg, Helsinki and Anchorage — and marked the same way." },
```

- [ ] **Step 4: EstimateNote copy made latitude-neutral and specific**

In `cards.jsx`:

```jsx
function EstimateNote({ items }) {
  const est = items.filter(p => p.estimated);
  if (!est.length) return null;
  const borrowed = est.some(p => p.estimateBasis === "borrow60");
  const text = borrowed
    ? "Here the sky gives the usual dawn-and-dusk angles nothing to mark, so the ~ times are estimates — portioned from the night at latitude 60°. Scholars differ; follow the guidance you trust."
    : "Here the sky never gets dark enough for the usual dawn-and-dusk angles, so the ~ times are estimates portioned from your own night. Scholars differ; follow the guidance you trust.";
  return (
    <div className="pc-est-note">
      <Ic.info aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
```

- [ ] **Step 5: Arc — estimated dots get a dashed ring and aria text**

In `arc.jsx`, inside the prayer-dot `<g>`: change the aria-label and add a ring. Replace the dot group body:

```jsx
            <g key={pr.id} className={"prayer-dot" + (active ? " active" : "")}
               onClick={() => onSelect && onSelect(pr.id)} role="button" tabIndex={0}
               onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect && onSelect(pr.id); } }}
               aria-label={`${pr.en}${pr.estimated ? " (estimated)" : ""}, ${aloft ? "in flight" : pr.status === "before" ? "before departure" : "after arrival"}`}>
              <line x1={p.x} y1={p.y} x2={p.x} y2={tip} stroke={c} strokeWidth="1" opacity="0.35" />
              <circle className="halo" cx={p.x} cy={p.y} r={active ? 16 : 12}
                      fill={`oklch(from ${c} l c h / 0.26)`} />
              {pr.estimated
                ? <circle cx={p.x} cy={p.y} r="9" fill="none" stroke={c} strokeWidth="1" strokeDasharray="2 3" opacity="0.8" />
                : null}
              {aloft
                ? <circle className="core" cx={p.x} cy={p.y} r="6" fill={c} />
                : <circle className="core-hollow" cx={p.x} cy={p.y} r="5.5" fill="var(--bg-mid)" stroke={c} strokeWidth="2.5" />}
              <text className="lbl" x={p.x} y={nameY} textAnchor="middle">
                {pr.en}
              </text>
            </g>
```

Also soften the svg aria-label (line ~82): `aria-label={`${n} prayers from ${f.from.city} to ${f.to.city}, placed by time of day — dawn and dusk low, midday high.`}` and add a legend entry after the others: `<div className="lg"><i className="dot-hollow" style={{borderStyle:"dashed"}}></i> ~ estimated</div>`.

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build` — Expected: tests pass; Astro build green (it catches any unresolved import/JSX slip).

- [ ] **Step 7: Commit**

```bash
git add src/components src/lib/engine.js
git commit -m "UI honesty: skyNotes banner for both endpoints, ~ in NextPrayer, 3-rule MethodSheet copy, estimate ring on the arc, sharper estimate note"
```

### Task 6: docs alignment

**Files:**
- Modify: `/workspaces/isfar/CLAUDE.md` (engine-model section + verification section)
- Modify: `/workspaces/isfar/src/pages/guide/far-north-prayer-times.astro` (one phrase)

- [ ] **Step 1: CLAUDE.md**

In "The engine model" section: replace the `noSunset`/`defined`/`undefinedPrayers` sentence with the real model (`skyNotes[]`, `prayers[].source/estimated/estimateBasis`), describe the 3-rule `daySchedule` policy in 4-5 lines (observation-driven detection, whole-night-cluster borrow, trusted moonsighting, flagged polar Dhuhr), and note the dip applies only to real sun events. In "Verifying changes": `npm test` (vitest) is now the first oracle, then build/preview. In "Conventions": "There is no test suite" → describe `tests/`.

- [ ] **Step 2: Guide page**

In the "beyond 60°" bullet (line ~231), after "compute at 60°N, your longitude, as if you stood there" add: "— the whole night, sunset to sunrise, Maghrib to Fajr, read from that borrowed sky so the evening always keeps its order".

- [ ] **Step 3: Build + commit**

```bash
npm run build && git add CLAUDE.md src/pages/guide/far-north-prayer-times.astro && git commit -m "Docs: CLAUDE.md engine model + guide page reflect the 3-rule policy"
```

### Task 7: full verification

- [ ] **Step 1:** `npm test` — all green.
- [ ] **Step 2:** `npm run build && npm run preview` — then drive the preview with Playwright MCP: click each of the four sample chips; assert (a) DY394 shows the banner, ~ times, estimate pills, no console errors; (b) SV124 shows a non-empty "After arrival" section; (c) QF10 shows 8-9 prayers with day dividers; (d) EK215 renders. Screenshot DY394 results.
- [ ] **Step 3:** Adversarial review of the full diff (multi-agent workflow over `git diff <pre-rewrite-commit>..HEAD`), focusing on: policy conformance to the spec, walk edge cases, UI regressions, perf. Fix anything confirmed.
- [ ] **Step 4:** Push (user-approved): `git push` — Cloudflare auto-deploys.

## Self-review notes

- Spec coverage: rule 1/2/3 → Task 3; no-cycle/asr/dhuhr/kind → Task 3; detection → Task 3 (`wasSubstituted` + grid test); roll-forward both lists, cliff capture, 6 h dedup, dip-on-real, skyNotes → Task 4; NextPrayer/banner/MethodSheet/EstimateNote/arc → Task 5; CLAUDE.md + guide → Task 6; per-bug regressions → Task 4 tests; goldens + perf → Task 4 invariants; ship gate → Task 7. No gaps found.
- Types consistent: `daySchedule` returns `{ms, source, estimated}` + `kind`; `compute` reads exactly those; UI reads `estimated`/`estimateBasis`/`skyNotes` as produced.
- Known judgment calls already user-approved in the spec (cluster borrow, moonsighting trust, push when green).
