/* ===========================================================================
   Isfar — route mode: airport search + record synthesis.
   Builds the EXACT /api/flight success shape (worker/CONTRACT.md) from the
   bundled dataset + the user's itinerary times, so engine.compute() needs no
   changes and route lookups work fully offline.
   =========================================================================== */

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

// zone/gmt derived exactly as the Worker derives them (worker/src/map.js)
function tzName(ms, tz, style) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: style });
  const part = f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName');
  return part ? part.value : null;
}
function zoneOf(ms, tz) {
  const short = tzName(ms, tz, 'short');
  if (short && !/^(GMT|UTC)/i.test(short)) return short;  // genuine abbrev: BST/CEST/GST
  const long = tzName(ms, tz, 'long');                    // "Arabian Standard Time" → "AST"
  if (long && /\bTime$/.test(long)) {
    const acronym = long.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 5) return acronym;
  }
  return short;
}
function gmtOf(ms, tz) {
  const off = tzName(ms, tz, 'shortOffset');
  if (off) {
    if (/^(GMT|UTC)$/i.test(off)) return 'GMT+0';         // ICU "GMT" for +0 → normalise
    return off.replace(/^UTC/i, 'GMT');
  }
  return 'GMT+0';
}

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
  let arr = dep;
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
