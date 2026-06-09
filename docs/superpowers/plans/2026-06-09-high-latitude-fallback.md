# High-latitude fallback prayer times — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For flights/destinations that reach latitudes with no astronomical Isha/Fajr, show a prayable *estimated* time + a teaching note instead of silently dropping the prayer — using adhan's own recognized high-latitude rules, taking no scholarly position of our own.

**Architecture:** Set adhan's `highLatitudeRule` (from a new user setting, default `SeventhOfTheNight`) + `polarCircleResolution = AqrabBalad` so adhan *returns* Isha/Fajr everywhere (they stop vanishing). A pure-geometry "detection gate" (solar declination, like the existing horizon-dip code) only *labels* each prayer `real` / `portioned` / `substituted` to drive an "estimate" tag + note. Times are 100% adhan's. UI: a calm estimate card style, a basis-driven note, a "Far-north prayers" Settings control, and the existing DY394 screen now shows times.

**Tech Stack:** adhan-js 4.4.3 (npm), React island, Astro/Vite build. No unit-test framework in this repo — verification is a **Node assertion harness** (`scripts/test-highlat.mjs`) plus the build + Playwright on the preview.

**Branch:** `highlat-fallback` (already created; design spec at `docs/superpowers/specs/2026-06-09-high-latitude-fallback-design.md`).

---

## File Structure

| File | Change |
|---|---|
| `scripts/test-highlat.mjs` | NEW — Node assertion harness (the TDD oracle for engine logic) |
| `src/lib/engine.js` | `makeParams` sets `highLatitudeRule` + `polarCircleResolution`; new `solarDeclination()` + `estimateBasisFor()`; `estimated`/`estimateBasis` on each prayer; `opts.highLat`; no-sunset path keyed off the gate with substituted times |
| `src/lib/data.js` | new `HIGHLAT` export |
| `src/components/Calculator.jsx` | default `highLat`; thread into both `compute()` calls + memo deps; pass to `SettingsSheet`; render estimated times in `NoSunset` |
| `src/components/components.jsx` | `SettingsSheet` gains a "Far-north prayers" `<select>` |
| `src/components/cards.jsx` | estimate card style + `~` prefix + pill; basis-driven teaching note in `PrayerList` |
| `src/styles/styles.css` | `.prayer-card.estimate`, `.pc-est-pill`, `.pc-est-note` styles |

**Key shared contract** (used across tasks — names are fixed here):
- `opts.highLat`: `"seventhnight" | "twilightangle"` (default `"seventhnight"`).
- Prayer model additive fields: `estimated: boolean`, `estimateBasis: "portioned" | "substituted" | null`.
- `estimateBasisFor(key, lat, ms, params) → "real" | "portioned" | "substituted"`.

---

## Task 1: Test harness + adhan rule wiring (prayers stop vanishing)

**Files:**
- Create: `scripts/test-highlat.mjs`
- Modify: `src/lib/engine.js` (`makeParams`, the `compute` call to it)

- [ ] **Step 1: Write the failing harness**

Create `scripts/test-highlat.mjs`:

```js
// Node assertion harness for the high-latitude fallback. Run: node scripts/test-highlat.mjs
import { compute, greatCircle } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL:', name); } };

// BA48 SEA->LHR (the triggering case) — real record from the live API
const BA48 = {
  code: 'BA48', airline: 'British Airways',
  depUTC: '2026-06-09T03:20:00Z', arrUTC: '2026-06-09T12:45:00Z',
  from: { iata: 'SEA', city: 'Seattle', lat: 47.449, lon: -122.309, tz: 'America/Los_Angeles' },
  to:   { iata: 'LHR', city: 'London',  lat: 51.4706, lon: -0.461941, tz: 'Europe/London' },
};

const OPTS = { method: 'isna', madhab: 'shafi', highLat: 'seventhnight' };

// --- Task 1: prayers no longer vanish ---
{
  const m = compute(BA48, OPTS);
  const keys = m.prayers.map(p => p.key);
  ok('BA48 includes an in-flight Isha', m.prayers.some(p => p.key === 'isha' && p.status === 'inflight'));
  ok('BA48 includes a Fajr somewhere', keys.includes('fajr'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-highlat.mjs`
Expected: FAIL — `BA48 includes an in-flight Isha` (today adhan's default collapses/drops it, so it isn't captured).

- [ ] **Step 3: Wire adhan's high-latitude rules in `makeParams`**

In `src/lib/engine.js`, replace the existing `makeParams` (currently signature `makeParams(method, madhab)`) with:

```js
  const HIGHLAT_RULE = { seventhnight: "SeventhOfTheNight", twilightangle: "TwilightAngle" };

  function makeParams(method, madhab, highLat) {
    const M = adhan.CalculationMethod;
    const map = {
      mwl: M.MuslimWorldLeague, isna: M.NorthAmerica, moonsighting: M.MoonsightingCommittee,
      egyptian: M.Egyptian, ummalqura: M.UmmAlQura, dubai: M.Dubai, qatar: M.Qatar,
      kuwait: M.Kuwait, karachi: M.Karachi, singapore: M.Singapore, turkey: M.Turkey,
      tehran: M.Tehran
    };
    const p = (map[method] || M.MuslimWorldLeague)();
    p.madhab = (madhab === "hanafi") ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
    // High-latitude handling: portion the local night (default last-seventh); and when there is no
    // local day/night cycle at all, substitute the nearest latitude that has one. Both are adhan's
    // own recognized rules — we choose the rule, never compute a time.
    p.highLatitudeRule = adhan.HighLatitudeRule[HIGHLAT_RULE[highLat] || "SeventhOfTheNight"];
    p.polarCircleResolution = adhan.PolarCircleResolution.AqrabBalad;
    return p;
  }
```

- [ ] **Step 4: Pass `highLat` through `compute`**

In `src/lib/engine.js`, find the line in `compute()`:
```js
    const params = makeParams(opts.method || "mwl", opts.madhab || "shafi");
```
Replace with:
```js
    const params = makeParams(opts.method || "mwl", opts.madhab || "shafi", opts.highLat || "seventhnight");
```

- [ ] **Step 5: Run the harness — verify it passes**

Run: `node scripts/test-highlat.mjs`
Expected: `2 passed, 0 failed`. (adhan now returns Isha/Fajr in the twilight-less zone, so the crossing detector captures the in-flight Isha.)

- [ ] **Step 6: Commit**

```bash
git add scripts/test-highlat.mjs src/lib/engine.js
git commit -m "High-lat: set adhan highLatitudeRule + AqrabBalad so prayers stop vanishing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Detection gate (label real / portioned / substituted)

**Files:**
- Modify: `src/lib/engine.js` (add `solarDeclination`, `estimateBasisFor`)
- Modify: `scripts/test-highlat.mjs` (add gate assertions)

- [ ] **Step 1: Add failing assertions to the harness**

Append, before the final `console.log` in `scripts/test-highlat.mjs`:

```js
// --- Task 2: detection gate ---
import { ISFAR_TEST } from '../src/lib/engine.js';
{
  const { estimateBasisFor, makeParams } = ISFAR_TEST;
  const isna = makeParams('isna', 'shafi', 'seventhnight');   // fajr/isha angle 15
  const ms = Date.parse('2026-06-21T12:00:00Z');               // solstice
  ok('45N Isha is real (15deg reached)',  estimateBasisFor('isha', 45, ms, isna) === 'real');
  ok('60N Isha is portioned',             estimateBasisFor('isha', 60, ms, isna) === 'portioned');
  ok('70N Isha is substituted (no night)',estimateBasisFor('isha', 70, ms, isna) === 'substituted');
  ok('70N Dhuhr is real (noon always)',   estimateBasisFor('dhuhr', 70, ms, isna) === 'real');
  ok('70N Maghrib is substituted',        estimateBasisFor('maghrib', 70, ms, isna) === 'substituted');
  const uaq = makeParams('ummalqura', 'shafi', 'seventhnight'); // interval Isha
  ok('60N UmmAlQura Isha real (interval)',estimateBasisFor('isha', 60, ms, uaq) === 'real');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-highlat.mjs`
Expected: FAIL — `ISFAR_TEST` is undefined (no test export yet).

- [ ] **Step 3: Add the gate to `engine.js`**

In `src/lib/engine.js`, add these two functions inside the IIFE (e.g. just after `altDipMinutes`):

```js
  /* solar declination (deg) for a date — standard approximation. Geometry (ours),
     used only to decide whether a prayer is an ESTIMATE; the time itself is adhan's. */
  function solarDeclination(ms) {
    const d = new Date(ms);
    const N = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
               Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000;
    return 23.44 * Math.sin((360 / 365.24) * (N - 81) * D2R);
  }

  /* classify a prayer at a position/date: "real" | "portioned" | "substituted".
     - no day/night cycle (midnight sun / polar night)            -> "substituted"
     - night exists but the method's twilight angle isn't reached  -> "portioned"  (fajr/isha)
     - otherwise                                                   -> "real" */
  function estimateBasisFor(key, lat, ms, params) {
    const decl = solarDeclination(ms);
    if (key === "dhuhr" || key === "asr") return "real";            // solar-noon / afternoon: always defined in daylight
    const noCycle = Math.abs(lat + decl) > 90 || Math.abs(lat - decl) > 90;
    if (noCycle) return "substituted";                              // affects fajr/isha/maghrib/sunrise
    if (key === "maghrib") return "real";                          // a sun-disk event; defined since a cycle exists
    if (key === "isha" && params.ishaInterval > 0) return "real";  // interval-based Isha = Maghrib + minutes
    const angle = key === "fajr" ? params.fajrAngle : params.ishaAngle;
    const depth = 90 - Math.abs(lat + decl);                        // sun's max depression below horizon at solar midnight
    return depth >= angle ? "real" : "portioned";
  }
```

- [ ] **Step 4: Export a test hook**

At the end of `src/lib/engine.js`, just before the existing `export const { compute, greatCircle } = ISFAR_ENGINE;`, the IIFE returns `{ compute, greatCircle }`. Change the IIFE's return to also expose the internals for the harness:

Find:
```js
    return model;
  }

  return { compute, greatCircle };
})();
```
Replace with:
```js
    return model;
  }

  return { compute, greatCircle, _test: { estimateBasisFor, makeParams, solarDeclination } };
})();
```
Then change the export line:
```js
export const { compute, greatCircle } = ISFAR_ENGINE;
```
to:
```js
export const { compute, greatCircle } = ISFAR_ENGINE;
export const ISFAR_TEST = ISFAR_ENGINE._test;
```

- [ ] **Step 5: Run the harness — verify it passes**

Run: `node scripts/test-highlat.mjs`
Expected: `8 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine.js scripts/test-highlat.mjs
git commit -m "High-lat: solar-geometry detection gate (real/portioned/substituted)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Tag prayers + rework the no-sunset path

**Files:**
- Modify: `src/lib/engine.js` (prayer model fields; no-sunset path)
- Modify: `scripts/test-highlat.mjs`

- [ ] **Step 1: Add failing assertions**

Append to `scripts/test-highlat.mjs` before the final `console.log`:

```js
// --- Task 3: model fields + no-sunset path ---
{
  const m = compute(BA48, OPTS);
  const isha = m.prayers.find(p => p.key === 'isha' && p.status === 'inflight');
  ok('in-flight Isha tagged estimated', isha && isha.estimated === true);
  ok('in-flight Isha basis portioned', isha && isha.estimateBasis === 'portioned');
  const dhuhr = m.prayers.find(p => p.key === 'dhuhr');
  ok('Dhuhr not estimated', dhuhr && dhuhr.estimated === false && dhuhr.estimateBasis === null);

  // a normal mid-latitude flight is unchanged (no estimates)
  const sv = compute(lookup('SV124'), OPTS);
  ok('SV124 has no estimated prayers', sv.prayers.every(p => p.estimated === false));

  // DY394 (OSL->TOS, midnight sun) — no-sunset screen still triggers AND now carries times
  const dy = compute(lookup('DY394'), OPTS);
  ok('DY394 noSunset still true', dy.noSunset === true);
  ok('DY394 undefinedPrayers carry a time', (dy.undefinedPrayers || []).every(p => typeof p.time === 'string' && p.time.length));
  ok('DY394 undefinedPrayers flagged substituted', (dy.undefinedPrayers || []).every(p => p.estimated === true && p.estimateBasis === 'substituted'));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/test-highlat.mjs`
Expected: FAIL — `in-flight Isha tagged estimated` (fields don't exist yet).

- [ ] **Step 3: Add the fields in the prayer model assembly**

In `src/lib/engine.js`, inside `compute()`, the `const prayers = entries.map((a, i) => { … })` block builds each prayer object. Add the basis computation at the top of the map callback (just after `running[a.key] = …; const seq = …;`):

```js
      const _basis = estimateBasisFor(a.key, a.lat, a.ms, params);
      const _estimated = _basis !== "real";
```
Then in the returned object literal (the `return { id: a.key + "-" + i, … seq };`), add the two fields before `seq`:
```js
        estimated: _estimated, estimateBasis: _estimated ? _basis : null,
        zones, seq
```
(Replace the existing `zones, seq` tail with the three-line version above.)

- [ ] **Step 4: Rework the no-sunset path to use the gate + substituted times**

In `src/lib/engine.js`, replace the no-sunset block (currently starting `// no-sunset: a prayer type undefined…` through the `undefinedPrayers` assignment) with:

```js
    // no-sunset: at the destination on arrival day, which prayers have no real sun event
    // (true midnight sun / polar night). adhan now SUBSTITUTES a time (AqrabBalad); we surface it.
    const destT = instantsAt(to.lat, to.lon, arr, params);
    const undefinedKeys = ORDER.filter(k => estimateBasisFor(k, to.lat, arr, params) === "substituted");
    if (undefinedKeys.length) {
      model.noSunset = true;
      model.latitude = Math.abs(to.lat).toFixed(1) + "° " + (to.lat >= 0 ? "N" : "S");
      model.defined = prayers.filter(p => p.status !== "after").map(p => ({
        key: p.key, en: p.en, ar: p.ar,
        time: (p.zones[from.iata] || Object.values(p.zones)[0]).time,
        note: p.status === "before" ? "before departure" : "aloft"
      }));
      model.undefinedPrayers = undefinedKeys.map(k => ({
        key: k, en: META[k].en, ar: META[k].ar,
        time: destT[k] ? fmtTZ(destT[k].getTime(), to.tz) : null,
        estimated: true, estimateBasis: "substituted"
      }));
    }
```

- [ ] **Step 5: Run the harness — verify it passes**

Run: `node scripts/test-highlat.mjs`
Expected: `15 passed, 0 failed`.

- [ ] **Step 6: Sanity-check no absurdity (Fajr before sunrise) via a spot assertion**

Append to `scripts/test-highlat.mjs` before the final `console.log`:
```js
// --- Task 3b: estimates are sane (in-flight Isha after Maghrib, chronological) ---
{
  const m = compute(BA48, OPTS);
  const infl = m.prayers.filter(p => p.status === 'inflight');
  for (let i = 1; i < infl.length; i++) ok('in-flight prayers chronological', infl[i].ms >= infl[i-1].ms);
}
```
Run: `node scripts/test-highlat.mjs` → still all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine.js scripts/test-highlat.mjs
git commit -m "High-lat: tag prayers estimated/estimateBasis; no-sunset path carries substituted times

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `HIGHLAT` setting data + thread through Calculator

**Files:**
- Modify: `src/lib/data.js`
- Modify: `src/components/Calculator.jsx`

- [ ] **Step 1: Add `HIGHLAT` to `data.js`**

In `src/lib/data.js`, just before the IIFE's `return { … }` line, add:
```js
  const HIGHLAT = [
    { key: "seventhnight", label: "Last seventh of the night",
      blurb: "Isha a seventh of the night after sunset; Fajr a seventh before sunrise — using your own night." },
    { key: "twilightangle", label: "Twilight angle",
      blurb: "Scale the night by the twilight angle — a tighter window." }
  ];
```
Then add `HIGHLAT` to the IIFE return object:
```js
  return { lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, HIGHLAT, SAMPLE: "SV124" };
```
And add it to the named export destructure at the bottom:
```js
export const { lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, HIGHLAT, SAMPLE } = ISFAR_DATA;
```

- [ ] **Step 2: Default + thread `highLat` in `Calculator.jsx`**

In `src/components/Calculator.jsx`:

(a) Default — change:
```js
    const def = { method: "isna", madhab: "shafi" };
```
to:
```js
    const def = { method: "isna", madhab: "shafi", highLat: "seventhnight" };
```

(b) Both `compute(...)` calls — change `{ method: settings.method, madhab: settings.madhab }` to `{ method: settings.method, madhab: settings.madhab, highLat: settings.highLat }` at **both** sites (the `useMemo` near line 95 and the submit handler near line 174).

(c) The model `useMemo` dependency array — change:
```js
  }, [raw, settings.method, settings.madhab]);
```
to:
```js
  }, [raw, settings.method, settings.madhab, settings.highLat]);
```

- [ ] **Step 3: Verify the build resolves**

Run: `npx astro build`
Expected: build completes, no unresolved-import errors. (UI for the setting comes next task; this just wires data + state.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/data.js src/components/Calculator.jsx
git commit -m "High-lat: HIGHLAT options + thread settings.highLat into compute

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Settings control ("Far-north prayers")

**Files:**
- Modify: `src/components/components.jsx` (`SettingsSheet`)
- Modify: `src/components/Calculator.jsx` (pass `highLat` prop)

- [ ] **Step 1: Import `HIGHLAT` in components.jsx**

In `src/components/components.jsx`, the existing import from data is `import { METHODS, GUIDANCE, COLOR } from '../lib/data.js';`. Change it to:
```js
import { METHODS, GUIDANCE, COLOR, HIGHLAT } from '../lib/data.js';
```

- [ ] **Step 2: Add the control to `SettingsSheet`**

In `src/components/components.jsx`, change the `SettingsSheet` signature:
```js
function SettingsSheet({ open, onClose, method, madhab, onChange }) {
```
to:
```js
function SettingsSheet({ open, onClose, method, madhab, highLat, onChange }) {
```
Then, inside `.settings-body`, immediately **after** the Asr `set-field` `</div>` and **before** the `<p className="set-foot">…</p>`, insert:
```jsx
          <div className="set-field">
            <label htmlFor="set-highlat">Far-north prayers</label>
            <p className="set-desc">{(HIGHLAT.find(h => h.key === highLat) || HIGHLAT[0]).blurb} Only affects routes that reach latitudes with no true night.</p>
            <select id="set-highlat" className="set-select" value={highLat}
                    onChange={(e) => onChange("highLat", e.target.value)}>
              {HIGHLAT.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
          </div>
```

- [ ] **Step 3: Pass the prop from `Calculator.jsx`**

In `src/components/Calculator.jsx`, the `<SettingsSheet … />` render currently passes `method={settings.method} madhab={settings.madhab} onChange={setSetting}`. Add `highLat`:
```jsx
        <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)}
                       method={settings.method} madhab={settings.madhab} highLat={settings.highLat} onChange={setSetting} />
```

- [ ] **Step 4: Build + manual check**

Run: `npm run build && npm run preview`
Open the preview, open Settings (gear icon). Expected: a third control "Far-north prayers" with options "Last seventh of the night" / "Twilight angle", the blurb updating on change. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/components.jsx src/components/Calculator.jsx
git commit -m "High-lat: Far-north prayers setting in SettingsSheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Estimate card style + teaching note

**Files:**
- Modify: `src/components/cards.jsx`
- Modify: `src/styles/styles.css`

- [ ] **Step 1: Estimate styling + `~` prefix + pill in `PrayerCard`**

In `src/components/cards.jsx`, in `PrayerCard`:

(a) Add the estimate class on the `<article>`:
```jsx
    <article ref={refEl} className={"prayer-card" + (active ? " active" : "") + (pr.estimated ? " estimate" : "")} style={{ "--dot": color }}
```

(b) Add a small pill in `.pc-name` after the Arabic name — change:
```jsx
        <div className="pc-name">
          <span className="en">{pr.en}</span>
          <span className="ar" aria-hidden="true">{pr.ar}</span>
        </div>
```
to:
```jsx
        <div className="pc-name">
          <span className="en">{pr.en}</span>
          <span className="ar" aria-hidden="true">{pr.ar}</span>
          {pr.estimated ? <span className="pc-est-pill">estimate</span> : null}
        </div>
```

(c) Prefix the time with `~` when estimated — change the zone-time line:
```jsx
            <div className="pc-zone-time tnum">{z.time}</div>
```
to:
```jsx
            <div className="pc-zone-time tnum">{pr.estimated ? "~" : ""}{z.time}</div>
```

- [ ] **Step 2: Basis-driven teaching note in `PrayerList`**

In `src/components/cards.jsx`, add this helper above `PrayerList`:

```js
function EstimateNote({ items }) {
  const est = items.filter(p => p.estimated);
  if (!est.length) return null;
  const anySub = est.some(p => p.estimateBasis === "substituted");
  const text = anySub
    ? "The sun never sets on part of this route, so there’s no night to divide — these times are estimated from the nearest latitude that has one. Scholars differ; follow the guidance you trust."
    : "No true night over the far north on this route, so these prayers have no exact time — estimated by portioning the night. Scholars differ; follow the guidance you trust.";
  return (
    <div className="pc-est-note">
      <Ic.info aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
```
Then, inside `PrayerList`'s section map, render the note after the cards — change:
```jsx
            {items.map((pr) => (
              <PrayerCard key={pr.id} pr={pr} multiDay={multiDay} order={order}
                          active={activeKey === pr.id}
                          refEl={(el) => { if (cardRefs) cardRefs.current[pr.id] = el; }} />
            ))}
          </div>
```
to:
```jsx
            {items.map((pr) => (
              <PrayerCard key={pr.id} pr={pr} multiDay={multiDay} order={order}
                          active={activeKey === pr.id}
                          refEl={(el) => { if (cardRefs) cardRefs.current[pr.id] = el; }} />
            ))}
            <EstimateNote items={items} />
          </div>
```

- [ ] **Step 3: Styles**

In `src/styles/styles.css`, append:
```css
/* High-latitude estimated prayers — calm, not a warning */
.prayer-card.estimate { border-style: dashed; opacity: 0.96; }
.pc-est-pill {
  font-size: 10.5px; letter-spacing: 0.03em; text-transform: uppercase;
  padding: 1px 6px; border-radius: 999px; margin-inline-start: 8px;
  color: var(--text-mute); border: 1px solid var(--hairline, rgba(128,128,128,0.35));
}
.pc-est-note {
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 13px; line-height: 1.45; color: var(--text-mute);
  padding: 8px 12px; margin-top: 6px;
}
.pc-est-note svg { flex: 0 0 auto; width: 15px; height: 15px; margin-top: 2px; opacity: 0.8; }
```
(If `--hairline` isn't defined in the theme tokens, the `rgba(...)` fallback applies.)

- [ ] **Step 4: Build + Playwright check**

Run: `npm run build && npm run preview`. With Playwright, look up **BA48** (note: non-sample, so use `wrangler dev` or test on a deploy — OR temporarily verify via the harness). For a *local* visual check, use the **DY394** sample chip (resolves locally) — its NoSunset screen is wired next task; for this task confirm the build is clean and `SV124` (normal flight) shows **no** estimate pills/notes.
Expected: SV124 renders normally (no `.estimate`, no `.pc-est-note`); build clean; no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/cards.jsx src/styles/styles.css
git commit -m "High-lat: calm estimate card style + basis-driven teaching note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: DY394 no-sunset screen shows estimated times

**Files:**
- Modify: `src/components/Calculator.jsx` (`NoSunset` component)

- [ ] **Step 1: Render the substituted time instead of "no true dawn/sunset"**

In `src/components/Calculator.jsx`, in `NoSunset`, the `undefinedPrayers` loop currently renders:
```jsx
        {f.undefinedPrayers.map((p) => (
          <div className="ns-row" key={p.key}>
            <span>{p.en} <span className="ar" aria-hidden="true">{p.ar}</span></span>
            <em>{p.key === "fajr" ? "no true dawn" : "no true sunset"}</em>
          </div>
        ))}
```
Replace with:
```jsx
        {f.undefinedPrayers.map((p) => (
          <div className="ns-row" key={p.key}>
            <span>{p.en} <span className="ar" aria-hidden="true">{p.ar}</span> <span className="pc-est-pill">estimate</span></span>
            <span className="tnum">{p.time ? "~" + p.time : (p.key === "fajr" ? "no true dawn" : "no true sunset")} <em>· {f.to.iata}</em></span>
          </div>
        ))}
```

- [ ] **Step 2: Soften the explanatory copy to match (it now offers times)**

In the same component, the paragraph currently says `…so <b>{joined}</b> … has no calculated time here.` Change the sentence ending to acknowledge the estimate — replace:
```jsx
        horizon, so <b>{joined}</b> {names.length > 1 ? "have" : "has"} no calculated time here.
```
with:
```jsx
        horizon, so <b>{joined}</b> {names.length > 1 ? "have" : "has"} no exact time — the value{names.length > 1 ? "s" : ""} below {names.length > 1 ? "are" : "is"} an estimate.
```

- [ ] **Step 3: Build + Playwright check on DY394 (local sample)**

Run: `npm run build && npm run preview`. With Playwright, click the **DY394** sample chip.
Expected: the "sun won't set" screen now shows **~HH:MM estimate** times for Fajr/Maghrib/Isha (not "no true dawn/sunset"), the scholarly paragraph remains, no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Calculator.jsx
git commit -m "High-lat: DY394 no-sunset screen shows estimated times

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full verification + harness in build

**Files:**
- Modify: `scripts/test-highlat.mjs` (final coverage)

- [ ] **Step 1: Add setting-switch + twilight-angle coverage**

Append to `scripts/test-highlat.mjs` before the final `console.log`:
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
Run: `node scripts/test-highlat.mjs` → all pass.

- [ ] **Step 2: Full clean build + harness**

Run: `node scripts/test-highlat.mjs && npm run build`
Expected: harness `N passed, 0 failed`; Astro build completes; precache generated.

- [ ] **Step 3: Playwright end-to-end on the preview**

Run: `npm run preview`. With Playwright:
- **SV124** (normal): renders as before — no estimate pills, no notes, no console errors.
- **DY394** (midnight sun): NoSunset screen shows `~HH:MM estimate` times + scholarly note.
- **QF10 / EK215** (long-haul samples): confirm they still render cleanly; note any estimate pills are plausibly placed and the teaching note reads correctly.
- Open Settings → switch "Far-north prayers" to "Twilight angle" → re-open DY394 → times change.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-highlat.mjs
git commit -m "High-lat: harness coverage for setting switch; full verification green

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- "Set adhan highLatitudeRule + AqrabBalad" → Task 1. ✓
- "Detection gate (declination), method-correct angle, real/portioned/substituted" → Task 2 (incl. interval-Isha + dhuhr/asr always real). ✓
- "estimated/estimateBasis additive fields" → Task 3. ✓
- "No-sunset path keyed off the gate, carries substituted times; DY394 keeps its screen" → Task 3 + Task 7. ✓
- "Default seventhnight, setting persists, back-compat" → Task 4 (def merge handles missing key). ✓
- "Far-north prayers select, blurb caption" → Task 5. ✓
- "Calm estimate card + basis-driven note" → Task 6. ✓
- "Normal flight unchanged" → Task 3 assertion + Task 8 Playwright. ✓
- "Twilight-angle option changes times" → Task 8. ✓
- Worker/API untouched → no task touches `worker/`. ✓

**Placeholder scan:** No TBD/TODO. The `_test` export is a deliberate, fully-specified hook. Note for engineer: BA48 is a non-sample flight, so its **live** lookup only works in prod/`wrangler dev`; the harness uses a hardcoded BA48 record, and local Playwright uses sample chips (DY394/SV124/QF10/EK215) which resolve from the local table everywhere.

**Type/name consistency:** `opts.highLat` values `"seventhnight"`/`"twilightangle"` consistent (data.js HIGHLAT keys, HIGHLAT_RULE map, Calculator default, harness). `estimateBasisFor(key, lat, ms, params)` signature consistent across definition (Task 2) and call sites (Task 3 model + no-sunset). Model fields `estimated`/`estimateBasis` consistent across engine, cards, NoSunset. `HIGHLAT` export consistent (data.js → components.jsx). `ISFAR_TEST` / `_test` hook consistent (Task 2 export → harness import).
