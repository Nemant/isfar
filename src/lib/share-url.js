/* ===========================================================================
   Isfar — shareable result URLs.
   Encode/decode a resolved flight or route record ↔ the root URL's query
   string, so results are shareable, refreshable and offline-reconstructable.
   Flight links carry only {flight,date} (re-looked-up, cache-first); route
   links carry the full itinerary {from,to,date,dep,arr} (rebuilt offline via
   routeRecord). Calc method/madhab are deliberately NOT encoded — the
   recipient's own persisted settings apply. Pure module: Intl + airports.js.
   =========================================================================== */
import { searchAirports, airportFromRow, routeRecord } from './airports.js';

/* civil wall-clock "HH:MM" of a UTC instant in a tz (24h, DST-correct) */
function hhmm(isoUTC, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(isoUTC));
}

/* resolved record → plain params object (or null if not a finished result) */
export function recordToParams(rec) {
  if (!rec || !rec.found) return null;
  if (rec.routeMode) {
    return {
      from: rec.from.iata, to: rec.to.iata, date: rec.dateISO,
      dep: hhmm(rec.depUTC, rec.from.tz),
      arr: hhmm(rec.arrUTC, rec.to.tz),
    };
  }
  return { flight: rec.code, date: rec.dateISO };
}

/* resolved record → absolute root URL string (string, never a URL object —
   the CF Web Analytics beacon's pushState override chokes on URL objects). */
export function recordToUrl(rec, origin) {
  const p = recordToParams(rec);
  if (!p) return origin + '/';
  return origin + '/?' + new URLSearchParams(p).toString();
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const IATA = /^[A-Z]{3}$/;

/* location.search → share intent, or null (junk / legacy prefill-only) */
export function parseShareParams(search) {
  const p = new URLSearchParams(search || '');
  const from = (p.get('from') || '').toUpperCase();
  const to = (p.get('to') || '').toUpperCase();
  const date = p.get('date') || '';
  const dep = p.get('dep') || '';
  const arr = p.get('arr') || '';
  if (IATA.test(from) && IATA.test(to) && from !== to &&
      ISO.test(date) && HM.test(dep) && HM.test(arr)) {
    return { kind: 'route', from, to, date, dep, arr };
  }
  const code = (p.get('flight') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code && ISO.test(date)) return { kind: 'flight', code, date };
  return null;
}

/* parsed route intent + a loaded airports rows list → a route record
   (or null if either airport is unknown). Mirrors route-form's resolver. */
export function routeParamsToRecord(parsed, list) {
  const exact = (code) => {
    const row = searchAirports(list, code, 1)[0];
    return row && row[0] === code ? airportFromRow(row) : null;
  };
  const from = exact(parsed.from), to = exact(parsed.to);
  if (!from || !to) return null;
  return routeRecord({ from, to, dateISO: parsed.date, depTime: parsed.dep, arrTime: parsed.arr });
}
