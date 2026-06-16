# Shareable, offline-first results + back button — design

**Date:** 2026-06-16
**Status:** approved (brainstorm), pre-implementation
**Sub-project B** of the analytics/observability workstream (build order: **B → A → C**).

## Problem

The calculator is a single `client:only` React island on `/`. The whole flow
(landing → loading → results) runs **without any URL change**, so:

- There is no way to **share** or **bookmark** a result.
- The browser **back button** doesn't return from a result to the landing screen
  (only the in-app Home control does).

We want shareable result links and a working back button **without** regressing
the two things this project guards hardest: the **`client:only` / no-SSR**
rendering model (a prior Astro port was reverted over hydration/FOUC) and the
**offline experience** (saved flights replay with zero network).

## Approach (chosen)

**Encode result state in the query string of the root path** and drive it with
the History API from inside the existing island. No new server-rendered pages,
no Worker change, no SEO/404 impact.

Rejected alternatives:
- *Server-rendered result pages* — breaks SSG/`client:only`, breaks offline
  (results need client-side adhan compute), re-introduces hydration risk, and
  collides with the existing `/prayer-times/[route]` SEO pages. Rejected.
- *Pretty `/r/...` path URLs* — would 404 on refresh/share unless the
  assets-only static Worker is converted to a code Worker with SPA-fallback,
  which also clobbers the styled `404.astro`. Not worth it. Rejected.

### URL scheme (extends the existing `?from=&to=` deep-link convention)

The island already reads `?from=LHR&to=JED` to **prefill** route mode
(`URL_PREFILL`, `Calculator.jsx:20`). We extend the same convention so a URL
that carries the *full* itinerary **reconstructs the result** instead of merely
prefilling the form:

| Mode | URL (on `/`) | Reconstruct via |
|---|---|---|
| Flight | `?flight=SV124&date=YYYY-MM-DD` | `lookupRemote(code, date)` (cache-first) |
| Route | `?from=LHR&to=JED&date=YYYY-MM-DD&dep=HH:MM&arr=HH:MM` | `routeRecord({from,to,dateISO,depTime,arrTime})` |

- `date` is the **departure** date (`dateISO`); `dep`/`arr` are civil wall-clock
  `HH:MM` in the origin/destination zones — exactly `routeRecord`'s inputs
  (`airports.js:111`).
- Calc **method/madhab are deliberately NOT in the URL** — the recipient's own
  persisted `isfar.settings` apply; `compute()` already re-derives from settings.
- Back-compat: a URL with only `from`/`to` (no `dep`/`arr`) keeps today's
  prefill-only behavior.

### Behavior

**Writing the URL (entering a result):**
- On every transition into the `results` view (`submit`, `submitRecord`,
  `openRecent`), `history.pushState(null, "", urlForRecord(raw))`.
- `urlForRecord` builds the query from the resolved `raw` record:
  - flight: `?flight=<code>&date=<dateISO>`.
  - route (`raw.routeMode`): derive `dep`/`arr` `HH:MM` by formatting
    `raw.depUTC`/`raw.arrUTC` in `raw.from.tz`/`raw.to.tz`, plus
    `from`/`to`/`date`. (Round-trips cleanly back through `routeRecord`.)
- **Must pass a string URL, not a `URL` object** — the Cloudflare Web Analytics
  beacon (sub-project A) has a documented bug where its `pushState` override
  chokes on a `URL` object.

**Back button (leaving a result):**
- A single `popstate` listener: when the island is showing a result and the user
  goes back, route to the `landing` view (reuse `goHome`'s state reset but
  **without** pushing/replacing history — the pop already moved it).
- `goHome` (the in-app Home control) calls `history.pushState`/`replaceState`
  back to a clean `/` so the in-app control and the browser button stay in sync.

**Bootstrap (loading a shared/refreshed URL) — cache-first:**
On mount, parse `window.location.search`:
1. **Route params present** (`from`,`to`,`dep`,`arr`) → lazy-import the airports
   dataset (same path `RouteForm` already uses), look up both airports by IATA,
   build the record with `routeRecord()`, go straight to `results`. **Fully
   offline for anyone** — route mode is pure client compute, no network ever.
2. **Flight params present** (`flight`) → run the existing `submit`-style flow:
   `lookupRemote` resolves **local-first** (the `recents` full-record store and
   the SW-cached `/api/flight` response both serve offline) and only hits the
   network on a true miss. This preserves offline replay as the fast path.
3. **Neither** → normal landing (or legacy `from`/`to` prefill).
- Bootstrap replaces (not pushes) the entry so the first Back exits to landing,
  not to a duplicate of the same result.
- Honesty note (unchanged copy): a **flight** link opened on someone else's
  device with no signal and no cache cannot resolve — we already tell users
  lookups need signal. **Route** links have no such limitation.

**Share affordance:**
- A "Share" control on the Results view: `navigator.share({ url })` when
  available (mobile), else copy-to-clipboard with a brief "Link copied"
  confirmation. Sits alongside the existing "Save as image" (`export-card.js`).
- Shares the current `urlForRecord(raw)` (absolute, `location.origin`-based).

## Files touched

- `src/components/Calculator.jsx` — `urlForRecord()`, push on result-entry,
  `popstate` listener, mount-time bootstrap (extends `URL_PREFILL`), `goHome`
  history sync. The existing `URL_PREFILL` block is widened, not duplicated.
- `src/components/cards.jsx` or `components.jsx` — the Share button in Results
  (placed with the existing export/save affordance; match its styling).
- Possibly a small `src/lib/share-url.js` — pure `recordToParams(raw)` /
  `paramsToRecord(params, airports)` so the URL encode/decode is unit-testable
  in isolation (preferred: keeps `Calculator.jsx` thin and gives a clean test
  surface).

## Testing (TDD)

- **Pure round-trip unit tests** (`tests/share-url.test.js`): for the sample
  flights and a synthetic route itinerary, `recordToParams(raw)` →
  `paramsToRecord(...)` reproduces an equivalent record (and `compute()` of the
  round-tripped record matches `compute()` of the original — same prayer `ms`).
- **Route offline reconstruction**: `paramsToRecord` for a route URL yields the
  same record `routeRecord` produces from the form inputs.
- **Playwright (preview)**: (1) run a sample flight → URL gains `?flight=…`;
  reload → same result renders. (2) Browser back → landing. (3) Route lookup →
  URL gains `?from&to&dep&arr`; open that URL in a fresh context **offline**
  (DevTools offline) → result renders. (4) Share button copies the URL.

## Out of scope

- Pretty path URLs / SPA-fallback Worker.
- Encoding calc method/madhab in the URL.
- Any analytics event (sub-project A owns the beacon; no client event per the
  brainstorm).
