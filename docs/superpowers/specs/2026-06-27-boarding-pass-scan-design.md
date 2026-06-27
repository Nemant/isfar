# Scan boarding pass → auto-lookup

**Date:** 2026-06-27
**Status:** Design — awaiting review
**Scope:** Add an on-device camera scan of a boarding-pass barcode that resolves a
flight and shows its prayer times. PWA-only; no native app, no share-sheet, no
Wallet integration.

## Why

The single highest-friction step in Isfar is typing the flight number and date.
A boarding pass already encodes both (plus the route) in its PDF417 barcode. A
camera scan turns "open app → type flight → set date → submit" into "open app →
point at pass."

## Hard constraints established up front (honest framing)

These shaped the scope and are recorded so they aren't re-litigated:

- **No app can read passes already in Apple Wallet or Google Wallet.** Both wallets
  are sandboxed by design — an app only sees passes it added itself, never another
  airline app's. There is no "enumerate Wallet passes" API on either platform.
  True for native apps too. So the only way in is the user pointing a camera at a
  barcode (paper, PDF, or another phone's screen).
- **iOS Safari has no `BarcodeDetector`.** Since the audience skews iOS, a JS
  decoder (`@zxing/library`) is the primary path on iPhone, not a fallback.
- **The barcode carries no year and no times.** BCBP encodes day-of-year only, and
  no departure/arrival clock times. This drives the year-resolution rule and the
  route-mode behavior below.

## Out of scope (YAGNI)

Share-sheet ingestion of `.pkpass`/PDF, Apple/Google Wallet pass generation,
native (Capacitor) wrap, Live Activities / Dynamic Island, push reminders,
reading passes from Wallet (impossible regardless).

## Architecture — three isolated units

### 1. `src/lib/bcbp.js` — pure BCBP parser (the testable core)

```
parseBCBP(raw: string) -> { code, dateISO, fromIata, toIata } | null
```

Boarding passes encode the IATA **BCBP "M"** string. The mandatory unique +
first-leg fields sit at fixed 1-based byte offsets:

| Field | Offset | Notes |
|---|---|---|
| Format code | 1 | must be `M`, else return `null` |
| Number of legs | 2 | first leg only is used |
| Passenger name | 3–22 | ignored |
| ET indicator | 23 | ignored |
| Operating carrier PNR | 24–30 | ignored |
| From airport | 31–33 | → `fromIata` |
| To airport | 34–36 | → `toIata` |
| Operating carrier | 37–39 | trimmed |
| Flight number | 40–44 | leading zeros stripped; any alpha suffix kept |
| Julian date of flight | 45–47 | day-of-year, 1–366 |

- **`code`** = carrier (trimmed) + flight number (leading zeros stripped). Example:
  carrier `"BA "`, flight `"0286 "` → `"BA286"`. This is the *operating* carrier's
  number (a codeshare scans as the operating flight, not the marketed one — a noted,
  accepted surprise).
- **`dateISO`** — Julian day → the **soonest occurrence ≥ today** (current year, or
  next year if that day already passed). Leap-year-aware via real `Date` arithmetic.
  Matches the app's "date defaults to today" behavior.
- **Multi-leg passes** → first leg (the departing flight).
- Returns `null` on length < 60, format code ≠ `M`, or malformed IATA/flight fields.
- Pure, no DOM — this is where correctness risk lives, so it is unit-tested heavily.

### 2. `src/lib/scan.js` — camera decoder (lazy-loaded)

```
scanBarcode(videoEl: HTMLVideoElement, signal: AbortSignal) -> Promise<string>
```

- Acquires the rear camera: `getUserMedia({ video: { facingMode: 'environment' } })`.
- Decodes with native `BarcodeDetector({ formats: ['pdf417'] })` when present
  (Android Chrome); otherwise dynamically `import('@zxing/library')` and runs its
  PDF417 reader (the iOS path).
- `signal` aborts the decode loop and tears down the camera stream (sheet close /
  timeout / unmount).
- Lazy chunk, imported only when the sheet opens — same pattern as `airports.json`.
  Picked up automatically by `gen-sw-precache.mjs` from the build output, so it is
  precached for offline.
- **All decoding is on-device; nothing is uploaded.** (Honest copy point shown to
  the user.)

### 3. `ScanSheet` (in `src/components/components.jsx`) — the camera UI

- **Full-screen camera overlay** — the only ergonomic surface for aiming at a
  barcode. Edge-to-edge `<video>`, a centered framing guide, helper line
  ("Point at the barcode on your boarding pass"), and a cancel ✕ (top-left).
- Scrolls behind iOS translucent bars like the rest of the app (no `theme-color`,
  `position: absolute` discipline preserved — see CLAUDE.md iOS notes).
- Owns nothing but presentation + lifecycle: opens, calls `scanBarcode`, and on a
  decode closes and hands the **raw string** up to `Calculator`.

## Entry points

A ghost **"Scan boarding pass"** button (camera icon) directly **below the primary
"Find my prayer times" button in both forms**:

- `Landing` flight-number form (`Calculator.jsx`).
- `RouteForm` (`route-form.jsx`).

Feature-detected: hidden entirely when neither `BarcodeDetector` nor `getUserMedia`
is available. `Calculator` owns the sheet open state (`showScan`) and the decode
handler; both forms call a passed-in `onScan` to open it.

## Data flow & behavior

On a successful decode, `Calculator` runs `parseBCBP(raw)`, then branches on the
**current mode**:

- **Flight mode** → `runFlightLookup(code, dateISO, false)` (existing entry point,
  `Calculator.jsx:251`) → loading → results. **Auto-submit** straight to results
  (per decision); a misread surfaces as the normal "flight not found" error.
- **Route mode → smart:**
  - **Online** (`navigator.onLine`) → do the flight-number lookup (same as flight
    mode, auto-submit to results). Richer answer, and the barcode has the flight#.
  - **Offline** → prefill **From + To + date** into the route form from the
    barcode; the user still types departure/arrival times (the barcode has none),
    then submits. Keeps route mode's offline purpose intact.
  - `navigator.onLine` is the signal; if it claims online but the lookup finds
    nothing (e.g. captive Wi-Fi), the normal error state handles it. Accepted.

If `parseBCBP` returns `null`, show the "couldn't read" error in the sheet (below).

### RouteForm prefill plumbing

`RouteForm` currently resolves `prefill` once on mount (`route-form.jsx:81–98`),
so a post-mount scan can't use that path as-is. Extend it to react to a **changing**
`prefill` (keyed by a nonce/id bumped on each scan): an effect resolves the scanned
`from`/`to` against the loaded airport list and sets `from`/`to`/`date`. The
existing mount-time `?from=&to=` deep-link path stays unchanged.

## Error states (calm copy; reuse existing error visual language)

- **No camera / unsupported** → entry button hidden (feature-detected).
- **Permission denied** → in-sheet note: "Camera access is needed to scan — you can
  still type the flight number."
- **No barcode read within ~15 s** → "Couldn't read the barcode. Try better light,
  or enter the flight number."
- **Decoded but not a boarding pass** (`parseBCBP` → `null`) → same "couldn't read"
  message.

## Testing

- **`tests/bcbp.test.js`** (tests first, per project convention): real-world BCBP
  strings across multiple airlines; multi-leg pass → first leg; leading-zero flight
  numbers; alpha-suffixed flight numbers; year rollover (a Dec day-of-year scanned
  in Jan, and vice-versa); leap-year day 366; malformed / non-`M` / too-short input
  → `null`. This is the behavioral oracle for the feature.
- **Camera + zxing path**: cannot be automated (Playwright can't drive a phone
  camera). Requires **manual verification on a real installed iPhone PWA and an
  Android device** — explicitly part of the acceptance check, not skippable.

## Risks (on record)

- **iOS PWA camera**: `getUserMedia` works in iOS Safari and recent standalone
  PWAs, but has historically been flaky in home-screen mode — must verify on a real
  installed iPhone PWA.
- **`@zxing/library` weight (~200 KB)**: mitigated by lazy-load behind the button;
  zero cost until tapped. Confirm the chunk is lazy and precached, not pulled into
  the main bundle.
- **Codeshare numbers**: the pass carries the operating carrier's flight number,
  which may differ from the user's booking reference. Correct, but can surprise.
- **PDF417 decode reliability** under poor light / glare on glossy passes — the
  ~15 s timeout + "type it instead" fallback keeps this from being a dead end.
