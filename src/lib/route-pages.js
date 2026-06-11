/* ===========================================================================
   Isfar — build-time data for the programmatic route pages (SEO Phase D).

   BUILD-TIME ONLY: imported by the Astro page frontmatter, never by the
   island. All prayer times come from the real engine (engine.compute over a
   routeRecord-synthesized record) — the pages show genuine engine output for
   representative season × departure cells, never hand-rolled estimates.
   Qibla bearings come from adhan.Qibla (golden rule: no hand-rolled
   prayer math; great-circle distance is ours, like the rest of engine.js
   geometry).
   =========================================================================== */

import * as adhan from 'adhan';
import data from '../assets/airports.json';
import { airportFromRow, routeRecord, civilToUTC } from './airports.js';
import { compute } from './engine.js';

// Representative cells: solstices + an equinox, morning + evening departures.
// Fixed dates keep builds (and the pinned tests) deterministic; they stay
// seasonally representative in later years.
export const SEASON_DATES = ['2026-06-21', '2026-09-22', '2026-12-21'];
export const SEASON_LABELS = { '2026-06-21': 'June (longest days)', '2026-09-22': 'September (equinox)', '2026-12-21': 'December (shortest days)' };
export const DEP_TIMES = ['09:00', '21:00'];
export const DEP_LABELS = { '09:00': 'Morning departure (~09:00)', '21:00': 'Evening departure (~21:00)' };
export const LASTMOD = '2026-06-11';

// One stated convention for every page: MWL is the globally neutral default.
// The page copy says so and points at the app's 12 selectable methods.
export const ROUTE_METHOD = { key: 'mwl', label: 'Muslim World League', madhab: 'shafi' };

const byIata = new Map(data.airports.map((r) => [r[0], airportFromRow(r)]));
export function resolveAirport(iata) { return byIata.get(iata) || null; }

export const routeSlug = (from, to) => `${from}-to-${to}`.toLowerCase();

// The dataset's "city" is the municipality, which is sometimes the suburb the
// runway sits in (KUL→"Sepang", ISB→"Attock") or over-qualified
// ("Paris (Roissy-en-France, Val-d'Oise)"). Page copy wants the city people
// actually fly to.
const CITY_EN = {
  LHR: 'London', MAN: 'Manchester', JFK: 'New York', YYZ: 'Toronto', CDG: 'Paris',
  IST: 'Istanbul', KUL: 'Kuala Lumpur', CGK: 'Jakarta', KHI: 'Karachi', LHE: 'Lahore',
  ISB: 'Islamabad', DAC: 'Dhaka', CAI: 'Cairo', LOS: 'Lagos', DXB: 'Dubai',
  LAX: 'Los Angeles', CMN: 'Casablanca', JED: 'Jeddah', MED: 'Medina',
};
export function cityEn(airport) { return CITY_EN[airport.iata] || airport.city; }

/* ---- geometry (ours, like engine.js geometry) ---------------------------- */
const R = 6371, rad = Math.PI / 180;
export function greatCircleKm(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// ~850 km/h cruise + 45 min climb/descent/taxi, rounded to 5 min.
export function estimateDurationMin(from, to) {
  const min = (greatCircleKm(from, to) / 850) * 60 + 45;
  return Math.round(min / 5) * 5;
}

function tzOffsetHours(dateISO, tz) {
  // offset = wall-clock-as-UTC minus the true UTC instant of that wall clock
  return (Date.parse(dateISO + 'T12:00:00Z') - civilToUTC(dateISO, '12:00', tz)) / 3600000;
}

export function routeFacts(from, to) {
  const qibla = (a) => Math.round(adhan.Qibla(new adhan.Coordinates(a.lat, a.lon)));
  const june = SEASON_DATES[0];
  return {
    distanceKm: greatCircleKm(from, to),
    durationMin: estimateDurationMin(from, to),
    tzShiftHours: tzOffsetHours(june, to.tz) - tzOffsetHours(june, from.tz),
    qiblaFrom: qibla(from),
    qiblaTo: qibla(to),
  };
}

/* ---- the seasonal schedule matrix ---------------------------------------- */
function wallClock(ms, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
  return f.format(new Date(ms)).replace('24', '00');
}

export function seasonalSchedule(from, to) {
  const durationMin = estimateDurationMin(from, to);
  const cells = [];
  for (const dateISO of SEASON_DATES) {
    for (const depTime of DEP_TIMES) {
      const depMs = civilToUTC(dateISO, depTime, from.tz);
      const arrTime = wallClock(depMs + durationMin * 60000, to.tz);
      const rec = routeRecord({ from, to, dateISO, depTime, arrTime });
      const out = compute(rec, { method: ROUTE_METHOD.key, madhab: ROUTE_METHOD.madhab });
      const names = (status) => out.prayers.filter((p) => p.status === status).map((p) => p.en);
      cells.push({
        dateISO, depTime,
        before: names('before'),
        inflight: names('inflight'),
        after: names('after'),
        estimated: out.prayers.some((p) => p.status === 'inflight' && p.estimated),
      });
    }
  }
  return cells;
}
