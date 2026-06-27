# Boarding-Pass Camera Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users point the phone camera at a boarding pass to auto-resolve a flight and show its prayer times, fully on-device, in the existing PWA.

**Architecture:** Three isolated units — a pure BCBP parser (`bcbp.js`), a lazy camera decoder (`scan.js`, native `BarcodeDetector` → `@zxing/library` fallback), and a full-screen `ScanSheet` UI — wired into `Calculator` with a "Scan boarding pass" entry button in both the flight and route forms. Flight mode auto-submits to results; route mode does an online lookup or, offline, prefills the route form.

**Tech Stack:** Astro + React island, `@zxing/library` (new, lazy-loaded), Vitest, existing `runFlightLookup`/`lookupRemote` flow.

## Global Constraints

- **PWA only** — no native, no share-sheet, no Wallet integration (out of scope).
- **All barcode decoding stays on-device.** Nothing is uploaded.
- **`@zxing/library` must be lazy-loaded** (dynamic `import()` only when the scan sheet opens) — never pulled into the main bundle. Pin the exact resolved version in `package.json` (drop the `^`), matching the repo convention (e.g. `"adhan": "4.4.3"`).
- **ES modules, real `import`/`export`** — no `window.*` globals.
- **`client:only` island** — `navigator`/`window`/`localStorage` reads are browser-only; no SSR guards needed.
- **iOS chrome (don't regress):** no `<meta theme-color>`; the scan overlay is `position: fixed` over everything but must not introduce a `theme-color`. Reserve safe areas with `env(safe-area-inset-*)`.
- **Calm, minimal, honest copy.** Reuse existing visual language (`btn`, `btn-ghost`, `iconbtn`, `Ic.*`, the error/field-error styles).
- **Tests first** (`npm test` = `vitest run tests`), then `npm run build`, then preview + real-device check.

---

### Task 1: Pure BCBP parser

**Files:**
- Create: `src/lib/bcbp.js`
- Test: `tests/bcbp.test.js`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces:
  - `julianToDateISO(dayOfYear: number, today?: Date) -> string | null` — soonest `YYYY-MM-DD` ≥ today for a 1..366 day-of-year; `null` if out of range.
  - `parseBCBP(raw: string, today?: Date) -> { code: string, dateISO: string, fromIata: string, toIata: string } | null` — first-leg flight from an IATA BCBP "M" string; `null` if not parseable.

- [ ] **Step 1: Write the failing test**

```js
// tests/bcbp.test.js
import { describe, it, expect } from 'vitest';
import { parseBCBP, julianToDateISO } from '../src/lib/bcbp.js';

// Canonical IATA BCBP "M" string, single leg, built to exact field offsets:
// M | legs=1 | name(20) | E | PNR(7)=ABC123␠ | from=YUL | to=FRA | carrier=AC␠
// | flight=0834␠ | julian=226 | F | seat=001A | seq=0025␠ | status=1 | varsize=00
const M1 =
  'M' + '1' + 'DESMARAIS/LUC       ' + 'E' + 'ABC123 ' +
  'YUL' + 'FRA' + 'AC ' + '0834 ' + '226' + 'F' + '001A' + '0025 ' + '1' + '00';

describe('julianToDateISO', () => {
  it('maps day-of-year to this year when still upcoming', () => {
    expect(julianToDateISO(226, new Date(2026, 0, 1))).toBe('2026-08-14');
  });
  it('rolls to next year when the day already passed', () => {
    // today = 28 Dec 2026; day 5 → 5 Jan 2027
    expect(julianToDateISO(5, new Date(2026, 11, 28))).toBe('2027-01-05');
  });
  it('stays this year for a still-future late day', () => {
    // today = 3 Jan 2026; day 360 → 26 Dec 2026
    expect(julianToDateISO(360, new Date(2026, 0, 3))).toBe('2026-12-26');
  });
  it('is leap-year aware (day 366 in a leap year)', () => {
    expect(julianToDateISO(366, new Date(2024, 0, 1))).toBe('2024-12-31');
  });
  it('rejects out-of-range days', () => {
    expect(julianToDateISO(0)).toBe(null);
    expect(julianToDateISO(400)).toBe(null);
  });
});

describe('parseBCBP', () => {
  it('parses a single-leg M pass', () => {
    expect(parseBCBP(M1, new Date(2026, 0, 1))).toEqual({
      code: 'AC834', dateISO: '2026-08-14', fromIata: 'YUL', toIata: 'FRA',
    });
  });
  it('uses the first leg of a multi-leg pass', () => {
    const multi = '2' + M1.slice(1); // flip the leg count, same first-leg bytes
    expect(parseBCBP(multi, new Date(2026, 0, 1)).code).toBe('AC834');
  });
  it('strips leading zeros and keeps an alpha flight suffix', () => {
    // replace flight field "0834 " (offsets 40-44) with "0835A"
    const suffix = M1.slice(0, 39) + '0835A' + M1.slice(44);
    expect(parseBCBP(suffix, new Date(2026, 0, 1)).code).toBe('AC835A');
  });
  it('returns null for non-M / too-short / malformed input', () => {
    expect(parseBCBP('')).toBe(null);
    expect(parseBCBP('X1' + M1.slice(2))).toBe(null);            // not format M
    expect(parseBCBP(M1.slice(0, 40))).toBe(null);               // too short
    const badFrom = M1.slice(0, 30) + '1UL' + M1.slice(33);       // from not IATA
    expect(parseBCBP(badFrom)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bcbp.test.js`
Expected: FAIL — `Failed to resolve import '../src/lib/bcbp.js'` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/bcbp.js
// Pure parser for IATA BCBP ("M" format) boarding-pass barcodes — extracts the
// first leg's flight number, route, and date. No DOM, no imports. Returns null
// for anything that is not a parseable M-format pass. The barcode carries a
// day-of-year but NO year and NO clock times (see julianToDateISO).

function iso(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Resolve a 1..366 day-of-year to the soonest YYYY-MM-DD that is >= today.
// new Date(year, 0, dayOfYear) is leap-year-correct and rolls over cleanly,
// which we use to reject day 366 in a non-leap year.
export function julianToDateISO(dayOfYear, today = new Date()) {
  if (!(dayOfYear >= 1 && dayOfYear <= 366)) return null;
  const y0 = today.getFullYear();
  const todayMid = new Date(y0, today.getMonth(), today.getDate());
  for (const y of [y0, y0 + 1]) {
    const d = new Date(y, 0, dayOfYear);
    if (d.getFullYear() === y && d >= todayMid) return iso(d);
  }
  // Edge: day valid this year but already passed and invalid next year — pin to
  // this year's mapped date so a real pass is never dropped.
  return iso(new Date(y0, 0, dayOfYear));
}

export function parseBCBP(raw, today = new Date()) {
  if (typeof raw !== 'string' || raw.length < 60 || raw[0] !== 'M') return null;
  const from = raw.slice(30, 33).trim();
  const to = raw.slice(33, 36).trim();
  const carrier = raw.slice(36, 39).trim();
  const flightRaw = raw.slice(39, 44).trim();
  const julian = parseInt(raw.slice(44, 47), 10);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  if (!/^[A-Z0-9]{2,3}$/.test(carrier)) return null;
  const m = flightRaw.match(/^0*(\d{1,4}[A-Z]?)$/);
  if (!m || !Number.isFinite(julian)) return null;
  const dateISO = julianToDateISO(julian, today);
  if (!dateISO) return null;
  return { code: carrier + m[1], dateISO, fromIata: from, toIata: to };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bcbp.test.js`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bcbp.js tests/bcbp.test.js
git commit -m "feat(scan): pure BCBP boarding-pass parser + tests"
```

---

### Task 2: Lazy camera decoder

**Files:**
- Create: `src/lib/scan.js`
- Modify: `package.json` (add `@zxing/library`, pinned exact version)

**Interfaces:**
- Consumes: `@zxing/library` (dynamic import inside the function).
- Produces: `scanBarcode(videoEl: HTMLVideoElement, signal: AbortSignal) -> Promise<string>` — resolves with the raw decoded PDF417 text; rejects on `no-camera`, abort, or decode failure. Attaches the camera stream to `videoEl`.

- [ ] **Step 1: Install the decoder dependency**

```bash
npm install @zxing/library
```

Then pin it: open `package.json` and change the `@zxing/library` entry from `"^x.y.z"` to the exact resolved version (e.g. `"@zxing/library": "0.21.3"`), matching the repo's pin-exact convention. Run `npm install` again to sync the lockfile.

- [ ] **Step 2: Write the decoder module**

This unit cannot be unit-tested (it needs a real camera). Verification is build resolution (Step 3) plus the real-device check in Task 5.

```js
// src/lib/scan.js
// On-device boarding-pass (PDF417) decoder. Uses native BarcodeDetector when it
// supports pdf417 (Android Chrome); otherwise lazy-imports @zxing/library (the
// iOS path — Safari has no BarcodeDetector). Decoding NEVER leaves the device.
// This whole module is dynamically imported only when the scan sheet opens.

function hasCamera() {
  return typeof navigator !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function scanBarcode(videoEl, signal) {
  if (!hasCamera()) throw new Error('no-camera');
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('pdf417')) return await scanNative(videoEl, signal);
    } catch (e) { /* fall through to zxing */ }
  }
  return await scanZxing(videoEl, signal);
}

// Native path: we own the camera stream and poll the detector each frame.
async function scanNative(videoEl, signal) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const stop = () => stream.getTracks().forEach((t) => t.stop());
  if (signal.aborted) { stop(); throw new Error('aborted'); }
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');
  await videoEl.play();
  const detector = new window.BarcodeDetector({ formats: ['pdf417'] });
  return await new Promise((resolve, reject) => {
    let raf = 0;
    const onAbort = () => { cancelAnimationFrame(raf); stop(); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });
    const tick = async () => {
      if (signal.aborted) return;
      try {
        const codes = await detector.detect(videoEl);
        if (codes && codes.length) {
          signal.removeEventListener('abort', onAbort);
          stop();
          resolve(codes[0].rawValue);
          return;
        }
      } catch (e) { /* transient frame error — keep trying */ }
      raf = requestAnimationFrame(tick);
    };
    tick();
  });
}

// zxing path: the library owns the camera stream; reset() stops it.
async function scanZxing(videoEl, signal) {
  const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import('@zxing/library');
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);
  const reader = new BrowserMultiFormatReader(hints);
  const stop = () => { try { reader.reset(); } catch (e) {} };
  if (signal.aborted) throw new Error('aborted');
  const onAbort = () => stop();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const result = await reader.decodeOnceFromConstraints(
      { video: { facingMode: 'environment' } }, videoEl);
    return result.getText();
  } finally {
    signal.removeEventListener('abort', onAbort);
    stop();
  }
}
```

- [ ] **Step 3: Verify the build resolves the new import**

Run: `npm run build`
Expected: build succeeds (an unresolved import fails the Astro/Vite build). `@zxing/library` should appear as its own async chunk under `dist/_assets/`, NOT inlined in the main island chunk — confirm with:

Run: `grep -rl "BrowserMultiFormatReader" dist/_assets/ | head`
Expected: one chunk filename; verify the main `Calculator`/island chunk is not that file (zxing stays lazy).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/scan.js
git commit -m "feat(scan): lazy on-device PDF417 camera decoder (BarcodeDetector + zxing)"
```

---

### Task 3: ScanSheet UI + camera icon + styles

**Files:**
- Modify: `src/components/components.jsx` (add `Ic.camera`, add `ScanSheet`, extend the `export {…}` list)
- Modify: `src/styles/styles.css` (scan overlay styles)

**Interfaces:**
- Consumes: `scanBarcode` from `../lib/scan.js` (dynamic import); a `parse` function prop (will be `parseBCBP`).
- Produces: `ScanSheet({ open, onClose, onResult, parse })` React component. Calls `onResult(pass)` with the parsed object on success; shows in-overlay errors (camera-denied / couldn't-read) with a "Try again" button otherwise.

- [ ] **Step 1: Add the camera icon to `Ic`**

In `src/components/components.jsx`, inside the `const Ic = { … }` object (near the other icons around line 8-17), add:

```jsx
  camera: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A1 1 0 0 1 11 4h2a1 1 0 0 1 .8.4L15 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.2"/></svg>),
```

- [ ] **Step 2: Add the `ScanSheet` component**

In `src/components/components.jsx`, after `IOSInstallSheet` (around line 240), add:

```jsx
/* ---- Boarding-pass scan overlay ---------------------------------------- */
function ScanSheet({ open, onClose, onResult, parse }) {
  const videoRef = React.useRef(null);
  const [err, setErr] = React.useState(null);
  const [attempt, setAttempt] = React.useState(0); // bump → retry
  React.useEffect(() => {
    if (!open) return;
    setErr(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort('timeout'), 15000);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    let done = false;
    (async () => {
      try {
        const { scanBarcode } = await import('../lib/scan.js');
        const raw = await scanBarcode(videoRef.current, ctrl.signal);
        const pass = parse(raw);
        if (!pass) throw new Error('parse');
        done = true;
        onResult(pass);
      } catch (e) {
        if (done || ctrl.signal.reason === 'closed') return;
        setErr((e && e.name === 'NotAllowedError')
          ? 'Camera access is needed to scan — you can still type the flight number.'
          : 'Couldn’t read the barcode. Try better light, or enter the flight number.');
      }
    })();
    return () => {
      clearTimeout(timer);
      ctrl.abort('closed');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, attempt]);
  if (!open) return null;
  return (
    <div className="scan-overlay" role="dialog" aria-modal="true" aria-label="Scan boarding pass">
      <video ref={videoRef} className="scan-video" playsInline muted aria-hidden="true"></video>
      <div className="scan-frame" aria-hidden="true"><div className="scan-guide"></div></div>
      <button className="iconbtn scan-cancel" onClick={onClose} aria-label="Cancel scan"><Ic.close aria-hidden="true" /></button>
      {err ? (
        <div className="scan-msg" role="alert">
          <p>{err}</p>
          <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : (
        <div className="scan-msg"><p>Point at the barcode on your boarding pass</p></div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Export `ScanSheet`**

In `src/components/components.jsx`, add `ScanSheet` to the final `export { … }` (line 371):

```jsx
export { Ic, PRAYER_GLYPH, Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, TzBanner, QiblaCompass, PlaneQibla, NextPrayer, cardinalOf, InstallNudge, IOSInstallSheet, ScanSheet };
```

- [ ] **Step 4: Add overlay styles**

Append to `src/styles/styles.css`:

```css
/* boarding-pass scan overlay (full-screen camera; no theme-color, scrolls
   under nothing — it's a modal that covers the app while scanning) */
.scan-overlay { position: fixed; inset: 0; z-index: 70; background: #000; overflow: hidden; }
.scan-video { width: 100%; height: 100%; object-fit: cover; }
.scan-frame { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.scan-guide { width: 80%; max-width: 440px; aspect-ratio: 5 / 2; border: 2px solid rgba(255,255,255,.9); border-radius: 14px; box-shadow: 0 0 0 100vmax rgba(0,0,0,.45); }
.scan-cancel { position: absolute; top: calc(env(safe-area-inset-top) + 14px); left: 14px; z-index: 2; color: #fff; background: rgba(0,0,0,.4); }
.scan-msg { position: absolute; left: 0; right: 0; bottom: calc(env(safe-area-inset-bottom) + 34px); text-align: center; color: #fff; padding: 0 26px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.scan-msg p { margin: 0; font-size: 15px; line-height: 1.4; text-shadow: 0 1px 4px rgba(0,0,0,.7); }
/* entry button under each form's primary action */
.scan-entry { width: 100%; justify-content: center; }
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/components.jsx src/styles/styles.css
git commit -m "feat(scan): ScanSheet camera overlay, camera icon, overlay styles"
```

---

### Task 4: Wire scanning into Calculator + flight-mode entry button

**Files:**
- Modify: `src/components/Calculator.jsx`

**Interfaces:**
- Consumes: `parseBCBP` from `../lib/bcbp.js`; `ScanSheet` from `./components.jsx`; existing `runFlightLookup(code, useDate, replace, skipRecord)` (line 251) and `setDate`.
- Produces: a `canScan` boolean + `onScan` opener threaded into `Landing` (and, in Task 5, `RouteForm`); an `onScanResult(pass)` handler that branches on `mode`.

- [ ] **Step 1: Import the parser and the sheet**

In `src/components/Calculator.jsx`, line 1-12 import block, add:

```jsx
import { parseBCBP } from '../lib/bcbp.js';
```

and add `ScanSheet` to the existing `./components.jsx` import (line 8):

```jsx
import { Header, SettingsSheet, GuideSheet, MethodSheet, FlightSummary, NextPrayer, Ic, InstallNudge, IOSInstallSheet, ScanSheet } from './components.jsx';
```

- [ ] **Step 2: Add scan state, capability flag, and the result handler**

In `Calculator()`, near the other `useS` declarations (after the `showMethod` state, ~line 90), add:

```jsx
  const [showScan, setShowScan] = useS(false);
  const [scanPrefill, setScanPrefill] = useS(null); // route-mode offline prefill
  const canScan = (typeof navigator !== 'undefined') &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
```

Then add the handler (place it right after `submit`, ~line 278):

```jsx
  // A boarding pass was scanned & parsed → { code, dateISO, fromIata, toIata }.
  // Flight mode: straight to the lookup. Route mode: look up if online (richer,
  // the barcode has the flight number), else prefill the route form so the user
  // can finish offline (the barcode carries no times).
  function onScanResult(pass) {
    setShowScan(false);
    setDate(pass.dateISO);
    if (mode === 'flight' || navigator.onLine) {
      runFlightLookup(pass.code, pass.dateISO, false);
    } else {
      setScanPrefill({ from: pass.fromIata, to: pass.toIata, n: Date.now() });
    }
  }
```

Note: `Date.now()` is allowed here (this is app runtime, not a workflow script) and only serves as a change-key for the route form's effect.

- [ ] **Step 3: Pass scan props to `Landing` and mount `ScanSheet`**

In the render, update the `Landing` element (line 346-351) to add `canScan` and `onScan`:

```jsx
        {view === "landing"  && <Landing query={query} setQuery={setQuery} date={date} setDate={setDate}
                                          err={err} onSubmit={submit}
                                          recents={recents} onClearRecents={clearRecents}
                                          onOpenRecent={openRecent}
                                          mode={mode} onSwitchMode={switchMode}
                                          onSubmitRecord={submitRecord}
                                          canScan={canScan} onScan={() => setShowScan(true)}
                                          scanPrefill={scanPrefill} />}
```

Then add `ScanSheet` alongside the other sheets (after `IOSInstallSheet`, ~line 372):

```jsx
        <ScanSheet open={showScan} onClose={() => setShowScan(false)} onResult={onScanResult} parse={parseBCBP} />
```

- [ ] **Step 4: Add the entry button to the flight-number form**

Update the `Landing` function signature (line 379-380) to accept the new props:

```jsx
function Landing({ query, setQuery, date, setDate, err, onSubmit, recents, onClearRecents, onOpenRecent,
                   mode, onSwitchMode, onSubmitRecord, canScan, onScan, scanPrefill }) {
```

In the flight-mode `<form>`, between the submit button and the offline-note (line 432-435), insert:

```jsx
          {canScan ? (
            <button type="button" className="btn-ghost scan-entry" onClick={onScan}>
              <Ic.camera style={{ width: 16, height: 16 }} aria-hidden="true" /> Scan boarding pass
            </button>
          ) : null}
```

- [ ] **Step 5: Pass scan props into `RouteForm` (consumed in Task 5)**

In the `mode === 'route'` branch (line 438), extend the `RouteForm` element:

```jsx
        <RouteForm date={date} setDate={setDate} todayISO={todayISO} onSubmitRecord={onSubmitRecord}
                   prefill={URL_PREFILL} canScan={canScan} onScan={onScan} scanPrefill={scanPrefill} />
```

- [ ] **Step 6: Verify build + flight-mode scan path in the preview**

```bash
npm test && npm run build && npm run preview
```

Expected: tests pass; build succeeds. Open the preview URL on a desktop browser — in flight mode a "Scan boarding pass" ghost button appears under the primary button; clicking it opens the full-screen camera overlay (grant permission) with the framing guide and "Point at the barcode…" hint; ✕ closes it. (Desktop webcams usually can't read a PDF417 — the on-phone read is verified in Task 5.)

- [ ] **Step 7: Commit**

```bash
git add src/components/Calculator.jsx
git commit -m "feat(scan): wire ScanSheet into Calculator + flight-mode entry button"
```

---

### Task 5: Route-mode entry button + reactive prefill + acceptance

**Files:**
- Modify: `src/components/route-form.jsx`

**Interfaces:**
- Consumes: `canScan`, `onScan`, `scanPrefill` props from `Calculator` (Task 4); existing `searchAirports(list, q, limit)` and `airportFromRow` from `../lib/airports.js`; `Ic` from `./components.jsx`.
- Produces: the route form's scan entry button + an effect that resolves `scanPrefill.from`/`.to` into the `from`/`to` comboboxes when offline scanning prefills them.

- [ ] **Step 1: Accept the new props**

In `src/components/route-form.jsx`, update the `RouteForm` signature (line 74):

```jsx
function RouteForm({ date, setDate, todayISO, onSubmitRecord, prefill, canScan, onScan, scanPrefill }) {
```

- [ ] **Step 2: React to a scan prefill after mount**

The existing `prefill` is resolved once on mount (line 81-98); a scan happens later, so add a separate effect that re-runs whenever `scanPrefill` changes (keyed by its `n`). Insert after that mount effect (after line 98):

```jsx
  // A boarding pass scanned while offline in route mode → fill From/To from the
  // barcode (times still come from the user; the barcode has none). Keyed on
  // scanPrefill.n so each scan re-applies even to the same airports.
  useE(() => {
    if (!scanPrefill || !list) return;
    const exact = (code) => {
      const row = searchAirports(list, code, 1)[0];
      return row && row[0] === code ? airportFromRow(row) : null;
    };
    const f = exact(scanPrefill.from), t = exact(scanPrefill.to);
    if (f) setFrom(f);
    if (t) setTo(t);
  }, [scanPrefill && scanPrefill.n, list]);
```

- [ ] **Step 3: Add the entry button to the route form**

Between the submit button and the offline-note (line 150-153), insert:

```jsx
      {canScan ? (
        <button type="button" className="btn-ghost scan-entry" onClick={onScan}>
          <Ic.camera style={{ width: 16, height: 16 }} aria-hidden="true" /> Scan boarding pass
        </button>
      ) : null}
```

- [ ] **Step 4: Verify the full suite + build + preview**

```bash
npm test && npm run build && npm run preview
```

Expected: all tests pass; build succeeds. In the preview, switch to Route mode — the "Scan boarding pass" button appears under the route form's primary button and opens the same overlay.

- [ ] **Step 5: Confirm the zxing chunk is precached (offline scanning works)**

Run: `grep -c "BrowserMultiFormatReader\|zxing" dist/sw.js; grep -o '"/_assets/[^"]*"' dist/sw.js | head`
Expected: the zxing async chunk's `/_assets/…` path is present in the `CORE` precache list `gen-sw-precache.mjs` wrote (it walks all of `dist/`, so async chunks are included automatically) — this is what lets the offline route-mode prefill path decode without a network.

- [ ] **Step 6: Real-device acceptance (cannot be automated)**

This is a required acceptance gate — the camera/zxing path has no automated coverage. On the deployed site (or `wrangler dev`, since non-sample lookups need the `/api/flight` Worker):

1. **iPhone (installed PWA, Safari):** flight mode → Scan → grant camera → point at a real boarding-pass PDF417 → confirms it auto-submits to the correct flight's prayer times. Verify the zxing path runs (iOS has no `BarcodeDetector`).
2. **Android (Chrome):** same, confirming the native `BarcodeDetector` path.
3. **Route mode, offline (airplane mode after install):** Scan → confirm From/To prefill from the pass and times remain user-entered.
4. **Misread / non-boarding-pass barcode:** confirm the "Couldn’t read…" overlay error + "Try again" works.
5. **Permission denied:** confirm the camera-access message appears.

- [ ] **Step 7: Commit**

```bash
git add src/components/route-form.jsx
git commit -m "feat(scan): route-mode scan entry + offline prefill from boarding pass"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** bcbp parser (T1) ✓, lazy decoder + zxing dep (T2) ✓, ScanSheet full-screen overlay (T3) ✓, entry buttons in both forms (T4 flight, T5 route) ✓, flight auto-submit (T4) ✓, route smart online/offline (T4 handler + T5 prefill) ✓, year resolution / multi-leg / leading-zero (T1 tests) ✓, error states (T3) ✓, on-device/lazy/precache constraints (T2 step 3, T5 step 5) ✓, real-device acceptance (T5 step 6) ✓. No gaps.
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `parseBCBP`/`julianToDateISO` signatures match across T1↔T4; `scanBarcode(videoEl, signal)` matches T2↔T3; `onResult(pass)`/`parse` props match T3↔T4; `scanPrefill={from,to,n}` shape matches T4↔T5; `searchAirports(list, code, 1)` matches the existing route-form usage.
