# `/api/flight` — frozen contract (v1)

This is the **single source of truth** for the request/response shape of the flight-lookup
endpoint. The Worker lane implements *to* this; the client lane develops *against* the mock
fixtures in `worker/fixtures/`. Neither lane needs the other to make progress. Do not change this
shape without updating both lanes + the fixtures in the same commit.

The response **success** shape is byte-for-byte the record `engine.compute()` already consumes
today (see `data.js` placeholder records + `engine.js:170-292`), so wiring the real API requires
**no changes to `app.jsx` or `engine.js`**.

---

## Request

```
GET /api/flight?code=<flightNo>&date=<YYYY-MM-DD>
```

| Param | Required | Notes |
|---|---|---|
| `code` | yes | Flight number. Normalized server-side exactly like `data.js:82`: `toUpperCase().replace(/[^A-Z0-9]/g,"")`. |
| `date` | no | Departure date in the flight's **origin local** timezone. If omitted, the Worker resolves to the **next scheduled departure ≥ now** and echoes the chosen date back in `dateISO`. |

Optional header (Phase A3, may be absent at launch):

| Header | Notes |
|---|---|
| `CF-Turnstile-Token` | Turnstile token, verified only on cache-miss. Omitted when Turnstile is deferred. |

Responses are `application/json`. A debug header `X-Rihla-Cache: hit|miss` is set so QA can confirm
KV behavior.

---

## Response — success (HTTP 200)

```jsonc
{
  "found": true,
  "airline": "Saudia",            // string
  "code": "SV124",                // normalized, no spaces
  "aircraft": "Boeing 787-9",     // string; "—" if upstream omits it
  "dateISO": "2026-06-06",        // resolved departure date, origin-local (YYYY-MM-DD)
  "date": "Friday, 6 June 2026",  // human string, derived in-Worker via Intl
  "from": {
    "iata": "LHR",                // 3-letter (or ICAO fallback)
    "city": "London",             // municipalityName; fallback to airport short name
    "airport": "Heathrow",        // short, "Airport" suffix stripped for the calm label
    "lat": 51.4700,               // REQUIRED — engine NaNs without it
    "lon": -0.4543,               // REQUIRED
    "tz": "Europe/London",        // REQUIRED — IANA tz
    "zone": "BST",                // DERIVED via Intl timeZoneName:'short' at the dep instant
    "gmt": "GMT+1"                // DERIVED via Intl timeZoneName:'shortOffset'
  },
  "to": {
    "iata": "JED",
    "city": "Jeddah",
    "airport": "King Abdulaziz",
    "lat": 21.6796,
    "lon": 39.1565,
    "tz": "Asia/Riyadh",
    "zone": "AST",
    "gmt": "GMT+3"
  },
  "depUTC": "2026-06-06T13:20:00Z", // strict ISO-8601 Z (Date.parse-safe, engine.js:173)
  "arrUTC": "2026-06-06T20:05:00Z"
  // cruiseAltFt: OMITTED on purpose — engine defaults to 38000 (engine.js:257,290).
  //             Only include if a real per-flight altitude is available.
}
```

### Field provenance (AeroDataBox → record)

| Field | Source | Notes |
|---|---|---|
| `airline` | `airline.name` | |
| `code` | `number` | strip the space: `"SV 124"`→`"SV124"` |
| `aircraft` | `aircraft.model` | may be missing → `"—"` |
| `from/to.iata` | `*.airport.iata` | ICAO fallback if no IATA |
| `from/to.city` | `*.airport.municipalityName` | fallback short name |
| `from/to.airport` | `*.airport.shortName`/`name` | strip trailing "Airport" |
| `from/to.lat/lon` | `*.airport.location.lat/lon` | **requires `withLocation=true`**; missing ⇒ `notfound` |
| `from/to.tz` | `*.airport.timeZone` | IANA; missing ⇒ `notfound` |
| `from/to.zone` | **derived** | `Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'short'})` at the instant |
| `from/to.gmt` | **derived** | from `timeZoneName:'shortOffset'` or the `+01:00` offset in local time |
| `depUTC`/`arrUTC` | `*.scheduledTime.utc` | reformat `"2026-06-06 13:20Z"`→`"2026-06-06T13:20:00Z"` |
| `dateISO` | `departure.scheduledTime.local` | first 10 chars |
| `date` | **derived** from `dateISO` | `Intl` `en-GB` weekday+day+month+year |

The two **non-recoverable** fields are `lat/lon` and `tz`. If either is absent for either endpoint,
return the `notfound` error rather than a broken record (the engine would produce `NaN`).

---

## Response — errors

The Worker returns only `notfound` and `busy`. `format`/`empty` are caught client-side *before* the
fetch (instant feedback, no round-trip); `offline` is produced client-side on fetch failure. All
five render through the existing/extended `ErrorState` (`components.jsx:312`).

| Shape | Origin | HTTP | Meaning |
|---|---|---|---|
| `{ "found": false, "error": "notfound", "code": "SV124" }` | Worker | 404 | Valid format, no such flight / missing coords or tz |
| `{ "found": false, "error": "busy" }` | Worker | 503 | Daily upstream `CEILING` hit, or rate-limited — "try again shortly" |
| `{ "found": false, "error": "format", "code": "XYZ" }` | client | — | Fails `^[A-Z]{2,3}\d{1,4}$` before any fetch |
| `{ "error": "empty" }` | client | — | Blank input |
| `{ "found": false, "error": "offline" }` | client | — | `fetch` threw / `!navigator.onLine` and no SW cache hit |

---

## Caching (informative — does not change the shape)

- KV key: `flight:{code}:{resolvedDate}`; value = the success record above.
- TTL: today/future 6h; past flights 30d.
- Cache hit ⇒ returned with `X-Rihla-Cache: hit`, **no upstream call**.
- Same-origin (Pages + Worker on one custom domain) ⇒ the service worker also caches the
  `/api/flight?...` response, enabling offline re-display of saved flights.
