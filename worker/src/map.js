// worker/src/map.js
//
// PURE mapping layer: AeroDataBox flight segment  ->  Isfar success record.
//
// This file has NO network and NO Worker/env dependencies on purpose, so the
// whole field-provenance table in worker/CONTRACT.md can be unit-tested offline
// (see worker/test/map.test.mjs). Everything time-zone related is derived with
// Intl.DateTimeFormat — Cloudflare Workers ship full ICU, same as Node here.
//
// The shape we consume is AeroDataBox's documented
//   GET /flights/number/{number}/{date}?withLocation=true
// response: an ARRAY of segments. Each segment looks (abbreviated) like:
//
//   {
//     "number": "SV 124",
//     "airline":  { "name": "Saudia" },
//     "aircraft": { "model": "Boeing 787-9" },
//     "departure": {
//       "airport": {
//         "iata": "LHR", "icao": "EGLL",
//         "name": "London Heathrow", "shortName": "Heathrow",
//         "municipalityName": "London",
//         "location": { "lat": 51.4700, "lon": -0.4543 },
//         "timeZone": "Europe/London"
//       },
//       "scheduledTime": { "utc": "2026-06-06 13:20Z", "local": "2026-06-06 14:20+01:00" }
//     },
//     "arrival": { ...same shape... }
//   }
//
// Anything that would make engine.js produce NaN (missing lat/lon or tz on
// either endpoint) is treated as non-recoverable -> { found:false, error:"notfound" }.

/** Strict-ISO reformat: "2026-06-06 13:20Z" / "2026-06-06T13:20:00.000Z" -> "2026-06-06T13:20:00Z". */
function toStrictIsoZ(raw) {
  if (!raw) return null;
  const d = new Date(String(raw).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  // Drop milliseconds; force the trailing Z. Date.parse-safe (engine.js:173).
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** First 10 chars of an AeroDataBox local timestamp -> YYYY-MM-DD. */
function isoDateFromLocal(localRaw) {
  if (!localRaw) return null;
  const m = String(localRaw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** One Intl timeZoneName part at a given instant, for a given style. */
function tzNamePart(tz, instant, style, locale = "en-GB") {
  const part = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: style })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part ? part.value : null;
}

/**
 * Short zone label (e.g. "BST", "AST", "PDT").
 *
 * Primary source is Intl timeZoneName:'short'. For zones ICU has no real
 * abbreviation for it returns a "GMT±N" form (e.g. Asia/Riyadh -> "GMT+3");
 * in that case we synthesise the abbreviation from the initials of the 'long'
 * name ("Arabian Standard Time" -> "AST"), which is exactly the calm 3-4 letter
 * label the UI wants. If the long name isn't a usable "... Time" phrase we fall
 * back to the GMT±N string rather than inventing something.
 */
function deriveZone(tz, instant) {
  const short = tzNamePart(tz, instant, "short");
  if (short && !/^(GMT|UTC)/i.test(short)) return short; // genuine abbrev, e.g. BST/CEST/GST
  const long = tzNamePart(tz, instant, "long");
  if (long && /\bTime$/.test(long)) {
    const acronym = long
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 5) return acronym;
  }
  return short; // GMT±N fallback
}

/** "GMT+1" / "GMT-7" style offset label via Intl timeZoneName:'shortOffset'. */
function deriveGmt(tz, instant) {
  const off = tzNamePart(tz, instant, "shortOffset");
  if (off) {
    // ICU sometimes returns plain "GMT" for +0; normalise to "GMT+0".
    if (/^(GMT|UTC)$/i.test(off)) return "GMT+0";
    return off.replace(/^UTC/i, "GMT");
  }
  return "GMT+0";
}

/** Human date string, en-GB weekday + day + month + year, in the origin tz. */
function humanDate(isoDate, tz) {
  if (!isoDate) return "—";
  // Anchor at local noon so the weekday can't slip across a tz boundary.
  const instant = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(instant);
}

/** Strip a trailing " Airport" so the calm label reads "Heathrow", not "Heathrow Airport". */
function calmAirportName(airport) {
  const raw = airport.shortName || airport.name || "";
  return raw.replace(/\s+Airport$/i, "").trim() || "—";
}

/** Map one endpoint (departure|arrival). Returns null if non-recoverable. */
function mapEndpoint(endpoint, instant) {
  const airport = endpoint && endpoint.airport;
  if (!airport) return null;

  const loc = airport.location || {};
  const lat = typeof loc.lat === "number" ? loc.lat : Number(loc.lat);
  const lon = typeof loc.lon === "number" ? loc.lon : Number(loc.lon);
  const tz = airport.timeZone;

  // Non-recoverable: engine.js would NaN without coords or tz.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !tz) return null;

  return {
    iata: airport.iata || airport.icao || "—",
    city: airport.municipalityName || airport.shortName || airport.name || "—",
    airport: calmAirportName(airport),
    lat,
    lon,
    tz,
    zone: deriveZone(tz, instant),
    gmt: deriveGmt(tz, instant),
  };
}

/**
 * Map a single AeroDataBox segment to the Isfar success record.
 * On any non-recoverable gap returns { found:false, error:"notfound", code }.
 *
 * @param {object} seg   one AeroDataBox segment
 * @returns {object}     success record OR notfound error record
 */
export function mapFlight(seg) {
  const code = String(seg?.number || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const dep = seg?.departure;
  const arr = seg?.arrival;

  const depUTC = toStrictIsoZ(dep?.scheduledTime?.utc);
  const arrUTC = toStrictIsoZ(arr?.scheduledTime?.utc);
  const dateISO = isoDateFromLocal(dep?.scheduledTime?.local) || (depUTC ? depUTC.slice(0, 10) : null);

  // Instants used for tz-name derivation (dep instant for `from`, arr for `to`).
  const depInstant = depUTC ? new Date(depUTC) : new Date(`${dateISO}T12:00:00Z`);
  const arrInstant = arrUTC ? new Date(arrUTC) : depInstant;

  const from = mapEndpoint(dep, depInstant);
  const to = mapEndpoint(arr, arrInstant);

  // Non-recoverable gaps -> notfound (never a half-built record).
  if (!from || !to || !depUTC || !arrUTC || !dateISO) {
    return { found: false, error: "notfound", code };
  }

  return {
    found: true,
    airline: seg?.airline?.name || "—",
    code,
    aircraft: seg?.aircraft?.model || "—",
    dateISO,
    date: humanDate(dateISO, from.tz),
    from,
    to,
    depUTC,
    arrUTC,
    // cruiseAltFt deliberately omitted — engine defaults to 38000 (engine.js:257,290).
  };
}

// Exposed for unit tests / reuse.
export const _internals = {
  toStrictIsoZ,
  isoDateFromLocal,
  deriveZone,
  deriveGmt,
  humanDate,
  calmAirportName,
  mapEndpoint,
};
