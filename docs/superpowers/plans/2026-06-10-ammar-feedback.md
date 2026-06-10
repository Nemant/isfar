# Ammar Feedback Round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four approved feedback features: today-default date UX, offline-trust hardening (recents v2 + SW fix + saved-flights reframe), route mode (city+time lookup, fully offline), canvas image export, and a post-results PWA install nudge.

**Architecture:** All client-side; engine and Worker untouched. Route mode synthesizes the exact `/api/flight` record shape from a bundled airport dataset, so `compute()` needs no changes. New focused modules: `src/lib/recents.js`, `src/lib/airports.js`, `src/lib/export-card.js`, `src/components/route-form.jsx`. Spec: `docs/superpowers/specs/2026-06-10-ammar-feedback-design.md`.

**Tech Stack:** Astro + one React island, vitest, vanilla canvas, Intl APIs (no new dependencies).

**Verification gate per task:** `npm test` green. Final gate: `npm run build && npm run preview` + Playwright walkthrough (incl. offline emulation).

---

## Workstream A — quick wins

### Task A1: After-cap invariant test (engine, test-only)

**Files:**
- Modify: `tests/engine-invariants.test.js`

- [ ] **Step 1: Add the invariant to the existing `describe('invariants over 120 randomized flights')` block**

```js
  it('always exactly 2 after-arrival prayers', () => {
    for (const { f, method, m } of runs) {
      expect(m.prayers.filter(p => p.status === 'after').length, label(f, method)).toBe(2);
    }
  });
```

- [ ] **Step 2: Run** `npm test` — expected: PASS (verified on the four samples already; if any randomized flight fails, STOP and investigate the engine before weakening the assertion).

- [ ] **Step 3: Commit** `git commit -m "Test: pin the always-2-after-arrival invariant"`

### Task A2: Recents v2 — store the full record (`src/lib/recents.js`)

**Files:**
- Create: `src/lib/recents.js`
- Create: `tests/recents.test.js`
- Modify: `src/components/Calculator.jsx` (recents state + replay + Landing rows)

- [ ] **Step 1: Write failing tests** (`tests/recents.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { upsertRecent, recentLabel } from '../src/lib/recents.js';
import { lookup } from '../src/lib/data.js';

const RAW = lookup('SV124');

describe('upsertRecent', () => {
  it('stores the full record for offline replay', () => {
    const list = upsertRecent([], RAW);
    expect(list).toHaveLength(1);
    expect(list[0].rec).toEqual(RAW);
    expect(list[0].code).toBe('SV124');
    expect(list[0].dateISO).toBe('2026-06-06');
  });
  it('dedups by code+dateISO, newest first, caps at 6', () => {
    let list = [];
    for (let i = 0; i < 8; i++) {
      list = upsertRecent(list, { ...RAW, code: 'XX' + i });
    }
    expect(list).toHaveLength(6);
    expect(list[0].code).toBe('XX7');
    list = upsertRecent(list, { ...RAW, code: 'XX7' });   // same code+date → moves up, no dup
    expect(list.filter(r => r.code === 'XX7')).toHaveLength(1);
    const other = upsertRecent(list, { ...RAW, code: 'XX7', dateISO: '2026-06-08' });
    expect(other.filter(r => r.code === 'XX7')).toHaveLength(2);  // new date = new entry
  });
  it('tolerates legacy code-only entries', () => {
    const legacy = { code: 'BA286', fromIata: 'LHR', toIata: 'JED', ts: 1 };
    const list = upsertRecent([legacy], RAW);
    expect(list).toContainEqual(legacy);
  });
});

describe('recentLabel', () => {
  it('formats route + date', () => {
    const list = upsertRecent([], RAW);
    expect(recentLabel(list[0])).toBe('LHR → JED · 6 Jun');
  });
  it('survives a legacy entry with no dateISO', () => {
    expect(recentLabel({ fromIata: 'LHR', toIata: 'JED' })).toBe('LHR → JED');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/recents.test.js` — expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/recents.js`

```js
/* Saved flights ("recents") — each entry carries the FULL lookup record so a
   saved flight replays with zero network: airplane-mode-proof by construction.
   Legacy entries (code only) are kept and replayed via lookup as before. */

const CAP = 6;
const keyOf = (r) => (r.code || "") + "·" + (r.dateISO || "");

export function upsertRecent(list, rec) {
  const item = {
    code: rec.code, dateISO: rec.dateISO, airline: rec.airline,
    fromIata: rec.from.iata, fromCity: rec.from.city,
    toIata: rec.to.iata, toCity: rec.to.city,
    ts: Date.now(), rec
  };
  return [item, ...list.filter((r) => keyOf(r) !== keyOf(item))].slice(0, CAP);
}

const _short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function recentLabel(r) {
  const route = `${r.fromIata} → ${r.toIata}`;
  if (!r.dateISO) return route;
  return `${route} · ${_short.format(new Date(r.dateISO + "T12:00:00Z"))}`;
}
```

- [ ] **Step 4: Run** `npx vitest run tests/recents.test.js` — expected: PASS. Then full `npm test`.

- [ ] **Step 5: Wire into `Calculator.jsx`**

Replace `recordRecent` with the module + `storage.persist()` request; add an instant replay path:

```js
import { upsertRecent, recentLabel } from '../lib/recents.js';
```

```js
  function recordRecent(rec) {
    setRecents((prev) => {
      const next = upsertRecent(prev, rec);
      try { localStorage.setItem("isfar.recents", JSON.stringify(next)); } catch (e) {}
      return next;
    });
    // ask the browser not to evict our storage — the whole point of saving
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  }

  // tap a saved flight: full record stored → instant, zero network (airplane mode);
  // legacy code-only entries fall back to the normal lookup
  function openRecent(r) {
    if (r.rec && r.rec.found) {
      setErr(null); setQuery(r.code || ""); setRaw(r.rec); setView("results");
      return;
    }
    submit(r.code);        // legacy code-only entry — normal lookup path
  }
```

In `Landing`, the recents block becomes (reframe + label):

```jsx
        {recents && recents.length ? (
          <div className="recents">
            <div className="recents-head">
              <span>Saved flights <em>· work offline</em></span>
              <button type="button" className="recents-clear" onClick={onClearRecents}>Clear</button>
            </div>
            <div className="recents-list">
              {recents.map((r) => (
                <button type="button" key={(r.code || "") + (r.dateISO || "")} className="recent"
                        onClick={() => onOpenRecent(r)}>
                  <span className="recent-code">{r.code}</span>
                  <span className="recent-route">{recentLabel(r)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
```

Pass `onOpenRecent={openRecent}` through `Landing` props (replacing the `onSubmit(r.code)` inline call).

- [ ] **Step 6: Results confirmation line** — in `Results`, directly under `<FlightSummary f={f} />`:

```jsx
      <div className="saved-note" role="note"><Ic.auto aria-hidden="true" /> Saved on this device — available offline</div>
```

CSS (append near `.offline-note` in `styles.css`):

```css
.saved-note {
  display: flex; align-items: center; gap: 8px; justify-content: center;
  font-size: 12.5px; color: var(--text-mute); margin: -2px 0 2px;
}
.saved-note svg { width: 14px; height: 14px; flex-shrink: 0; color: var(--accent); }
```

- [ ] **Step 7: Run** `npm test`, then **Commit** `git commit -m "Offline trust: recents store the full record, instant offline replay, persist(), saved-flights reframe"`

### Task A3: SW cache-matching fix (`public/sw.js`)

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Fix the offline fallback** — `ignoreSearch: true` must never apply to `/api/*` (it can return the WRONG flight's cached response). In the same-origin branch:

```js
      } catch (err) {
        // /api responses are keyed by their query string (?code=…&date=…) —
        // ignoring it could hand back a different flight's lookup
        const isApi = new URL(req.url).pathname.startsWith("/api/");
        const cached = await caches.match(req, { ignoreSearch: !isApi });
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await caches.match("/index.html", { ignoreSearch: true });
          if (shell) return shell;
        }
        throw err;
      }
```

- [ ] **Step 2: Bump** `const CACHE = "isfar-v19"` → `"isfar-v20"`.

- [ ] **Step 3: Commit** `git commit -m "SW: never ignoreSearch for /api — offline fallback could return the wrong flight"`

### Task A4: Date defaults to today + Today chip

**Files:**
- Modify: `src/components/Calculator.jsx`, `src/styles/styles.css`

- [ ] **Step 1: Default to the device's date** — replace `useS("2026-06-06")`:

```js
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
```

```js
  const [date, setDate] = useS(todayISO());
```

- [ ] **Step 2: Today chip in `Landing`** — beside the date label, visible only when the value differs:

```jsx
        <div className="field">
          <div className="label-row">
            <label htmlFor="date">Date of travel</label>
            {date !== todayISO() ? (
              <button type="button" className="today-btn" onClick={() => setDate(todayISO())}>Today</button>
            ) : null}
          </div>
          <input id="date" className="input compact" type="date" value={date}
                 onChange={(e) => setDate(e.target.value)} />
        </div>
```

CSS:

```css
.label-row { display: flex; align-items: baseline; justify-content: space-between; }
.today-btn {
  appearance: none; background: none; border: 0; padding: 0; cursor: pointer;
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--accent);
  letter-spacing: .02em;
}
.today-btn:hover { text-decoration: underline; }
```

- [ ] **Step 3: Run** `npm test`, **Commit** `git commit -m "Landing: date defaults to today, Today reset chip"`

---

## Workstream B — route mode

### Task B1: Airport dataset (`scripts/gen-airports.mjs` → `src/assets/airports.json`)

**Files:**
- Create: `scripts/gen-airports.mjs`
- Create (generated, committed): `src/assets/airports.json`

- [ ] **Step 1: Write the generator** (one-time script; needs network — both sources verified reachable):

```js
#!/usr/bin/env node
/* gen-airports.mjs — build src/assets/airports.json for route mode.
   Sources (downloaded at RUN time; the OUTPUT is committed, builds are offline):
   - OurAirports airports.csv — which airports have scheduled service + IATA
   - mwgg/Airports airports.json — IANA timezone per airport
   Rerun manually if the dataset ever needs refreshing: node scripts/gen-airports.mjs */
import { writeFileSync } from 'node:fs';

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const MWGG = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

// minimal CSV parser (handles quoted fields with commas)
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const clean = (name) => name.replace(/\s+(International\s+)?Airport$/i, '').trim();

const [csvText, mwgg] = await Promise.all([
  fetch(OURAIRPORTS).then((r) => r.text()),
  fetch(MWGG).then((r) => r.json()),
]);

// IANA tz by IATA from mwgg (ICAO-keyed entries carry an `iata` + `tz` field)
const tzByIata = {};
for (const k of Object.keys(mwgg)) {
  const a = mwgg[k];
  if (a.iata && a.tz) tzByIata[a.iata] = a.tz;
}

const rows = parseCSV(csvText);
const head = rows[0];
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const TYPE_RANK = { large_airport: 0, medium_airport: 1, small_airport: 2 };

const out = [];
for (const r of rows.slice(1)) {
  if (r.length < head.length) continue;
  if (r[col.scheduled_service] !== 'yes') continue;
  const iata = r[col.iata_code];
  if (!/^[A-Z]{3}$/.test(iata)) continue;
  const type = r[col.type];
  if (!(type in TYPE_RANK)) continue;
  const tz = tzByIata[iata];
  if (!tz) continue;                       // no IANA tz → unusable for us
  const lat = +(+r[col.latitude_deg]).toFixed(4);
  const lon = +(+r[col.longitude_deg]).toFixed(4);
  if (!isFinite(lat) || !isFinite(lon)) continue;
  const city = r[col.municipality] || clean(r[col.name]);
  out.push({ rank: TYPE_RANK[type], row: [iata, city, clean(r[col.name]), lat, lon, tz] });
}

out.sort((a, b) => a.rank - b.rank || (a.row[0] < b.row[0] ? -1 : 1));
const seen = new Set();
const airports = out.filter(({ row }) => !seen.has(row[0]) && seen.add(row[0])).map(({ row }) => row);

if (airports.length < 2000 || airports.length > 8000) {
  throw new Error(`suspicious airport count: ${airports.length}`);
}
for (const iata of ['LHR', 'JED', 'TOS', 'LAX', 'PER', 'DXB']) {
  if (!airports.some((a) => a[0] === iata)) throw new Error(`missing sanity airport ${iata}`);
}

const json = JSON.stringify({ v: 1, airports });
writeFileSync(new URL('../src/assets/airports.json', import.meta.url), json);
console.log(`wrote ${airports.length} airports, ${(json.length / 1024).toFixed(0)} KB raw`);
```

- [ ] **Step 2: Run** `node scripts/gen-airports.mjs` — expected: `wrote ~4xxx airports, ~3xx KB raw`. Spot-check: `node -e "const d=require('./src/assets/airports.json'); console.log(d.airports.find(a=>a[0]==='LHR'), d.airports.find(a=>a[0]==='TOS'))"` → LHR has `Europe/London`, TOS has `Europe/Oslo`.

- [ ] **Step 3: Commit** (script + generated JSON) `git commit -m "Route mode: bundled airport dataset (~4k scheduled-service airports, IATA+tz)"`

### Task B2: `src/lib/airports.js` — search + record synthesis (TDD)

**Files:**
- Create: `src/lib/airports.js`
- Create: `tests/airports.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest';
import { searchAirports, civilToUTC, routeRecord, airportFromRow } from '../src/lib/airports.js';
import data from '../src/assets/airports.json';

const LIST = data.airports;
const find = (iata) => airportFromRow(LIST.find((a) => a[0] === iata));

describe('searchAirports', () => {
  it('exact IATA match ranks first', () => {
    expect(searchAirports(LIST, 'jed')[0][0]).toBe('JED');
  });
  it('city prefix works', () => {
    expect(searchAirports(LIST, 'jeddah').some((a) => a[0] === 'JED')).toBe(true);
  });
  it('caps results', () => {
    expect(searchAirports(LIST, 'a').length).toBeLessThanOrEqual(6);
  });
  it('empty query → empty', () => {
    expect(searchAirports(LIST, ' ')).toEqual([]);
  });
});

describe('civilToUTC', () => {
  it('plain conversion with DST offset (London BST)', () => {
    expect(civilToUTC('2026-06-06', '14:20', 'Europe/London')).toBe(Date.parse('2026-06-06T13:20:00Z'));
  });
  it('winter offset (London GMT)', () => {
    expect(civilToUTC('2026-01-10', '14:20', 'Europe/London')).toBe(Date.parse('2026-01-10T14:20:00Z'));
  });
  it('US spring-forward gap resolves within an hour of intent', () => {
    const ms = civilToUTC('2026-03-08', '02:30', 'America/New_York'); // nonexistent local time
    expect(Math.abs(ms - Date.parse('2026-03-08T07:00:00Z'))).toBeLessThanOrEqual(3600000);
  });
});

describe('routeRecord', () => {
  const LHR = find('LHR'), JED = find('JED'), LAX = find('LAX'), NRT = find('NRT'), PER = find('PER');

  it('reproduces SV124 from its itinerary times', () => {
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '14:20', arrTime: '23:05' });
    expect(r.found).toBe(true);
    expect(r.routeMode).toBe(true);
    expect(r.code).toBe('LHR→JED');
    expect(r.depUTC).toBe('2026-06-06T13:20:00.000Z');
    expect(r.arrUTC).toBe('2026-06-06T20:05:00.000Z');
    expect(r.from.tz).toBe('Europe/London');
    expect(r.from.zone).toBe('BST');
    expect(r.to.gmt).toMatch(/GMT\+3/);
  });
  it('red-eye rolls the arrival to the next day', () => {
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '22:00', arrTime: '04:45' });
    expect(Date.parse(r.arrUTC)).toBeGreaterThan(Date.parse(r.depUTC));
    expect(r.arrUTC.slice(0, 10)).toBe('2026-06-07');
  });
  it('westbound across the date line can land the previous civil day', () => {
    // dep Tokyo 00:30 local 6 Jun (= 5 Jun 15:30Z); arr LA 17:00 local on 5 Jun (= 6 Jun 00:00Z)
    const r = routeRecord({ from: NRT, to: LAX, dateISO: '2026-06-06', depTime: '00:30', arrTime: '17:00' });
    expect(Date.parse(r.arrUTC)).toBeGreaterThan(Date.parse(r.depUTC));
    expect(Date.parse(r.arrUTC) - Date.parse(r.depUTC)).toBeLessThan(20 * 3600000);
  });
  it('long eastbound (LHR→PER style) keeps a sane 17h duration', () => {
    const r = routeRecord({ from: LHR, to: PER, dateISO: '2026-06-06', depTime: '13:00', arrTime: '13:00' });
    expect(Date.parse(r.arrUTC) - Date.parse(r.depUTC)).toBe(17 * 3600000);
  });
  it('flags implausible durations instead of blocking', () => {
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '14:20', arrTime: '14:00' });
    expect(r.durationWarn).toBe(true);   // ~23.7h LHR→JED
  });
  it('the engine accepts the synthesized record verbatim', async () => {
    const { compute } = await import('../src/lib/engine.js');
    const r = routeRecord({ from: LHR, to: JED, dateISO: '2026-06-06', depTime: '14:20', arrTime: '23:05' });
    const m = compute(r, { method: 'isna', madhab: 'shafi' });
    expect(m.prayers.length).toBeGreaterThan(0);
    expect(m.prayers.filter((p) => p.status === 'after')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/airports.test.js` — expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/airports.js`

```js
/* Route mode — airport search + record synthesis.
   Builds the EXACT /api/flight success shape (worker/CONTRACT.md) from the
   bundled dataset + the user's itinerary times, so engine.compute() needs no
   changes and route lookups work fully offline. */

const DAY = 86400000;

// dataset row [iata, city, name, lat, lon, tz] → endpoint-ish object
export function airportFromRow(row) {
  return { iata: row[0], city: row[1], name: row[2], lat: row[3], lon: row[4], tz: row[5] };
}

let _list = null;
export async function loadAirports() {
  if (!_list) {
    const mod = await import('../assets/airports.json');
    _list = (mod.default || mod).airports;
  }
  return _list;
}

/* prefix search over IATA, city, name — dataset is ordered large→small, so
   ties keep the bigger airport first. Exact IATA match always ranks first. */
export function searchAirports(list, q, limit = 6) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  const starts = (v) => v.toLowerCase().startsWith(s);
  const buckets = [[], [], [], []];
  for (const row of list) {
    const [iata, city, name] = row;
    if (iata.toLowerCase() === s) buckets[0].push(row);
    else if (starts(iata)) buckets[1].push(row);
    else if (starts(city)) buckets[2].push(row);
    else if (name.toLowerCase().split(/\s+/).some((w) => w.startsWith(s))) buckets[3].push(row);
    if (buckets[0].length + buckets[1].length >= limit && s.length === 3) break;
  }
  return buckets.flat().slice(0, limit);
}

/* ---- civil time → UTC, DST-correct, via Intl (no tz library) ------------- */
const _parts = {};
function partsFmt(tz) {
  if (!_parts[tz]) _parts[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return _parts[tz];
}
function tzOffsetMs(ms, tz) {                       // local − UTC at this instant
  const p = {};
  partsFmt(tz).formatToParts(new Date(ms)).forEach(({ type, value }) => { p[type] = value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
}
export function civilToUTC(dateISO, hhmm, tz) {
  const wall = Date.parse(dateISO + 'T' + hhmm + ':00Z');   // wall clock read as UTC
  let ms = wall - tzOffsetMs(wall, tz);
  ms = wall - tzOffsetMs(ms, tz);                            // 2nd pass fixes DST-boundary guess
  return ms;
}

function addDaysISO(dateISO, n) {
  const d = new Date(Date.parse(dateISO + 'T12:00:00Z') + n * DAY);
  return d.toISOString().slice(0, 10);
}

// zone/gmt derived exactly as the Worker derives them (CONTRACT.md)
function tzName(ms, tz, style) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: style });
  const part = f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}
const zoneOf = (ms, tz) => tzName(ms, tz, 'short');
const gmtOf = (ms, tz) => tzName(ms, tz, 'shortOffset').replace(/^UTC/, 'GMT') || 'GMT';

const _date = {};
function longDate(ms, tz) {
  if (!_date[tz]) _date[tz] = new Intl.DateTimeFormat('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  return _date[tz].format(new Date(ms));
}

function endpoint(a, ms) {
  return {
    iata: a.iata, city: a.city, airport: a.name,
    lat: a.lat, lon: a.lon, tz: a.tz,
    zone: zoneOf(ms, a.tz), gmt: gmtOf(ms, a.tz)
  };
}

/* The arrival time names a wall clock, not a day — pick the first instant at
   the destination ≥ departure (covers red-eyes and both date-line directions). */
export function routeRecord({ from, to, dateISO, depTime, arrTime }) {
  const dep = civilToUTC(dateISO, depTime, from.tz);
  let arr = null;
  for (const off of [-1, 0, 1, 2]) {
    const c = civilToUTC(addDaysISO(dateISO, off), arrTime, to.tz);
    if (c >= dep) { arr = c; break; }
  }
  return {
    found: true, routeMode: true,
    airline: '—', code: from.iata + '→' + to.iata, aircraft: '—',
    dateISO, date: longDate(dep, from.tz),
    from: endpoint(from, dep),
    to: endpoint(to, arr),
    depUTC: new Date(dep).toISOString(),
    arrUTC: new Date(arr).toISOString(),
    durationWarn: (arr - dep) > 20 * 3600000
  };
}
```

- [ ] **Step 4: Run** `npx vitest run tests/airports.test.js` — expected: PASS (NRT must exist in the dataset; if absent, pick HND in the test). Then full `npm test`.

- [ ] **Step 5: Commit** `git commit -m "Route mode: airport search + DST-correct record synthesis (lib + tests)"`

### Task B3: Route form UI (`src/components/route-form.jsx` + Landing mode switch)

**Files:**
- Create: `src/components/route-form.jsx`
- Modify: `src/components/Calculator.jsx`, `src/components/components.jsx` (FlightSummary), `src/styles/styles.css`

- [ ] **Step 1: `RouteForm` component** — two airport comboboxes, two `type=time` fields, shared date field, live duration line:

```jsx
import React from 'react';
import { loadAirports, searchAirports, airportFromRow, routeRecord } from '../lib/airports.js';
import { Ic } from './components.jsx';
const { useState: useS, useEffect: useE, useRef: useR } = React;

/* ---- one airport combobox ----------------------------------------------- */
function AirportField({ id, label, placeholder, list, value, onPick }) {
  const [text, setText] = useS(value ? `${value.iata} — ${value.city}` : '');
  const [hits, setHits] = useS([]);
  const [open, setOpen] = useS(false);
  const [hi, setHi] = useS(0);
  const wrapRef = useR(null);

  useE(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, []);

  function onInput(v) {
    setText(v); onPick(null);
    const h = list ? searchAirports(list, v) : [];
    setHits(h); setHi(0); setOpen(h.length > 0);
  }
  function pick(row) {
    const a = airportFromRow(row);
    onPick(a); setText(`${a.iata} — ${a.city}`); setOpen(false);
  }
  function onKey(e) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[hi]) pick(hits[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  }
  return (
    <div className="field" ref={wrapRef}>
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input id={id} className="input" type="text" autoComplete="off" spellCheck="false"
               role="combobox" aria-expanded={open} aria-controls={id + '-list'} aria-autocomplete="list"
               placeholder={placeholder} value={text}
               onChange={(e) => onInput(e.target.value)} onKeyDown={onKey}
               onFocus={() => { if (hits.length && !value) setOpen(true); }} />
        {open ? (
          <ul className="ac-list" id={id + '-list'} role="listbox">
            {hits.map((row, i) => (
              <li key={row[0]} role="option" aria-selected={i === hi}
                  className={'ac-item' + (i === hi ? ' hi' : '')}
                  onPointerDown={(e) => { e.preventDefault(); pick(row); }}>
                <b>{row[0]}</b> {row[1]} <span>· {row[2]}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* ---- the route form ------------------------------------------------------ */
function RouteForm({ date, setDate, todayISO, onSubmitRecord }) {
  const [list, setList] = useS(null);
  const [from, setFrom] = useS(null);
  const [to, setTo] = useS(null);
  const [depTime, setDepTime] = useS('');
  const [arrTime, setArrTime] = useS('');
  const [err, setErr] = useS(null);
  useE(() => { let on = true; loadAirports().then((l) => { if (on) setList(l); }); return () => { on = false; }; }, []);

  // live duration preview — the safety net for a wrong-day arrival
  let durLine = null;
  if (from && to && depTime && arrTime && date) {
    const rec = routeRecord({ from, to, dateISO: date, depTime, arrTime });
    const min = Math.round((Date.parse(rec.arrUTC) - Date.parse(rec.depUTC)) / 60000);
    const nextDay = rec.arrUTC.slice(0, 10) !== rec.depUTC.slice(0, 10);
    durLine = `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m flight` +
              (nextDay ? ' · lands the next day' : '') +
              (rec.durationWarn ? ' — over 20 hours, check the arrival time' : '');
  }

  function submit(e) {
    e.preventDefault();
    if (!from || !to) { setErr('Pick both airports from the list.'); return; }
    if (from.iata === to.iata) { setErr('Departure and arrival are the same airport.'); return; }
    if (!depTime || !arrTime) { setErr('Enter the departure and arrival times from your itinerary.'); return; }
    setErr(null);
    onSubmitRecord(routeRecord({ from, to, dateISO: date, depTime, arrTime }));
  }

  return (
    <form className="form" onSubmit={submit}>
      <AirportField id="rt-from" label="From" placeholder="City or airport — LHR, London…"
                    list={list} value={from} onPick={setFrom} />
      <AirportField id="rt-to" label="To" placeholder="City or airport — JED, Jeddah…"
                    list={list} value={to} onPick={setTo} />
      <div className="route-times">
        <div className="field">
          <label htmlFor="rt-dep">Departs <em>local</em></label>
          <input id="rt-dep" className="input compact" type="time" value={depTime}
                 onChange={(e) => setDepTime(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rt-arr">Arrives <em>local</em></label>
          <input id="rt-arr" className="input compact" type="time" value={arrTime}
                 onChange={(e) => setArrTime(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <div className="label-row">
          <label htmlFor="rt-date">Date of departure</label>
          {date !== todayISO() ? (
            <button type="button" className="today-btn" onClick={() => setDate(todayISO())}>Today</button>
          ) : null}
        </div>
        <input id="rt-date" className="input compact" type="date" value={date}
               onChange={(e) => setDate(e.target.value)} />
      </div>
      {durLine ? <div className="duration-line">{durLine}</div> : null}
      {err ? <div className="field-error"><Ic.alert style={{ width: 15, height: 15 }} aria-hidden="true" />{err}</div> : null}
      <button className="btn" type="submit">Find my prayer times <Ic.arrow aria-hidden="true" /></button>
      <div className="offline-note"><Ic.plane aria-hidden="true" /> All on your device — route lookups work offline</div>
    </form>
  );
}

export { RouteForm };
```

- [ ] **Step 2: Landing mode switch in `Calculator.jsx`** — `mode` state persisted as `isfar.lookupMode`; the quiet link toggles; route submissions reuse the loading flow:

```js
  const [mode, setMode] = useS(() => {
    try { return localStorage.getItem("isfar.lookupMode") === "route" ? "route" : "flight"; }
    catch (e) { return "flight"; }
  });
  function switchMode(m) {
    setMode(m); setErr(null);
    try { localStorage.setItem("isfar.lookupMode", m); } catch (e) {}
  }

  // a route record is already resolved — same calm loading dwell, no lookup
  function submitRecord(rec) {
    setQuery(rec.code); setView("loading"); setLoadMsg(0);
    let i = 0;
    const msgInt = setInterval(() => { i = Math.min(i + 1, LOAD_MSGS.length - 1); setLoadMsg(i); }, 620);
    const token = {}; loadTimer.current = token;
    setTimeout(() => {
      clearInterval(msgInt);
      if (loadTimer.current !== token) return;
      setRaw(rec); recordRecent(rec); setView("results");
    }, 1200);
  }
```

In `Landing` (which now receives `mode`, `onSwitchMode`, `onSubmitRecord`, `todayISO`): when `mode === "route"`, render `<RouteForm …/>` instead of the flight form, and swap the link:

```jsx
        {mode === "flight" ? (
          <>
            {/* existing flight form … */}
            <button type="button" className="mode-link" onClick={() => onSwitchMode("route")}>
              No flight number? Enter your route instead
            </button>
          </>
        ) : (
          <>
            <RouteForm date={date} setDate={setDate} todayISO={todayISO} onSubmitRecord={onSubmitRecord} />
            <button type="button" className="mode-link" onClick={() => onSwitchMode("flight")}>
              Have a flight number? Use it instead
            </button>
          </>
        )}
```

Keep recents + sample chips rendered in BOTH modes (below the form/link).

- [ ] **Step 3: `FlightSummary` route variant** (`components.jsx`) — replace the airline/code block when `f.routeMode`:

```jsx
        <div className="flightno">
          {f.routeMode
            ? <><b>Your route</b><span>times as entered</span></>
            : <><b>{f.code}</b><span>{f.airline}</span></>}
        </div>
```

- [ ] **Step 4: CSS additions** (`styles.css`, near the form styles):

```css
.mode-link {
  appearance: none; background: none; border: 0; padding: 2px 0; cursor: pointer;
  font: inherit; font-size: 13.5px; color: var(--text-soft); text-align: center;
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--border);
}
.mode-link:hover { color: var(--accent); text-decoration-color: var(--accent); }
.route-times { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field > label em { font-style: normal; font-weight: 500; color: var(--text-mute); }
.duration-line { font-size: 13px; color: var(--text-soft); text-align: center; font-variant-numeric: tabular-nums; }
.ac-list {
  position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 6px);
  margin: 0; padding: 6px; list-style: none;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  box-shadow: 0 18px 40px rgb(0 0 0 / .25); max-height: 264px; overflow-y: auto;
}
.ac-item {
  padding: 10px 12px; border-radius: 9px; cursor: pointer;
  font-size: 14px; color: var(--text-soft); line-height: 1.35;
}
.ac-item b { color: var(--text); font-weight: 700; letter-spacing: .04em; margin-right: 4px; }
.ac-item span { color: var(--text-mute); font-size: 12.5px; }
.ac-item.hi, .ac-item:hover { background: var(--surface-2); color: var(--text); }
```

- [ ] **Step 5: Run** `npm test && npm run build` — build must succeed (JSON chunk resolves). **Commit** `git commit -m "Route mode: quiet switch link, airport comboboxes, itinerary times, live duration line"`

---

## Workstream C — image export

### Task C1: `src/lib/export-card.js` (TDD on the pure layout)

**Files:**
- Create: `src/lib/export-card.js`
- Create: `tests/export-card.test.js`
- Modify: `src/components/Calculator.jsx` (Results action), `src/components/components.jsx` (Ic.download), `src/styles/styles.css`

- [ ] **Step 1: Failing tests for the pure layout builder** (drawing itself is a thin untested shell — jsdom has no canvas):

```js
import { describe, it, expect } from 'vitest';
import { cardLines } from '../src/lib/export-card.js';
import { compute } from '../src/lib/engine.js';
import { lookup } from '../src/lib/data.js';

const f = compute(lookup('SV124'), { method: 'isna', madhab: 'shafi' });

describe('cardLines', () => {
  const lines = cardLines(f, { method: 'isna', madhab: 'shafi' });
  it('starts with route + date header', () => {
    expect(lines[0]).toEqual({ kind: 'title', text: 'SV124 · LHR → JED' });
    expect(lines[1].kind).toBe('sub');
    expect(lines[1].text).toContain('6h 45m');
  });
  it('has one row per prayer with both zones', () => {
    const rows = lines.filter((l) => l.kind === 'prayer');
    expect(rows).toHaveLength(f.prayers.length);
    const asr = rows.find((r) => r.en === 'Asr');
    expect(asr.right).toMatch(/LHR \d\d:\d\d · JED \d\d:\d\d/);
  });
  it('groups by section', () => {
    const sections = lines.filter((l) => l.kind === 'section').map((l) => l.text);
    expect(sections).toContain('In flight');
  });
  it('estimated prayers carry ~ and the footnote appears only when needed', () => {
    expect(lines.some((l) => l.kind === 'note')).toBe(f.prayers.some((p) => p.estimated));
    const tos = compute(lookup('DY394'), { method: 'isna', madhab: 'shafi' });
    const tl = cardLines(tos, { method: 'isna', madhab: 'shafi' });
    expect(tl.some((l) => l.kind === 'note')).toBe(true);
    const est = tl.find((l) => l.kind === 'prayer' && l.estimated);
    expect(est.right).toContain('~');
  });
  it('footer names the method and the app', () => {
    const foot = lines[lines.length - 1];
    expect(foot.kind).toBe('footer');
    expect(foot.text).toContain('ISNA');
    expect(foot.text).toContain('isfar.app');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/export-card.test.js` — FAIL (module not found).

- [ ] **Step 3: Implement** — `cardLines` (pure) + `drawCard` (canvas) + `exportImage` (share/download):

```js
/* Save-as-image — a purpose-built summary card drawn on canvas.
   cardLines() is the PURE layout model (tested); drawCard() rasterizes it with
   the live theme's tokens; exportImage() delivers via Web Share or download.
   Hand-drawn on purpose: DOM capture hits the known backdrop-filter artifact. */
import { METHODS, META } from './data.js';

const SECTION_LABEL = { before: 'Before departure', inflight: 'In flight', after: 'After arrival' };
const MADHAB_LABEL = { shafi: 'Standard Asr', hanafi: 'Hanafi Asr' };

export function cardLines(f, settings) {
  const dur = `${Math.floor(f.durationMin / 60)}h ${String(f.durationMin % 60).padStart(2, '0')}m`;
  const order = [f.from.iata, f.to.iata];
  const lines = [
    { kind: 'title', text: `${f.code} · ${f.from.iata} → ${f.to.iata}` },
    { kind: 'sub', text: `${f.date} · ${dur} · ${f.from.city} ${f.dep.local} → ${f.to.city} ${f.arr.local}` }
  ];
  for (const status of ['before', 'inflight', 'after']) {
    const items = f.prayers.filter((p) => p.status === status);
    if (!items.length) continue;
    lines.push({ kind: 'section', text: SECTION_LABEL[status] });
    for (const p of items) {
      const t = (z) => `${z.iata} ${p.estimated ? '~' : ''}${z.time}`;
      lines.push({
        kind: 'prayer', en: p.en + (p.seq ? ` (${p.seq})` : ''), ar: p.ar, estimated: p.estimated,
        right: order.map((i) => p.zones[i]).filter(Boolean).map(t).join(' · ')
      });
    }
  }
  if (f.prayers.some((p) => p.estimated)) {
    lines.push({ kind: 'note', text: '~ estimated — the sky here gives the usual angles nothing to mark; see isfar.app/guide' });
  }
  const m = METHODS.find((x) => x.key === settings.method);
  lines.push({ kind: 'footer', text: `${m ? m.label : settings.method} · ${MADHAB_LABEL[settings.madhab] || ''} — isfar.app` });
  return lines;
}

/* geometry per line kind: [topGap, fontPx, weight] */
const KIND = {
  title:   [0, 56, 700],
  sub:     [14, 30, 500],
  section: [44, 26, 700],
  prayer:  [18, 36, 600],
  note:    [36, 26, 500],
  footer:  [44, 26, 600]
};
const W = 1080, PAD = 84, LH = 1.25;

export function drawCard(f, settings, tokens) {
  const lines = cardLines(f, settings);
  let h = PAD;
  const pos = lines.map((l) => {
    const [gap, size] = KIND[l.kind];
    h += gap; const y = h; h += size * LH;
    return y;
  });
  h += PAD;

  const c = document.createElement('canvas');
  c.width = W; c.height = Math.round(h);
  const x = c.getContext('2d');
  x.fillStyle = tokens.bg; x.fillRect(0, 0, W, c.height);
  x.textBaseline = 'top';
  const grot = (w, s) => `${w} ${s}px "Hanken Grotesk", system-ui, sans-serif`;

  lines.forEach((l, i) => {
    const [, size, weight] = KIND[l.kind];
    const y = pos[i];
    if (l.kind === 'prayer') {
      x.font = grot(weight, size);
      x.fillStyle = tokens.text;
      x.fillText(l.en, PAD, y);
      const enW = x.measureText(l.en).width;
      // Arabic: use whichever self-hosted face styles.css declares for .ar
      // (check @font-face at implementation time); system fallback shapes fine
      x.font = `500 ${size * 0.8}px system-ui, sans-serif`;
      x.fillStyle = tokens.mute;
      x.fillText(l.ar, PAD + enW + 18, y + size * 0.1);
      x.font = grot(600, size * 0.92);
      x.fillStyle = l.estimated ? tokens.mute : tokens.text;
      x.textAlign = 'right'; x.fillText(l.right, W - PAD, y + size * 0.06); x.textAlign = 'left';
    } else if (l.kind === 'section') {
      x.font = grot(700, size);
      x.fillStyle = tokens.accent;
      x.fillText(l.text.toUpperCase(), PAD, y);
      x.strokeStyle = tokens.border; x.lineWidth = 2;
      const tw = x.measureText(l.text.toUpperCase()).width;
      x.beginPath(); x.moveTo(PAD + tw + 20, y + size * 0.55); x.lineTo(W - PAD, y + size * 0.55); x.stroke();
    } else {
      x.font = grot(KIND[l.kind][2], size);
      x.fillStyle = l.kind === 'title' ? tokens.text : tokens.mute;
      x.fillText(l.text, PAD, y);
    }
  });
  return c;
}

function themeTokens(el) {
  const s = getComputedStyle(el);
  const v = (n, fb) => (s.getPropertyValue(n) || '').trim() || fb;
  return {
    bg: v('--surface', '#16131f'), text: v('--text', '#fff'),
    mute: v('--text-mute', '#9a93a8'), accent: v('--accent', '#e8a34b'),
    border: v('--border', '#3a3450')
  };
}

export async function exportImage(f, settings, rootEl) {
  try { await document.fonts.load('700 56px "Hanken Grotesk"'); await document.fonts.ready; } catch (e) {}
  const canvas = drawCard(f, settings, themeTokens(rootEl));
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  const name = `isfar-${f.code.replace(/[^A-Za-z0-9]+/g, '-')}.png`;
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'image/png' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try { await navigator.share({ files: [file], title: 'Isfar — ' + f.code }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; /* fall through */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
```

- [ ] **Step 4: Run** `npx vitest run tests/export-card.test.js` — PASS; full `npm test`.

- [ ] **Step 5: Results action** — add `Ic.download` to `components.jsx`:

```jsx
  download: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>),
```

In `Results` (Calculator.jsx): a two-button row replacing the single back button, plus a quiet failure note:

```jsx
function Results({ f, settings, activeKey, selectPrayer, cardRefs, onBack }) {
  const [exportErr, setExportErr] = React.useState(false);
  async function saveImage() {
    setExportErr(false);
    try { await exportImage(f, settings, document.querySelector('.isfar')); }
    catch (e) { console.error('export failed', e); setExportErr(true); }
  }
  /* …existing body…, then: */
      <div className="results-actions">
        <button className="btn" onClick={onBack}><Ic.back style={{width:16,height:16}} aria-hidden="true" /> Look up another flight</button>
        <button className="btn-ghost" onClick={saveImage}><Ic.download style={{width:16,height:16}} aria-hidden="true" /> Save as image</button>
      </div>
      {exportErr ? <div className="field-error">Couldn’t create the image on this browser.</div> : null}
```

Pass `settings` into `Results` from the app shell. Import `exportImage` in Calculator.jsx. CSS:

```css
.results-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
```

- [ ] **Step 6: Run** `npm test && npm run build`. **Commit** `git commit -m "Export: purpose-built canvas card via Web Share / download"`

---

## Workstream D — PWA install nudge

### Task D1: Post-results nudge + iOS instructions sheet

**Files:**
- Modify: `src/components/Calculator.jsx`, `src/components/components.jsx`, `src/styles/styles.css`

- [ ] **Step 1: Capture + eligibility in `Calculator.jsx`**

```js
  // PWA install nudge — captured prompt (Chrome/Android) or iOS instructions
  const [installEvt, setInstallEvt] = useS(null);
  const [nudgeGone, setNudgeGone] = useS(() => {
    try { return localStorage.getItem("isfar.installNudge") === "done"; } catch (e) { return true; }
  });
  const [showIOSHelp, setShowIOSHelp] = useS(false);
  useE(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => dismissNudge();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  function dismissNudge() {
    setNudgeGone(true);
    try { localStorage.setItem("isfar.installNudge", "done"); } catch (e) {}
  }
  const standalone = (typeof window !== "undefined") &&
    ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);
  const isIOS = (typeof navigator !== "undefined") && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const canNudge = !nudgeGone && !standalone && (installEvt || isIOS);
  async function installApp() {
    if (installEvt) {
      installEvt.prompt();
      const { outcome } = await installEvt.userChoice;
      if (outcome === "accepted") dismissNudge();
      setInstallEvt(null);
    } else setShowIOSHelp(true);
  }
```

- [ ] **Step 2: `InstallNudge` + `IOSInstallSheet` in `components.jsx`**

```jsx
function InstallNudge({ onInstall, onDismiss }) {
  return (
    <div className="install-nudge" role="note">
      <Ic.plane aria-hidden="true" />
      <span>Save Isfar to your home screen — saved flights work offline.</span>
      <button type="button" className="nudge-act" onClick={onInstall}>Add</button>
      <button type="button" className="iconbtn nudge-x" onClick={onDismiss} aria-label="Dismiss"><Ic.close aria-hidden="true" /></button>
    </div>
  );
}

function IOSInstallSheet({ open, onClose }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label="Add to Home Screen"
           onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Add to Home Screen</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Ic.close aria-hidden="true" /></button>
        </div>
        <div className="settings-body">
          <ol className="ios-steps">
            <li>Tap the <b>Share</b> button in Safari’s toolbar.</li>
            <li>Scroll and choose <b>Add to Home Screen</b>.</li>
            <li>Tap <b>Add</b> — Isfar opens like an app, and saved flights work offline.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
```

Export both. Render in `Results` view region of the app shell (below `<Results …/>`’s NextPrayer — simplest: pass `nudge` props into `Results` and render the nudge directly above `FlightSummary`); render `<IOSInstallSheet …/>` next to the other sheets.

```jsx
        {view === "results" && canNudge ? <InstallNudge onInstall={installApp} onDismiss={dismissNudge} /> : null}
```

(Placed inside `Results`’ parent fragment, immediately after the `<Results …/>` line is fine — visually it sits below; to sit above, render it before `<Results …/>`. Put it BEFORE `<Results …/>` so it reads as a gentle header note.)

- [ ] **Step 3: CSS**

```css
.install-nudge {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px;
  background: var(--surface); font-size: 13.5px; color: var(--text-soft);
}
.install-nudge > svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--accent); }
.install-nudge span { flex: 1; }
.nudge-act {
  appearance: none; border: 1px solid var(--border); border-radius: 999px;
  background: var(--surface-2); color: var(--text); font: inherit; font-size: 13px;
  font-weight: 600; padding: 6px 14px; cursor: pointer;
}
.nudge-act:hover { border-color: var(--accent); color: var(--accent); }
.nudge-x { width: 30px; height: 30px; }
.ios-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; font-size: 14.5px; color: var(--text-soft); }
.ios-steps b { color: var(--text); }
```

- [ ] **Step 4: Run** `npm test && npm run build`. **Commit** `git commit -m "PWA: post-results install nudge (native prompt / iOS instructions), shown once"`

---

## Final verification & ship

- [ ] **V1:** `npm test` (full) → `npm run build` → `npm run preview`.
- [ ] **V2: Playwright walkthrough** on the preview URL: sample chip → results (saved-note, nudge logic, Save-as-image triggers a download); route mode (switch link → type `jed` → pick → times → duration line → results shows "Your route"); Today chip appears after changing the date and resets; recents row shows `LHR → JED · 6 Jun` style labels; reload → recents survive; **offline emulation** → tap a saved flight → results render with zero network.
- [ ] **V3: Screenshot** the export card output (download the PNG in Playwright, read it back) — confirm legible layout in both themes.
- [ ] **V4: Update docs:** CLAUDE.md file map (new modules: `recents.js`, `airports.js`, `export-card.js`, `route-form.jsx`, `scripts/gen-airports.mjs`, dataset) + sample-flights section note that route mode exists; check off the spec.
- [ ] **V5: Ship:** `git fetch origin && git rebase origin/main` (re-run `npm test && npm run build` after rebase — other instances are active), then push the branch onto `main` (`git push origin HEAD:main`). Auto-deploy runs from the push.
