# Shareable Offline-First Results + Back Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make calculator results shareable, refreshable, and back-button-navigable by encoding result state in the root URL's query string, driven by the History API from inside the existing `client:only` React island — with offline reconstruction as the fast path.

**Architecture:** A new pure module `src/lib/share-url.js` encodes/decodes a resolved flight/route record ↔ query params. `Calculator.jsx` pushes the result URL on entering a result, restores state on `popstate`, and bootstraps from the URL on mount (route = fully offline via `routeRecord`; flight = cache-first via `lookupRemote`). A Share button on the Results view copies/shares the link. No SSR, no Worker change, no new pages.

**Tech Stack:** Astro (SSG) + one React island (global `React`, hooks aliased `useS/useE/useR`), Vite, vitest, Playwright on `npm run preview`. ES modules with real imports.

**Spec:** `docs/superpowers/specs/2026-06-16-shareable-results-design.md`

---

## File Structure

- **Create** `src/lib/share-url.js` — pure URL ↔ record codec. Exports `recordToParams`, `recordToUrl`, `parseShareParams`, `routeParamsToRecord`. Depends only on `airports.js` (`searchAirports`, `airportFromRow`, `routeRecord`) + `Intl`.
- **Create** `tests/share-url.test.js` — vitest round-trip + parse tests.
- **Modify** `src/components/Calculator.jsx` — history integration: `showRecord`, refactor flight lookup into `runFlightLookup`, `goHome` URL sync, `popstate` listener, mount bootstrap (widen the existing `URL_PREFILL` handling).
- **Modify** `src/components/components.jsx` — add a `share` icon to `Ic`.
- **Modify** `src/components/Calculator.jsx` (`Results` component) — add the Share button + copied/shared feedback.

Key existing anchors (verified):
- `Calculator.jsx:20-28` `URL_PREFILL` (legacy `?from=&to=` prefill), `:92-96` scrub effect.
- `Calculator.jsx:184-188` `goHome`, `:190-220` `submit`, `:256-266` `submitRecord`, `:124-130` `openRecent`, `:137-141` `data` memo.
- `Calculator.jsx:440` `Results({ f, settings, activeKey, selectPrayer, cardRefs, onBack, nudge })`; action buttons `:466-467`.
- `airports.js:111` `routeRecord({from,to,dateISO,depTime,arrTime})`; `:16` `loadAirports()` → rows list; `:26` `searchAirports`; `:11` `airportFromRow`.
- Record shape has `found`, `code`, `dateISO`, `from.{iata,tz}`, `to.{iata,tz}`, `depUTC`, `arrUTC`, and (route only) `routeMode:true`. `compute()` returns the raw record plus derived fields, so the computed model `f` still carries these.

---

## Task 1: `share-url.js` codec + unit tests

**Files:**
- Create: `src/lib/share-url.js`
- Test: `tests/share-url.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/share-url.test.js`:

```js
/* URL ↔ record codec for shareable results. Round-trip must reproduce an
   equivalent record so compute() renders identically from a shared link. */
import { describe, it, expect } from 'vitest';
import data from '../src/assets/airports.json';
import { airportFromRow, routeRecord } from '../src/lib/airports.js';
import {
  recordToParams, recordToUrl, parseShareParams, routeParamsToRecord
} from '../src/lib/share-url.js';

const LIST = data.airports;
const find = (iata) => airportFromRow(LIST.find((a) => a[0] === iata));

describe('flight records', () => {
  it('encodes flight + date only (no method, no times)', () => {
    const rec = { found: true, code: 'SV124', dateISO: '2026-06-16',
      from: { iata: 'LHR', tz: 'Europe/London' }, to: { iata: 'JED', tz: 'Asia/Riyadh' } };
    expect(recordToParams(rec)).toEqual({ flight: 'SV124', date: '2026-06-16' });
  });

  it('recordToUrl builds an absolute root URL', () => {
    const rec = { found: true, code: 'SV124', dateISO: '2026-06-16', from: {}, to: {} };
    expect(recordToUrl(rec, 'https://isfar.app'))
      .toBe('https://isfar.app/?flight=SV124&date=2026-06-16');
  });
});

describe('route records round-trip', () => {
  it('params → record reproduces depUTC/arrUTC/iata', () => {
    const orig = routeRecord({
      from: find('LHR'), to: find('JED'),
      dateISO: '2026-06-16', depTime: '09:30', arrTime: '18:05',
    });
    const params = recordToParams(orig);
    expect(params).toEqual({ from: 'LHR', to: 'JED', date: '2026-06-16', dep: '09:30', arr: '18:05' });

    const parsed = parseShareParams('?' + new URLSearchParams(params).toString());
    expect(parsed).toEqual({ kind: 'route', from: 'LHR', to: 'JED', date: '2026-06-16', dep: '09:30', arr: '18:05' });

    const rebuilt = routeParamsToRecord(parsed, LIST);
    expect(rebuilt.from.iata).toBe(orig.from.iata);
    expect(rebuilt.to.iata).toBe(orig.to.iata);
    expect(rebuilt.depUTC).toBe(orig.depUTC);
    expect(rebuilt.arrUTC).toBe(orig.arrUTC);
  });
});

describe('parseShareParams', () => {
  it('parses a flight link', () => {
    expect(parseShareParams('?flight=sv124&date=2026-06-16'))
      .toEqual({ kind: 'flight', code: 'SV124', date: '2026-06-16' });
  });
  it('returns null for legacy from/to-only prefill (no times)', () => {
    expect(parseShareParams('?from=LHR&to=JED')).toBeNull();
  });
  it('returns null for junk', () => {
    expect(parseShareParams('?foo=bar')).toBeNull();
  });
  it('rejects same-airport route', () => {
    expect(parseShareParams('?from=LHR&to=LHR&date=2026-06-16&dep=09:30&arr=10:30')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- share-url`
Expected: FAIL — `Failed to resolve import "../src/lib/share-url.js"` / functions undefined.

- [ ] **Step 3: Implement `share-url.js`**

Create `src/lib/share-url.js`:

```js
/* ===========================================================================
   Isfar — shareable result URLs.
   Encode/decode a resolved flight or route record ↔ the root URL's query
   string, so results are shareable, refreshable and offline-reconstructable.
   Flight links carry only {flight,date} (re-looked-up, cache-first); route
   links carry the full itinerary {from,to,date,dep,arr} (rebuilt offline via
   routeRecord). Calc method/madhab are deliberately NOT encoded — the
   recipient's own persisted settings apply. Pure module: Intl + airports.js.
   =========================================================================== */
import { searchAirports, airportFromRow, routeRecord } from './airports.js';

/* civil wall-clock "HH:MM" of a UTC instant in a tz (24h, DST-correct) */
function hhmm(isoUTC, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(isoUTC));
}

/* resolved record → plain params object (or null if not a finished result) */
export function recordToParams(rec) {
  if (!rec || !rec.found) return null;
  if (rec.routeMode) {
    return {
      from: rec.from.iata, to: rec.to.iata, date: rec.dateISO,
      dep: hhmm(rec.depUTC, rec.from.tz),
      arr: hhmm(rec.arrUTC, rec.to.tz),
    };
  }
  return { flight: rec.code, date: rec.dateISO };
}

/* resolved record → absolute root URL string (string, never a URL object —
   the CF Web Analytics beacon's pushState override chokes on URL objects). */
export function recordToUrl(rec, origin) {
  const p = recordToParams(rec);
  if (!p) return origin + '/';
  return origin + '/?' + new URLSearchParams(p).toString();
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const IATA = /^[A-Z]{3}$/;

/* location.search → share intent, or null (junk / legacy prefill-only) */
export function parseShareParams(search) {
  const p = new URLSearchParams(search || '');
  const from = (p.get('from') || '').toUpperCase();
  const to = (p.get('to') || '').toUpperCase();
  const date = p.get('date') || '';
  const dep = p.get('dep') || '';
  const arr = p.get('arr') || '';
  if (IATA.test(from) && IATA.test(to) && from !== to &&
      ISO.test(date) && HM.test(dep) && HM.test(arr)) {
    return { kind: 'route', from, to, date, dep, arr };
  }
  const code = (p.get('flight') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code && ISO.test(date)) return { kind: 'flight', code, date };
  return null;
}

/* parsed route intent + a loaded airports rows list → a route record
   (or null if either airport is unknown). Mirrors route-form's resolver. */
export function routeParamsToRecord(parsed, list) {
  const exact = (code) => {
    const row = searchAirports(list, code, 1)[0];
    return row && row[0] === code ? airportFromRow(row) : null;
  };
  const from = exact(parsed.from), to = exact(parsed.to);
  if (!from || !to) return null;
  return routeRecord({ from, to, dateISO: parsed.date, depTime: parsed.dep, arrTime: parsed.arr });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- share-url`
Expected: PASS (all cases). If the route round-trip fails on `dep`/`arr`, confirm `hourCycle:'h23'` (not `hour12:false`, which can emit `24:00`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-url.js tests/share-url.test.js
git commit -m "feat(share): URL ↔ record codec for shareable results"
```

---

## Task 2: History integration + URL bootstrap in `Calculator.jsx`

**Files:**
- Modify: `src/components/Calculator.jsx`

This task has no isolated unit test (the island is verified via Playwright in Task 4 per the project's `client:only` testing approach). Each step is a precise edit; verify with `npm run build` after.

- [ ] **Step 1: Add imports**

At the top of `Calculator.jsx`, alongside the existing `import { lookupRemote } from '../lib/data.js';`, add:

```jsx
import { loadAirports } from '../lib/airports.js';
import { recordToUrl, parseShareParams, routeParamsToRecord } from '../lib/share-url.js';
```

- [ ] **Step 2: Add module-scope share intent next to `URL_PREFILL`**

Immediately after the `URL_PREFILL` IIFE (ends `Calculator.jsx:28`), add:

```jsx
// Full share intent (flight or route with all itinerary fields) — distinct
// from URL_PREFILL, which is the legacy from/to-only form prefill. When this
// is set we reconstruct the whole result on mount and KEEP the URL (shareable).
const SHARE_INTENT = (() => {
  try { return parseShareParams(window.location.search); }
  catch (e) { return null; }
})();
```

- [ ] **Step 3: Add `showRecord` and refactor the flight lookup**

Inside `Calculator()`, replace the existing `submit` function (`Calculator.jsx:190-220`) with the following `showRecord` + `runFlightLookup` + `submit` trio:

```jsx
  // Show a resolved record as a result and sync the URL. replace:true is used
  // when bootstrapping from a shared/refreshed URL (don't add a history entry).
  function showRecord(rec, opts) {
    const replace = !!(opts && opts.replace);
    setErr(null);
    setQuery(rec.code || "");
    setRaw(rec);
    recordRecent(rec);
    setView("results");
    try {
      const url = recordToUrl(rec, window.location.origin);
      if (replace) history.replaceState({ isfar: "result" }, "", url);
      else history.pushState({ isfar: "result" }, "", url);
    } catch (e) {}
  }

  // Core flight lookup (shared by user submit and URL bootstrap). Keeps the
  // calm minimum loading dwell; cache-first via lookupRemote (offline replay).
  function runFlightLookup(code, useDate, replace) {
    setErr(null);
    setQuery(code.toUpperCase());
    setView("loading"); setLoadMsg(0);

    let i = 0;
    const msgInt = setInterval(() => { i = Math.min(i + 1, LOAD_MSGS.length - 1); setLoadMsg(i); }, 620);

    const token = {};
    loadTimer.current = token;

    (async () => {
      const [res] = await Promise.all([
        lookupRemote(code, useDate),
        new Promise((r) => setTimeout(r, 1200))
      ]);
      clearInterval(msgInt);
      if (loadTimer.current !== token) return;   // user navigated away mid-load
      if (!res.found) { setRaw(res); setView("error"); return; }
      showRecord(res, { replace });
    })();
  }

  function submit(rawArg) {
    const raw = (typeof rawArg === "string" ? rawArg : query).trim();
    if (!raw) { setErr("Enter a flight number to continue."); return; }
    runFlightLookup(raw, date, false);
  }
```

- [ ] **Step 4: Push the URL from `openRecent` and `submitRecord`**

In `openRecent` (`Calculator.jsx:124-130`), replace the instant branch body:

```jsx
  function openRecent(r) {
    if (r.rec && r.rec.found) {
      showRecord(r.rec);
      return;
    }
    submit(r.code);
  }
```

In `submitRecord` (`Calculator.jsx:256-266`), replace the `setTimeout` body's success line `setRaw(rec); recordRecent(rec); setView("results");` with `showRecord(rec);`:

```jsx
  function submitRecord(rec) {
    setQuery(rec.code); setView("loading"); setLoadMsg(0);
    let i = 0;
    const msgInt = setInterval(() => { i = Math.min(i + 1, LOAD_MSGS.length - 1); setLoadMsg(i); }, 620);
    const token = {}; loadTimer.current = token;
    setTimeout(() => {
      clearInterval(msgInt);
      if (loadTimer.current !== token) return;
      showRecord(rec);
    }, 1200);
  }
```

- [ ] **Step 5: Sync the URL in `goHome`**

Replace `goHome` (`Calculator.jsx:184-188`) with:

```jsx
  function goHome() {
    clearTimeout(loadTimer.current);
    loadTimer.current = null;            // invalidate any in-flight async lookup
    setView("landing"); setRaw(null); setErr(null); setActiveKey(null);
    // back to a clean root URL so the in-app Home and the browser Back agree
    try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
  }
```

- [ ] **Step 6: Guard the legacy prefill scrub + add bootstrap and popstate effects**

Replace the existing prefill-scrub effect (`Calculator.jsx:92-96`) with the block below. It (a) only scrubs when it's a pure prefill (no share intent), (b) bootstraps a full result from a share URL on mount, and (c) restores state on browser back/forward:

```jsx
  // Mount: handle a shared/refreshed result URL, else scrub a legacy prefill.
  useE(() => {
    if (SHARE_INTENT && SHARE_INTENT.kind === "flight") {
      setDate(SHARE_INTENT.date);
      runFlightLookup(SHARE_INTENT.code, SHARE_INTENT.date, true);
    } else if (SHARE_INTENT && SHARE_INTENT.kind === "route") {
      switchMode("route");
      loadAirports().then((list) => {
        const rec = routeParamsToRecord(SHARE_INTENT, list);
        if (rec) showRecord(rec, { replace: true });
      }).catch(() => {});
    } else if (URL_PREFILL) {
      try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
    }
  }, []);

  // Browser back/forward drives the view from the URL. No share params => the
  // landing screen; share params => rebuild that result (cache-first/offline).
  useE(() => {
    const onPop = () => {
      const intent = parseShareParams(window.location.search);
      if (!intent) {
        clearTimeout(loadTimer.current); loadTimer.current = null;
        setView("landing"); setRaw(null); setErr(null); setActiveKey(null);
        return;
      }
      if (intent.kind === "flight") runFlightLookup(intent.code, intent.date, true);
      else loadAirports().then((list) => {
        const rec = routeParamsToRecord(intent, list);
        if (rec) showRecord(rec, { replace: true });
      }).catch(() => {});
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
```

Note: `switchMode` and `setDate` are defined earlier in the component; `runFlightLookup`/`showRecord` are from Steps 3. Function declarations hoist, so ordering within the component body is fine.

- [ ] **Step 7: Build to verify it compiles**

Run: `npm run build`
Expected: Astro build succeeds (an unresolved import or syntax error fails the build). No `dist` assertion here — behavior is verified in Task 4.

- [ ] **Step 8: Commit**

```bash
git add src/components/Calculator.jsx
git commit -m "feat(share): URL push/bootstrap/popstate history integration"
```

---

## Task 3: Share button on the Results view

**Files:**
- Modify: `src/components/components.jsx` (add `share` icon)
- Modify: `src/components/Calculator.jsx` (`Results` component)

- [ ] **Step 1: Add a `share` icon to `Ic`**

In `components.jsx`, inside the `Ic = { ... }` object (after the `download` entry at `:22`), add:

```jsx
  share: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>),
```

- [ ] **Step 2: Import the codec into Calculator (if not already)**

`recordToUrl` is already imported in Task 2 Step 1. No change needed — confirm the import line exists.

- [ ] **Step 3: Add share handler + button to `Results`**

In `Results` (`Calculator.jsx:440`), add a `shared` state and `shareLink` handler beside `saveImage`, and a Share button beside "Save as image" (`:467`):

Add near the top of `Results`, after the `exportErr` state:

```jsx
  const [shared, setShared] = useS(false);
  async function shareLink() {
    const url = recordToUrl(f, window.location.origin);
    try {
      if (navigator.share) { await navigator.share({ url }); return; }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch (e) { /* user cancelled share or clipboard blocked — no-op */ }
  }
```

In the `.results-actions` block (`:465-468`), add the Share button after the "Save as image" button:

```jsx
      <div className="results-actions">
        <button className="btn" onClick={onBack}><Ic.back style={{width:16,height:16}} aria-hidden="true" /> Look up another flight</button>
        <button className="btn-ghost" onClick={saveImage}><Ic.download style={{width:16,height:16}} aria-hidden="true" /> Save as image</button>
        <button className="btn-ghost" onClick={shareLink}><Ic.share style={{width:16,height:16}} aria-hidden="true" /> {shared ? "Link copied" : "Share link"}</button>
      </div>
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/components.jsx src/components/Calculator.jsx
git commit -m "feat(share): Share link button on results (Web Share + clipboard)"
```

---

## Task 4: Verify behavior on the preview (Playwright)

**Files:** none (verification only).

Per the project's verification approach: `npm test` (full suite) → `npm run build && npm run preview` → drive the preview URL in a real browser. Sample chips resolve from the local table even in the static preview, so flight lookups work offline-of-API here.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites PASS, including the new `tests/share-url.test.js`. Confirm the "Test Files" line counts `share-url.test.js` (stale worktree `node_modules` can silently run the parent's vitest — if in doubt, `npm ci` first).

- [ ] **Step 2: Build + preview**

Run: `npm run build && npm run preview`
Note the preview URL (e.g. `http://localhost:4321`).

- [ ] **Step 3: Flight result → URL + refresh (Playwright on the preview URL)**

- Open `/`, click the `SV124` sample chip → result renders.
- Assert `location.search` now contains `flight=SV124` and a `date=`.
- Reload the page → the same SV124 result renders (bootstrap path).

- [ ] **Step 4: Back button**

- From the SV124 result, run `history.back()` (or the browser Back) → the landing view shows and `location.search` is empty.

- [ ] **Step 5: Route result → URL + offline reconstruction**

- Switch to route mode, pick two airports (e.g. LHR → JED), enter dep/arr times, submit → result renders.
- Assert `location.search` contains `from=`, `to=`, `date=`, `dep=`, `arr=`.
- Copy that URL. In a **fresh browser context with network disabled** (Playwright `context.setOffline(true)` / route-abort), open the URL → the route result renders **with no network** (route mode is pure client compute).

- [ ] **Step 6: Share button**

- On a result, click "Share link". With clipboard permission granted, assert the clipboard contains the absolute result URL; assert the button label flips to "Link copied" then back.

- [ ] **Step 7: Commit any fixes, then stop for review**

If Steps 3-6 surfaced bugs, fix with TDD (extend `share-url.test.js` where the bug is in the codec) and re-run. Otherwise the feature is complete on the `worktree-analytics` branch — do **not** push/merge to `main` (that is the prod deploy; defer to the authorized deploy step after sub-project A).

---

## Self-review notes (author)

- **Spec coverage:** URL scheme (Task 1 codec + Task 2 wiring), cache-first bootstrap (Task 2 Step 6 + `runFlightLookup`/`routeParamsToRecord`), back button (Task 2 popstate + goHome), share affordance (Task 3), offline route reconstruction (Task 1 round-trip test + Task 4 Step 5), method/madhab excluded from URL (Task 1 `recordToParams` omits them; verified in test). All covered.
- **Method/madhab not in URL:** confirmed — `recordToParams` emits only `{flight,date}` or `{from,to,date,dep,arr}`.
- **String URL (not URL object):** `recordToUrl` returns a string; `pushState`/`replaceState` receive strings — honors the CF beacon constraint for sub-project A.
- **No hash routing:** all navigation is query-on-root via `pushState`.
- **Type consistency:** `showRecord(rec, {replace})`, `runFlightLookup(code, useDate, replace)`, `recordToUrl(rec, origin)`, `parseShareParams(search)→{kind,...}`, `routeParamsToRecord(parsed, list)` used consistently across tasks.
