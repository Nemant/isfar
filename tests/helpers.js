/* Test-only oracles and fixtures.
   The deep import of adhan's SolarTime is the GROUND TRUTH for "does the sun
   reach this depression angle on this day" — adhan's own astronomy, used to
   validate the engine's observation-based detection. Never import adhan
   internals in src/ — vitest's Vite resolver is what makes the extensionless
   imports inside adhan's esm build work here. */
import * as adhan from 'adhan';
import SolarTime from '../node_modules/adhan/lib/esm/SolarTime.js';

// Does the sun reach `angle` degrees below the horizon at (lat, lon) on the
// UTC calendar day of `dateUTC`? (NaN hour angle ⇒ never reaches it.)
export function angleReachable(lat, lon, dateUTC, angle) {
  const d = new Date(Date.UTC(dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), dateUTC.getUTCDate(), 12));
  const st = new SolarTime(d, new adhan.Coordinates(lat, lon));
  return !Number.isNaN(st.hourAngle(-angle, false));
}

// Raw adhan PrayerTimes for the same mean-solar-day convention engine.js uses.
export function rawPT(lat, lon, refMs, params) {
  const l = new Date(refMs + (lon / 15) * 3600000);
  const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 12));
  return new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
}

export const validMs = (v) => (v && !isNaN(v.getTime())) ? v.getTime() : null;

// Synthetic flight record factory (shape of data.js records).
export function flight({ code = 'TT1', fromLat, fromLon, fromTz, toLat, toLon, toTz, depUTC, arrUTC,
                         fromIata = 'AAA', toIata = 'BBB' }) {
  return {
    found: true, airline: 'Test', code, aircraft: 'T', dateISO: depUTC.slice(0, 10), date: depUTC,
    from: { iata: fromIata, city: fromIata, airport: fromIata, lat: fromLat, lon: fromLon, tz: fromTz, zone: 'X', gmt: 'GMT' },
    to:   { iata: toIata,   city: toIata,   airport: toIata,   lat: toLat,   lon: toLon,   tz: toTz,   zone: 'X', gmt: 'GMT' },
    depUTC, arrUTC
  };
}
