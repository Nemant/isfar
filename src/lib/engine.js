import * as adhan from 'adhan';
import { META } from './data.js';
/* ===========================================================================
   Isfar — prayer engine
   Computes the prayers across a flight using adhan-js, evaluated at the
   aircraft's position along the great-circle path.

   A flight does NOT always cross exactly five prayers. On long eastbound
   routes the aircraft sweeps more than one solar day, so a prayer can recur
   (a 2nd Fajr, a 2nd Dhuhr). The engine therefore COLLECTS EVERY CROSSING
   along the path rather than assuming one of each:

   1. BEFORE  — prayers already due at the origin before take-off.
   2. IN-FLIGHT— walk dep→arr; each time the aircraft's local prayer time is
                 crossed, record it (with the calendar day it belongs to, so
                 repeats are kept distinct).
   3. AFTER   — the next prayers due on the ground at the destination.

   All prayer times are adhan's. The maths kept here is deliberately NOT
   prayer-calc: great-circle position/heading, horizon dip from cruise
   altitude, solar declination (only to label polar night vs midnight sun),
   and timezone formatting.
   =========================================================================== */

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const DAY = 86400000, MIN = 60000;
const ORDER = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const SIX_KEYS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
const BEFORE_CAP = 2, AFTER_CAP = 2;
const HIGHLAT_FLOOR = 60;  // rule-3 floor: where no day/night cycle exists, borrow the night from lat 60
const DEFAULT_CRUISE_FT = 38000;

/* ============================ geometry (ours) ============================= */

/* point a fraction f of the way along the great circle P1→P2 */
function greatCircle(lat1, lon1, lat2, lon2, f) {
  const φ1 = lat1 * D2R, λ1 = lon1 * D2R, φ2 = lat2 * D2R, λ2 = lon2 * D2R;
  const Δ = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (!Δ) return { lat: lat1, lon: lon1 };
  const a = Math.sin((1 - f) * Δ) / Math.sin(Δ);
  const b = Math.sin(f * Δ) / Math.sin(Δ);
  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) * R2D, lon: Math.atan2(y, x) * R2D };
}

/* forward azimuth (compass heading, 0..360 from north) from P1 toward P2 —
   used as the aircraft's instantaneous heading at a position */
function initialBearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * D2R, φ2 = lat2 * D2R, Δλ = (lon2 - lon1) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/* Horizon-dip time shift from cruise altitude (observer geometry, not a
   prayer-calc method). From height h the horizon sits dip° below level, so
   the sun is still visible after ground-level sunset. Returns MINUTES to
   delay sunset / advance sunrise. Latitude factor errs slightly late for
   Maghrib (the safe side — you won't pray while the sun is still up). */
function altDipMinutes(latDeg, altFt) {
  if (!altFt) return 0;
  const h = altFt * 0.3048;                       // metres
  const dipDeg = 1.76 * Math.sqrt(h) / 60;        // refraction-corrected dip
  const latFactor = 1 / Math.max(0.35, Math.cos(latDeg * D2R));
  return dipDeg * 4 * latFactor;                  // 4 min per degree of arc
}

/* solar declination (deg) for a date — standard approximation. Used ONLY to
   tell polar night from midnight sun once adhan has already said there is no
   sunrise/sunset; never to compute or predict a prayer time. */
function solarDeclination(ms) {
  const d = new Date(ms);
  const N = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
             Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000;
  return 23.44 * Math.sin((360 / 365.24) * (N - 81) * D2R);
}

/* ============================ adhan access ================================ */

function makeParams(method, madhab) {
  const M = adhan.CalculationMethod;
  const map = {
    mwl: M.MuslimWorldLeague, isna: M.NorthAmerica, moonsighting: M.MoonsightingCommittee,
    egyptian: M.Egyptian, ummalqura: M.UmmAlQura, dubai: M.Dubai, qatar: M.Qatar,
    kuwait: M.Kuwait, karachi: M.Karachi, singapore: M.Singapore, turkey: M.Turkey,
    tehran: M.Tehran
  };
  const p = (map[method] || M.MuslimWorldLeague)();
  p.madhab = (madhab === "hanafi") ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  // Base rule = MiddleOfTheNight: it returns the chosen method's REAL twilight angle wherever
  // the sun actually reaches it (it only caps the rare case of an angle past solar midnight).
  // Where the sun never reaches the angle, daySchedule swaps in a seventh-of-the-night fallback
  // (and, where no day/night cycle exists at all, borrows latitude 60). Using SeventhOfTheNight
  // here as the base was wrong —
  // it clamps real angle times even at normal latitudes (London June Isha 21:24 vs the real 23:48).
  p.highLatitudeRule = adhan.HighLatitudeRule.MiddleOfTheNight;
  return p;
}

/* a clone of the method params using the seventh-of-the-night fallback (for places/dates where
   the sun never reaches the twilight angle). Preserves the adhan prototype (nightPortions, …). */
function seventhParams(params) {
  const p = Object.assign(Object.create(Object.getPrototypeOf(params)), params);
  p.highLatitudeRule = adhan.HighLatitudeRule.SeventhOfTheNight;
  return p;
}

const msOf = (v) => (v && !isNaN(v.getTime())) ? v.getTime() : null;

/* adhan PrayerTimes for the mean-solar calendar day implied by lon around refMs */
function ptFor(lat, lon, refMs, params, dayOffset) {
  const l = meanSolarClock(refMs, lon);
  const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(),
                              l.getUTCDate() + (dayOffset || 0), 12));
  return new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
}

/* A method whose maghrib is an angle after sunset (Tehran) can outrun the
   seventh-of-night isha; re-anchor the night portion on the method's own
   nightfall instead of the sun-disk sunset. */
const reanchoredIsha = (ishaMs, maghribMs, sunsetMs) => maghribMs + (ishaMs - sunsetMs);

/* full seventh-rule day at the floor latitude (same longitude) — every value
   defined: at ±60° the sun rises and sets all year, and SeventhOfTheNight
   substitutes any unreachable angle. */
function borrow60(lat, lon, refMs, params) {
  const pt = ptFor(Math.sign(lat) * HIGHLAT_FLOOR, lon, refMs, seventhParams(params));
  const out = {};
  SIX_KEYS.forEach(k => { out[k] = msOf(pt[k]); });
  const sunset = msOf(pt.sunset);
  if (out.isha != null && out.maghrib != null && sunset != null && out.isha <= out.maghrib) {
    out.isha = reanchoredIsha(out.isha, out.maghrib, sunset);
  }
  return out;
}

const adjOf = (params, k) => ((((params.adjustments || {})[k] || 0) +
                               ((params.methodAdjustments || {})[k] || 0)) * MIN);

/* Did adhan substitute this fajr/isha with its middle-of-the-night safe time?
   OBSERVED, not predicted: we replicate adhan's own arithmetic from its outputs.
   adhan derives night and the safe times from the UNADJUSTED sunrise/sunset and
   only then adds each prayer's minute adjustments and rounds — so the
   sunrise/sunset adjustments are stripped off the outputs before
   reconstructing (Turkey: sunrise −7, Dubai: −3), and the prayer's own
   adjustment added back. The ±2 min tolerance covers the minute-rounding of
   the three reconstructed inputs. */
function wasSubstituted(key, outMs, sunriseMs, sunsetMs, nextSunriseMs, params) {
  if (outMs == null) return true;                       // invalid ⇒ certainly no angle
  if (sunriseMs == null || sunsetMs == null || nextSunriseMs == null) return true;
  const sunrise = sunriseMs - adjOf(params, "sunrise");
  const sunset = sunsetMs - adjOf(params, "sunset");
  const night = (nextSunriseMs - adjOf(params, "sunrise")) - sunset;
  if (night < 60 * MIN) return true;                    // <1 h night ⇒ no method angle is reachable
  const safe = key === "fajr" ? sunrise - night / 2 : sunset + night / 2;
  return Math.abs(outMs - (safe + adjOf(params, key))) <= 2 * MIN;
}

/* ==========================================================================
   daySchedule — THE policy. One mean-solar day at (lat, lon); the only code
   that asks adhan for times. Returns {fajr,sunrise,dhuhr,asr,maghrib,isha}
   each {ms, source, estimated} — ms is ALWAYS a number — plus kind:
   "normal" | "midnightsun" | "polarnight".

   1. REAL ANGLE   — the method's own time wherever the sky reaches it.
   2. SEVENTH      — angle unreachable but the sun still rises and sets, at
                     ANY latitude: 1/7 of the LOCAL night. Coherent with the
                     visible sky by construction — Isha lands after the real
                     sunset, Fajr before the real sunrise (a seventh < half),
                     which a borrowed schedule cannot guarantee (the audited
                     60-66.5° flights: Maghrib declared in daylight, Fajr
                     after the cabin watched the sun rise).
   3. BORROW60     — no day/night cycle at all (midnight sun / polar night):
                     the whole night cluster — maghrib, isha, fajr, sunrise —
                     read from the 60° sky at this longitude. Nothing local
                     exists to contradict, so coherence is automatic. Dhuhr
                     and Asr stay local (Dhuhr flagged in polar night; Asr
                     borrowed when the local sun gives it no sane afternoon).
   Moonsighting Committee is trusted verbatim whenever a cycle exists (the
   method ships its own ≥55° rule). Interval isha (ummalqura/qatar) is real
   with a cycle and joins the cluster without one.
   ========================================================================== */
function daySchedule(lat, lon, refMs, params, method) {
  const pt = ptFor(lat, lon, refMs, params);
  const real = (ms) => ({ ms, source: "method", estimated: false });
  const out = { dhuhr: real(msOf(pt.dhuhr)) };          // transit: valid at every lat/date

  const sunriseMs = msOf(pt.sunrise), sunsetMs = msOf(pt.sunset);
  if (sunriseMs == null || sunsetMs == null) return noCycleSchedule(out, pt, lat, lon, refMs, params);

  // ---- a real day and night exist: sun-disk events + asr are local --------
  out.kind = "normal";
  out.sunrise = real(sunriseMs);
  // an angle-based maghrib (Tehran, 4.5° after sunset) can fail while the sun
  // still sets; the honest floor is the sun-disk sunset itself, flagged —
  // parallels the flagged polar Dhuhr (keep the real solar event, admit the
  // method's refinement is out of reach)
  const maghribMs = msOf(pt.maghrib);
  out.maghrib = maghribMs != null
    ? real(maghribMs)
    : { ms: sunsetMs, source: "method", estimated: true };
  const asrMs = msOf(pt.asr);                           // degenerate near |lat−decl|≈90: range-guard
  if (asrMs != null && asrMs > out.dhuhr.ms && asrMs < sunsetMs) {
    out.asr = real(asrMs);
  } else {
    // borrowed afternoon, clamped inside the local day — the 60° afternoon
    // can outlast a fringe-latitude day near the polar-night boundary
    const bAsr = borrow60(lat, lon, refMs, params).asr;
    out.asr = { ms: Math.min(bAsr, out.maghrib.ms - MIN), source: "borrow60", estimated: true };
  }

  if (method === "moonsighting") {                      // the method's own high-lat rule: trust it
    out.fajr = real(msOf(pt.fajr));
    out.isha = real(msOf(pt.isha));
    return out;
  }

  // fajr/isha ladder. Shortcut: at |lat| ≤ 40 every exposed angle is always
  // reachable (min midnight depth 26.6° vs max method angle 18.5°) — skip the
  // detection calls.
  if (Math.abs(lat) <= 40) {
    out.fajr = { ms: msOf(pt.fajr), source: "angle", estimated: false };
    out.isha = params.ishaInterval > 0 ? real(msOf(pt.isha))
                                       : { ms: msOf(pt.isha), source: "angle", estimated: false };
    return out;
  }

  const nextSunriseMs = msOf(ptFor(lat, lon, refMs, params, 1).sunrise);
  let pt7 = null;
  for (const k of ["fajr", "isha"]) {
    if (k === "isha" && params.ishaInterval > 0) { out.isha = real(msOf(pt.isha)); continue; }
    if (!wasSubstituted(k, msOf(pt[k]), sunriseMs, sunsetMs, nextSunriseMs, params)) {
      out[k] = { ms: msOf(pt[k]), source: "angle", estimated: false };
      continue;
    }
    // rule 2 at ANY latitude: while the sun still rises and sets, portion the
    // LOCAL night — Isha after the real sunset and Fajr before the real
    // sunrise by construction, which no borrowed sky can guarantee
    pt7 = pt7 || ptFor(lat, lon, refMs, seventhParams(params));
    out[k] = { ms: msOf(pt7[k]), source: "seventh", estimated: true };
  }
  if (out.isha && out.isha.source === "seventh" && out.isha.ms <= out.maghrib.ms) {
    out.isha = { ms: reanchoredIsha(out.isha.ms, out.maghrib.ms, sunsetMs),
                 source: "seventh", estimated: true };
  }
  return out;
}

/* rule 3 — no day/night cycle here, as adhan observes it (midnight sun /
   polar night, including the refraction fringe geometry misses) */
function noCycleSchedule(out, pt, lat, lon, refMs, params) {
  const decl = solarDeclination(refMs);
  const polarNight = Math.abs(lat - decl) > Math.abs(lat + decl);
  const b = borrow60(lat, lon, refMs, params);
  const est = (k) => ({ ms: b[k], source: "borrow60", estimated: true });
  out.fajr = est("fajr"); out.sunrise = est("sunrise");
  out.maghrib = est("maghrib"); out.isha = est("isha");
  out.dhuhr.estimated = polarNight;                   // local noon kept, flagged for honesty
  const asrMs = msOf(pt.asr);
  const asrSane = asrMs != null && asrMs > out.dhuhr.ms &&
                  b.maghrib != null && asrMs < b.maghrib;  // keep the afternoon before the (borrowed) dusk
  out.asr = (!polarNight && asrSane) ? { ms: asrMs, source: "method", estimated: false } : est("asr");
  out.kind = polarNight ? "polarnight" : "midnightsun";
  return out;
}

/* ===================== local time labels & formatting ===================== */

/* a Date whose UTC getters read mean solar time at this longitude */
function meanSolarClock(ms, lon) {
  return new Date(ms + (lon / 15) * 3600000);
}
const dayKeyOf = (ms, lon) => {
  const l = meanSolarClock(ms, lon);
  return l.getUTCFullYear() + "-" + l.getUTCMonth() + "-" + l.getUTCDate();
};
/* sun elevation proxy → arc height: fraction of the mean solar day (0..1) */
function solarFrac(lat, lon, ms) {
  const l = meanSolarClock(ms, lon);
  return (l.getUTCHours() + l.getUTCMinutes() / 60) / 24;
}

const _fmt = {};
function fmtTZ(ms, tz) {
  if (!_fmt[tz]) _fmt[tz] = new Intl.DateTimeFormat("en-GB",
    { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  return _fmt[tz].format(new Date(ms));
}
const _fmtD = {};
function fmtDate(ms, tz) {
  if (!_fmtD[tz]) _fmtD[tz] = new Intl.DateTimeFormat("en-GB",
    { weekday: "short", day: "numeric", month: "short", timeZone: tz });
  return _fmtD[tz].format(new Date(ms));
}
// date in mean-solar local time at a longitude (for in-flight prayers)
const _fmtU = new Intl.DateTimeFormat("en-GB",
  { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDateSolar = (ms, lon) => _fmtU.format(meanSolarClock(ms, lon));

/* ====================== collecting a flight's prayers =====================
   Each collected entry: {key, status, ms, lat, lon, source, estimated,
   sunriseMs, sunriseReal} — the raw material the display model is built from.
   ========================================================================== */

const entryOf = (key, status, e, day, lat, lon, ms) => ({
  key, status, ms, lat, lon, source: e.source, estimated: e.estimated,
  sunriseMs: day.sunrise.ms, sunriseReal: !day.sunrise.estimated
});

/* every prayer of the two solar days around refMs at a ground point, sorted */
function groundCandidates(sched, point, refMs, dayOffsets) {
  const out = [];
  for (const off of dayOffsets) {
    const s = sched(point.lat, point.lon, refMs + off * DAY);
    ORDER.forEach(k => out.push({ k, s, e: s[k] }));
  }
  return out.sort((a, b) => a.e.ms - b.e.ms);
}

/* 1. BEFORE — the last prayers due at the origin, scanning the previous
   solar day too so red-eye departures still get their context prayers. */
function collectBefore(sched, from, dep) {
  return groundCandidates(sched, from, dep, [-1, 0])
    .filter(({ e }) => e.ms <= dep)
    .slice(-BEFORE_CAP)
    .map(({ k, s, e }) => entryOf(k, "before", e, s, from.lat, from.lon, e.ms));
}

/* 2. IN-FLIGHT — walk the great circle minute by minute. Each prayer's
   instant is a MOVING target (it drifts as the aircraft changes longitude);
   a sign flip of (clock − instant) marks the moment it becomes due aloft.
   The policy is discontinuous where the angle stops being reachable, so when
   the schedule JUMPED past the clock we record the moment of the jump (when
   it became due) — never a time from the past, and never silently dropped. */
function collectInflight(sched, from, to, dep, arr, cruiseAltFt) {
  const entries = [];
  const STEP = MIN;
  const prevResid = {}, captured = {};
  for (let ms = dep; ms <= arr; ms += STEP) {
    const f = (arr === dep) ? 0 : (ms - dep) / (arr - dep);
    const pos = greatCircle(from.lat, from.lon, to.lat, to.lon, f);
    const s = sched(pos.lat, pos.lon, ms);
    ORDER.forEach(k => {
      const e = s[k];
      const dk = k + "@" + dayKeyOf(e.ms, pos.lon);
      const resid = ms - e.ms;
      const prev = prevResid[dk];
      if (prev !== undefined && prev < 0 && resid >= 0 && !captured[dk]) {
        captured[dk] = true;
        let T = Math.min(arr, Math.max(dep, resid <= STEP ? e.ms : ms));
        // altitude horizon-dip, baked in BEFORE sorting: from cruise height a
        // REAL sunset is seen later. Estimates get no fake precision, and the
        // dip never pushes an in-flight prayer past landing.
        if (k === "maghrib" && !e.estimated) {
          T = Math.min(arr, T + Math.round(altDipMinutes(pos.lat, cruiseAltFt) * MIN));
        }
        entries.push(entryOf(k, "inflight", e, s, pos.lat, pos.lon, T));
      }
      prevResid[dk] = resid;
    });
  }
  return entries;
}

/* 3. AFTER — the next prayers on the ground at the destination, rolling into
   the following day so a late-night arrival still sees tomorrow's Fajr. Same
   path for normal and polar destinations. A prayer already shown (e.g. prayed
   aloft on a westbound leg) is skipped and the list topped up, so it always
   holds the next AFTER_CAP genuine prayers. */
function collectAfter(sched, to, arr, shown) {
  const shownNear = (key, ms) => shown.some(x => x.key === key && Math.abs(ms - x.ms) < 6 * 3600000);
  const entries = [];
  for (const { k, s, e } of groundCandidates(sched, to, arr, [0, 1])) {
    if (entries.length >= AFTER_CAP) break;
    if (e.ms <= arr || shownNear(k, e.ms)) continue;
    entries.push(entryOf(k, "after", e, s, to.lat, to.lon, e.ms));
  }
  return entries;
}

/* 4. MERGE — sort, then drop any same-prayer repeat within 6 h (the same
   prayer cannot recur that fast; genuine repeats on long eastbound flights
   are ~16 h+ apart). */
function mergeEntries(entries) {
  entries.sort((a, b) => a.ms - b.ms);
  const lastAt = {};
  return entries.filter(e => {
    if (lastAt[e.key] !== undefined && e.ms - lastAt[e.key] < 6 * 3600000) return false;
    lastAt[e.key] = e.ms;
    return true;
  });
}

/* 5. SKY NOTES — a banner per no-cycle endpoint (origin AND destination),
   plus a short-night note where the night is real but compressed (the sliver
   just below the polar boundary, e.g. Akureyri's 37-minute June night): the
   times are true to the sky, and combining is the answer. */
function buildSkyNotes(sched, from, to, dep, arr) {
  const note = (place, pt, kind, extra) => Object.assign({
    place, city: pt.city, iata: pt.iata,
    latitude: Math.abs(pt.lat).toFixed(1) + "° " + (pt.lat >= 0 ? "N" : "S"),
    kind
  }, extra);
  const estimatedNames = (s) => ORDER.filter(k => s[k].estimated).map(k => META[k].en);

  const skyNotes = [];
  for (const [place, pt, refMs] of [["origin", from, dep], ["destination", to, arr]]) {
    const s = sched(pt.lat, pt.lon, refMs);
    if (s.kind !== "normal") {
      skyNotes.push(note(place, pt, s.kind, {
        allEstimated: ORDER.every(k => s[k].estimated),
        names: estimatedNames(s)
      }));
      continue;
    }
    const s2 = sched(pt.lat, pt.lon, refMs + DAY);      // tonight = this sunset → tomorrow's sunrise
    if (s2.kind !== "normal" || s2.sunrise.estimated || s.maghrib.estimated) continue;
    const nightMin = Math.round((s2.sunrise.ms - s.maghrib.ms) / MIN);
    if (nightMin > 0 && nightMin < 90 && s.isha.estimated) {
      skyNotes.push(note(place, pt, "shortnight", {
        nightMin, allEstimated: false, names: estimatedNames(s)
      }));
    }
  }
  return skyNotes;
}

/* ========================= the display model ============================== */

/* qibla as a CLOCK POSITION off the aircraft's nose (12 = direction of
   travel) — only meaningful while aloft; on the ground use a normal app */
function qiblaAloft(lat, lon, to) {
  const qAbs = adhan.Qibla(new adhan.Coordinates(lat, lon));
  const hdg = initialBearing(lat, lon, to.lat, to.lon);
  const qiblaRel = ((qAbs - hdg) % 360 + 360) % 360;
  const hr = Math.round(qiblaRel / 30) % 12;
  return { qiblaClock: hr === 0 ? 12 : hr, qiblaRel };
}

function toPrayerViewModel(a, i, from, to, cruiseAltFt) {
  const { qiblaClock, qiblaRel } = a.status === "inflight"
    ? qiblaAloft(a.lat, a.lon, to)
    : { qiblaClock: null, qiblaRel: null };

  const zone = (pt) => ({ iata: pt.iata, city: pt.city, time: fmtTZ(a.ms, pt.tz), date: fmtDate(a.ms, pt.tz) });

  // Fajr ends at sunrise — captured in both zones. The altitude horizon-dip
  // pulls a sunrise seen from cruise height EARLIER, but only when the FAJR
  // ITSELF is real: a portioned Fajr sits a seventh before the ground
  // sunrise, and a ~30-minute high-latitude dip would shove its displayed
  // end before its start. Estimates get no fake precision — their window
  // wears the ~ instead. (The Maghrib dip was already baked in at capture.)
  let sunrise = null;
  if (a.key === "fajr" && a.sunriseMs != null) {
    const exact = a.sunriseReal && !a.estimated;
    const dipMs = exact && a.status === "inflight"
      ? Math.round(altDipMinutes(a.lat, cruiseAltFt) * MIN) : 0;
    const srMs = a.sunriseMs - dipMs;
    const pre = exact ? "" : "~";
    sunrise = { [from.iata]: pre + fmtTZ(srMs, from.tz), [to.iata]: pre + fmtTZ(srMs, to.tz) };
  }

  return {
    id: a.key + "-" + i,
    key: a.key, en: META[a.key].en, ar: META[a.key].ar, status: a.status,
    t: solarFrac(a.lat, a.lon, a.ms),
    ms: a.ms,
    qiblaClock, qiblaRel, sunrise,
    sunriseMs: a.key === "fajr" ? (a.sunriseMs ?? null) : null,
    estimated: a.estimated, estimateBasis: a.estimated ? a.source : null,
    zones: { [from.iata]: zone(from), [to.iata]: zone(to) }
  };
}

export function compute(raw, opts) {
  opts = opts || {};
  const method = opts.method || "mwl";
  const params = makeParams(method, opts.madhab || "shafi");
  const dep = Date.parse(raw.depUTC), arr = Date.parse(raw.arrUTC);
  const { from, to } = raw;
  const cruiseAltFt = raw.cruiseAltFt || DEFAULT_CRUISE_FT;
  const sched = (lat, lon, refMs) => daySchedule(lat, lon, refMs, params, method);

  const entries = [
    ...collectBefore(sched, from, dep),
    ...collectInflight(sched, from, to, dep, arr, cruiseAltFt)
  ];
  entries.push(...collectAfter(sched, to, arr, entries));
  const merged = mergeEntries(entries);

  // day labels at each prayer's own locale (origin/dest civil, or solar aloft)
  const dateOf = (e) => e.status === "before" ? fmtDate(e.ms, from.tz)
                      : e.status === "after"  ? fmtDate(e.ms, to.tz)
                      : fmtDateSolar(e.ms, e.lon);

  return Object.assign({}, raw, {
    durationMin: Math.round((arr - dep) / MIN),
    dep: { local: fmtTZ(dep, from.tz) },
    arr: { local: fmtTZ(arr, to.tz) },
    from: Object.assign({}, from),
    to:   Object.assign({}, to),
    cruiseAltFt,
    prayers: merged.map((a, i) => toPrayerViewModel(a, i, from, to, cruiseAltFt)),
    multiDay: new Set(merged.map(dateOf)).size > 1,
    skyNotes: buildSkyNotes(sched, from, to, dep, arr)
  });
}

export const ISFAR_TEST = { makeParams, daySchedule };
// build-time consumer: the guide pages sample the flight path for their figures
export { greatCircle };
