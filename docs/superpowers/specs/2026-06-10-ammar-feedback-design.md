# Ammar feedback round — design

**Date:** 2026-06-10 · **Status:** approved (user waived final review; recommended options chosen throughout)

User feedback (Ammar) distilled into four items, plus one bug found during exploration:

1. Look up prayer times by **departure city, time, and arrival city** — not just flight number.
2. An **easy way to save results offline** ("browsers offload memory"; "maybe even a screenshot").
3. **Future arrival prayer times** to decide pray-aloft vs. pray-at-destination.
4. The date widget has **no obvious "today"**.
5. (Found, not reported) Offline replay of a saved flight can return **the wrong flight** from the SW cache.

Decisions below were each chosen interactively by the user from presented alternatives.

---

## 1. Route mode — lookup by city + time

The engine never needed a flight number: `compute()` consumes only `from/to {iata, city, lat,
lon, tz}` + `depUTC/arrUTC`. Route mode is pure input + data; **engine and Worker are untouched**.

### Input shape (chosen: both times, exact)

Origin, destination, departure time, arrival time — all local, all printed on every
itinerary/boarding pass. No estimated arrivals (honest-copy rule), no flight API.

### Airport data (chosen: bundled dataset)

- New checked-in `src/assets/airports.json`: airports with scheduled service and an IATA code
  (~4k rows), each `[iata, city, name, lat, lon, tz]` (~100–150 KB gzipped).
- Generated once by `scripts/gen-airports.mjs` from public upstream data (OurAirports airport
  list joined with an IANA-tz-per-airport source such as mwgg/Airports). **The output is
  committed**; builds never touch the network. The script documents its sources and is rerun
  manually if the dataset ever needs refreshing.
- Lazy-loaded (dynamic `import()`) only when route mode opens; it ships in `dist/` so
  `gen-sw-precache.mjs` precaches it → **route mode works fully offline**.

### UI (chosen: quiet switch link)

- `Landing` gains `mode: "flight" | "route"`, last choice persisted (`isfar.lookupMode`).
- Under the flight form: small link "No flight number? Enter your route instead" — swaps the
  form; the inverse link swaps back. The single-input hero stays the visual center.
- Route form fields: **From** / **To** (combobox: prefix search over IATA, city, airport name —
  instant, local), **Departs** (origin-local `type=time`), **Arrives** (destination-local
  `type=time`), **Date** (origin-local, defaults today, same Today chip as §5).
- A live computed duration line under the fields ("6h 45m") so a wrong-day arrival is visible
  before submitting.

### Record synthesis (new `src/lib/airports.js`)

- `searchAirports(q)` — prefix match over the bundled list (IATA exact > city > name), capped
  results for the combobox.
- `routeRecord({from, to, dateISO, depTime, arrTime})` → the exact `/api/flight` success shape:
  - `depUTC` = dateISO + depTime interpreted in origin tz (DST-correct civil→UTC conversion).
  - `arrUTC` = arrTime in destination tz, on the **first day whose instant ≥ depUTC** (handles
    red-eyes and date-line crossings; scheduled flights >24 h don't exist; the live duration
    line is the safety net).
  - `zone`/`gmt` derived via `Intl` exactly as the Worker derives them (`CONTRACT.md`).
  - `airline`/`aircraft` = "—", `code` = `"LHR→JED"` style; `found: true`.
- `FlightSummary` shows "LHR → JED · Your route · times as entered" when the record is
  route-sourced (flag: `routeMode: true` on the record) instead of airline · aircraft.

### Errors

- Unresolved airport field → inline field error (reuse `field-error` pattern).
- Same airport both ends → inline error.
- Duration > 20 h → soft inline warning ("check the arrival day/time"), does not block.

## 2. Offline trust — recents v2, SW fix, persistence, PWA nudge

### Recents v2 (store the record, not the code)

- `isfar.recents` entries gain `rec` — the full lookup/synthesized record. Tap → `compute()`
  directly from `rec`: instant, zero network, works in airplane mode by construction.
- Legacy code-only entries are kept and replayed via network as today (graceful migration).
- Route lookups save under their `LHR→JED` code; dedup key = `code + dateISO`.
- After the first successful save, request `navigator.storage.persist()` once — asks the
  browser not to evict (Ammar's exact fear).

### SW cache-matching fix (`public/sw.js`)

`caches.match(req, { ignoreSearch: true })` in the offline fallback can return **any** cached
`/api/flight?...` response for any flight. Fix: exact-match first; apply `ignoreSearch` only
when the URL path does not start with `/api/`. (Recents v2 makes replay independent of this
path, but wrong-flight-from-cache remains a correctness bug for direct offline lookups.)

### Saved-flights reframe (chosen: reframe + results confirmation)

- Recents block retitled **"Saved flights · work offline"**; each row shows route + date.
- Results screen gets a quiet one-liner near the summary: "Saved on this device — available
  offline" — the guarantee is learned at the moment it's created.

### PWA install nudge (chosen: post-results, once)

- A dismissible note on the results screen, shown once (`isfar.installNudge` persisted):
  "Save Isfar to your home screen — saved flights work offline."
- Tap → captured `beforeinstallprompt` on Chrome/Android (native install); on iOS Safari a
  short instructions sheet (Share → Add to Home Screen). Hidden entirely when already
  standalone (`display-mode: standalone` / `navigator.standalone`) or when neither path
  applies.

## 3. Image export — purpose-built canvas card (chosen over DOM snapshot)

- "Save as image" action on the results screen.
- Hand-drawn offscreen `<canvas>` (1080 px wide; height fits content), new module
  `src/lib/export-card.js`: route + date + duration header; Before / In-flight / After
  sections; one row per prayer (EN + AR name, `~` marks, both zone times with IATA); the
  estimate footnote when any `~` exists; method + `isfar.app` footer. Theme tokens resolved
  from the live CSS variables so the card matches the user's theme.
- Fonts: the already-self-hosted faces via `document.fonts.load` before drawing.
- Delivery: `navigator.share({files})` when `canShare` allows (iOS → Photos etc.); otherwise
  `<a download="isfar-SV124.png">`. Failure → quiet inline error note, no modal.
- No new dependency; the known `backdrop-filter` artifact is avoided by construction.

## 4. After-arrival cards — no product change

Exploration disproved "After arrival is only shown sometimes": the engine always emits exactly
`AFTER_CAP = 2` after-prayers (verified on all four samples). User chose to keep cards as-is
with no extra sublines. We add an **engine invariant test** — every computed flight has exactly
2 `after` entries — so it can't regress silently.

## 5. Date field — today by default + reset chip

- Replace the hardcoded `useS("2026-06-06")` default in `Calculator.jsx` with the device's
  current date.
- A small "Today" text-button appears beside the date input **only when** the value differs
  from today; tap resets. Applies to both lookup modes.

---

## Testing

- **Vitest:** `routeRecord` synthesis (DST edges, red-eye day-roll, date-line crossing, >20 h
  warning flag); airport search ranking; recents v2 shape + legacy migration; the
  after-cap=2 invariant over the randomized-flight suite.
- **Playwright (preview):** route-mode happy path (type, pick, times, results); Today chip
  appears/resets; export action yields a PNG blob/download; nudge show-once/dismiss logic;
  offline replay of a saved flight under offline emulation.
- Standard gate: `npm test` → `npm run build` → `npm run preview` + Playwright.

## Build order (each independently shippable)

1. **Quick wins:** today default + Today chip · recents v2 + persist() · SW fix · saved-flights
   reframe + results confirmation · after-cap test.
2. **Route mode:** dataset + script · airports.js · Landing mode switch + combobox · summary
   copy.
3. **Export card.**
4. **PWA nudge.**
