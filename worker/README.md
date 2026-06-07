# Isfar flight-lookup Worker

A Cloudflare Worker that serves `GET /api/flight?code=&date=` for the Isfar app.
It maps an [AeroDataBox](https://aerodatabox.com/) flight segment to the exact
record `engine.compute()` already consumes — so wiring the real API needs **no
changes** to `app.jsx` or `engine.js`. The request/response shape is frozen in
[`../worker/CONTRACT.md`](./CONTRACT.md).

```
GET /api/flight?code=SV124&date=2026-06-06
  -> 200  { found:true, airline, code, aircraft, dateISO, date, from, to, depUTC, arrUTC }
  -> 404  { found:false, error:"notfound", code }   // unknown flight / missing coords|tz
  -> 503  { found:false, error:"busy" }              // daily ceiling hit, rate-limited, or upstream failure
```

A debug header `X-Isfar-Cache: hit|miss` is set on every response so QA can
confirm KV behaviour.

## Layout

| File | Role |
|---|---|
| `src/index.js` | Worker entry. Normalize → resolve date → KV read-through → abuse scaffolding → AeroDataBox → map → KV write → return. |
| `src/map.js` | **Pure** `mapFlight(segment)` — the whole field-provenance table, no network/env. Unit-tested offline. |
| `test/map.test.mjs` | `node --test` suite; feeds a documented AeroDataBox SV124 segment through `mapFlight()` and asserts the fixture shape. |
| `fixtures/` | `SV124.json` (success) + `notfound.json` — the client lane develops against these. |
| `wrangler.toml` | Bindings, vars, and TODO placeholders (KV id, route/domain, secrets). |

## Tests (offline, no key needed)

```bash
cd worker
npm test
#   or, equivalently, any of:
node --test                  # auto-discovers worker/test/*.test.mjs
node --test "test/*.mjs"     # glob form
node --test test/map.test.mjs
```

> Note: `node --test test/` (a bare directory with a trailing slash) is treated
> as a module path by this Node version and fails — use the glob or auto-discover
> forms above.

The suite asserts the mapped record equals `fixtures/SV124.json` (lat/lon within
float tolerance; `tz`/`iata`/`depUTC`/`arrUTC`/`zone`/`gmt` exact) and covers the
missing-location / missing-tz → `notfound` paths.

## One-time setup (orchestrator, once the account + key exist)

1. **KV namespace** — create and paste the ids into `wrangler.toml`:
   ```bash
   wrangler kv namespace create FLIGHT_CACHE
   wrangler kv namespace create FLIGHT_CACHE --preview
   # -> copy the printed id / preview_id into the [[kv_namespaces]] block
   ```

2. **Secrets** — set via `wrangler secret put` (never committed):
   ```bash
   wrangler secret put RAPIDAPI_KEY       # AeroDataBox key (required)
   wrangler secret put TURNSTILE_SECRET   # OPTIONAL — omit to launch without Turnstile
   wrangler secret put SESSION_HMAC_KEY   # reserved for Wave-1 signed sessions (not yet read)
   ```

3. **Route / custom domain** — uncomment the `[[routes]]` block in
   `wrangler.toml` (or bind in the dashboard) so `/api/*` is same-origin with
   Pages. Same-origin is what lets the service worker cache `/api/flight`
   responses for offline re-display of saved flights.

4. **Native per-IP rate limit** — dashboard → Security → WAF → Rate limiting:
   `http.request.uri.path eq "/api/flight"`, **30 req / 60 s per IP**, block 60 s.
   (The in-code `CEILING` is a separate total-daily-spend guard.)

5. **Deploy**
   ```bash
   wrangler deploy        # from worker/
   ```

## Abuse protection (three independent layers)

| Layer | Where | Guards |
|---|---|---|
| Native rate-limit rule | Cloudflare WAF (config) | per-IP burst |
| `CEILING` daily counter | `src/index.js` + KV `upstream:count:{date}` | total RapidAPI spend/day → `busy` |
| Turnstile | `verifyTurnstile()`, cache-miss only | per-session; **no-op until `TURNSTILE_SECRET` set** |

## Wave-1 validation checklist (run the instant the key lands)

Hit the deployed Worker for each sample flight and confirm the mapped record
matches what `engine.compute()` expects (the placeholders in `data.js`):

- [ ] **SV124** LHR→JED — baseline; crosses dusk. Compare to `fixtures/SV124.json`.
- [ ] **QF10** LHR→PER — 2-day eastbound; confirm `dateISO` is origin-local and
      `to.zone` derives to **AWST**, `to.gmt` **GMT+8**.
- [ ] **EK215** DXB→LAX — westbound stretched day; confirm `to.zone` **PDT/PST**
      (DST-dependent), `from.zone` **GST**.
- [ ] **DY394** OSL→TOS — midnight-sun; confirm `from/to.zone` **CEST/CET**; the
      no-sunset handling is the engine's, the record just needs valid coords/tz.
- [ ] **BA286** — this is an **SV124 codeshare**; AeroDataBox may return it under
      the operating carrier. Confirm `pickSegment()` selects the operating
      segment and the record still resolves (or document the codeshare behaviour).

For each: verify `X-Isfar-Cache: miss` on the first call, `hit` on the second,
and that a bad code (e.g. `ZZ999`) returns **404 `notfound`**.

## Assumptions to confirm in Wave-1 (AeroDataBox live shape)

These are authored against AeroDataBox's *documented* shape; live data must confirm:

1. **Top-level is an array** of segments. `fetchAeroDataBox()` also tolerates a
   `{flights:[...]}` envelope and a single bare object, but the array form is assumed.
2. **`scheduledTime.utc`** parses to a real instant from `"YYYY-MM-DD HH:mmZ"`
   (we also accept full ISO). `scheduledTime.local` begins `YYYY-MM-DD` for `dateISO`.
3. **`airport.location.{lat,lon}`** is present with `withLocation=true`. If absent
   for either endpoint we return `notfound` (the engine would NaN otherwise).
4. **`airport.timeZone`** is an IANA id. Required; missing → `notfound`.
5. **`zone` short-label derivation:** ICU on Workers (like Node here) returns a
   `GMT±N` string for zones with no CLDR short abbreviation (e.g. Asia/Riyadh →
   `GMT+3`). We synthesise the abbreviation from the *long* name's initials
   ("Arabian Standard Time" → **AST**), and use the genuine short name when ICU
   has one ("British Summer Time" → **BST** via `en-GB`). Confirm these labels
   read well for the live destinations.

## Known fixture discrepancy (flag for orchestrator)

`fixtures/SV124.json` has `"date": "Friday, 6 June 2026"`, but **2026-06-06 is a
Saturday**. Per the contract, `date` is *derived* from `dateISO` via Intl
`en-GB`, so the Worker correctly emits **"Saturday, 6 June 2026"**. The test
asserts the correct derivation, not the fixture's hand-typed weekday. Consider
fixing the weekday in the fixture (client lane owns that file).
