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

   If sunset/twilight has no solution (high-latitude midnight sun) adhan
   returns an Invalid Date — surfaced as the "no sunset" state.
   =========================================================================== */

const ISFAR_ENGINE = (function () {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const ORDER = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  const BEFORE_CAP = 2, AFTER_CAP = 2;
  const HIGHLAT_FLOOR = 60;  // above this latitude, borrow twilight times from lat 60

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

  /* solar declination (deg) for a date — standard approximation. Geometry (ours),
     used only to decide whether a prayer is an ESTIMATE; the time itself is adhan's. */
  function solarDeclination(ms) {
    const d = new Date(ms);
    const N = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
               Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000;
    return 23.44 * Math.sin((360 / 365.24) * (N - 81) * D2R);
  }

  /* classify a prayer at a position/date: "real" | "portioned" | "substituted".
     - no day/night cycle (midnight sun / polar night)            -> "substituted"
     - night exists but the method's twilight angle isn't reached  -> "portioned"  (fajr/isha)
     - otherwise                                                   -> "real" */
  function estimateBasisFor(key, lat, ms, params) {
    const decl = solarDeclination(ms);
    // Polar night = the sun never rises (|lat-decl| > 90): the day is wholly abnormal. Asr has no
    // shadow, and even Dhuhr's "midday" sun stays below the horizon — so both are flagged as
    // estimates there (Dhuhr keeps the exact solar-noon time, flagged for honesty, not relocated).
    // Whenever the sun does rise — including midnight sun — both are real (the sun is genuinely up).
    const polarNight = Math.abs(lat - decl) > 90;
    if (key === "dhuhr") return polarNight ? "substituted" : "real";
    if (key === "asr")   return polarNight ? "substituted" : "real";
    const noCycle = Math.abs(lat + decl) > 90 || Math.abs(lat - decl) > 90;
    if (noCycle) return "substituted";                              // affects fajr/isha/maghrib/sunrise
    if (key === "maghrib") return "real";                          // a sun-disk event; defined since a cycle exists
    if (key === "isha" && params.ishaInterval > 0) return "real";  // interval-based Isha = Maghrib + minutes
    const angle = key === "fajr" ? params.fajrAngle : params.ishaAngle;
    const depth = 90 - Math.abs(lat + decl);                        // sun's max depression below horizon at solar midnight
    if (depth >= angle) return "real";
    return Math.abs(lat) > HIGHLAT_FLOOR ? "substituted" : "portioned";
  }

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
    // Where the sun never reaches the angle, instantsAt swaps in a seventh-of-the-night fallback
    // (and, above 60°, borrows latitude 60). Using SeventhOfTheNight here as the base was wrong —
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

  const DAY = 86400000, MIN = 60000;
  const SIX_KEYS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  const msOf = (v) => (v && !isNaN(v.getTime())) ? v.getTime() : null;

  /* adhan PrayerTimes for the mean-solar calendar day implied by lon around refMs */
  function ptFor(lat, lon, refMs, params, dayOffset) {
    const l = new Date(refMs + (lon / 15) * 3600000);
    const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(),
                                l.getUTCDate() + (dayOffset || 0), 12));
    return new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
  }

  /* full seventh-rule day at the floor latitude (same longitude) — every value
     defined: at ±60° the sun rises and sets all year, and SeventhOfTheNight
     substitutes any unreachable angle. */
  function borrow60(lat, lon, refMs, params) {
    const pt = ptFor(Math.sign(lat) * HIGHLAT_FLOOR, lon, refMs, seventhParams(params));
    const out = {};
    SIX_KEYS.forEach(k => { out[k] = msOf(pt[k]); });
    return out;
  }

  /* Did adhan substitute this fajr/isha with its middle-of-the-night safe time?
     OBSERVED, not predicted: we replicate adhan's own arithmetic from its outputs
     (night = today's sunset → tomorrow's sunrise; + the method/user minute
     adjustments adhan adds before rounding) and compare within rounding slack. */
  function wasSubstituted(key, outMs, sunriseMs, sunsetMs, nextSunriseMs, params) {
    if (outMs == null) return true;                       // invalid ⇒ certainly no angle
    if (sunriseMs == null || sunsetMs == null || nextSunriseMs == null) return true;
    const night = nextSunriseMs - sunsetMs;
    if (night < 60 * MIN) return true;                    // <1 h night ⇒ no method angle is reachable
    const adj = (((params.adjustments || {})[key] || 0) +
                 ((params.methodAdjustments || {})[key] || 0)) * MIN;
    const safe = key === "fajr" ? sunriseMs - night / 2 : sunsetMs + night / 2;
    return Math.abs(outMs - (safe + adj)) <= 2 * MIN;
  }

  /* ==========================================================================
     daySchedule — THE policy. One mean-solar day at (lat, lon); the only code
     that asks adhan for times. Returns {fajr,sunrise,dhuhr,asr,maghrib,isha}
     each {ms, source, estimated} — ms is ALWAYS a number — plus kind:
     "normal" | "midnightsun" | "polarnight".

     1. REAL ANGLE   — the method's own time wherever the sky reaches it.
     2. SEVENTH      — angle unreachable, |lat| ≤ 60: 1/7 of the LOCAL night.
     3. BORROW60     — angle unreachable, |lat| > 60 (or no day/night cycle at
                       all): the whole night cluster — maghrib, isha, fajr,
                       sunrise — read from the 60° sky at this longitude, so the
                       evening always stays in canonical order. Dhuhr and Asr
                       stay local (Dhuhr flagged in polar night; Asr borrowed
                       when the local sun gives it no sane afternoon).
     Moonsighting Committee is trusted verbatim whenever a cycle exists (the
     method ships its own ≥55° rule). Interval isha (ummalqura/qatar) is real
     with a cycle and joins the cluster without one.
     ========================================================================== */
  function daySchedule(lat, lon, refMs, params, method) {
    const pt = ptFor(lat, lon, refMs, params);
    const real = (ms) => ({ ms, source: "method", estimated: false });
    const out = { dhuhr: real(msOf(pt.dhuhr)) };          // transit: valid at every lat/date

    const sunriseMs = msOf(pt.sunrise), sunsetMs = msOf(pt.sunset);

    if (sunriseMs == null || sunsetMs == null) {
      // ---- no day/night cycle here, as adhan observes it (midnight sun /
      // polar night, including the refraction fringe geometry misses) --------
      const decl = solarDeclination(refMs);
      const polarNight = Math.abs(lat - decl) > Math.abs(lat + decl);
      const b = borrow60(lat, lon, refMs, params);
      const est = (k) => ({ ms: b[k], source: "borrow60", estimated: true });
      out.fajr = est("fajr"); out.sunrise = est("sunrise");
      out.maghrib = est("maghrib"); out.isha = est("isha");
      out.dhuhr.estimated = polarNight;                   // local noon kept, flagged for honesty
      const asrMs = msOf(pt.asr);
      const asrSane = asrMs != null && asrMs > out.dhuhr.ms && asrMs < out.dhuhr.ms + 11 * 3600000;
      out.asr = (!polarNight && asrSane) ? real(asrMs) : est("asr");
      out.kind = polarNight ? "polarnight" : "midnightsun";
      return out;
    }

    // ---- a real day and night exist: sun-disk events + asr are local --------
    out.kind = "normal";
    out.sunrise = real(sunriseMs);
    out.maghrib = real(msOf(pt.maghrib));
    const asrMs = msOf(pt.asr);                           // degenerate near |lat−decl|≈90: range-guard
    out.asr = (asrMs != null && asrMs > out.dhuhr.ms && asrMs < sunsetMs)
      ? real(asrMs)
      : { ms: borrow60(lat, lon, refMs, params).asr, source: "borrow60", estimated: true };

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
    let pt7 = null, floor = false;
    for (const k of ["fajr", "isha"]) {
      if (k === "isha" && params.ishaInterval > 0) { out.isha = real(msOf(pt.isha)); continue; }
      if (!wasSubstituted(k, msOf(pt[k]), sunriseMs, sunsetMs, nextSunriseMs, params)) {
        out[k] = { ms: msOf(pt[k]), source: "angle", estimated: false };
        continue;
      }
      if (Math.abs(lat) > HIGHLAT_FLOOR) { floor = true; continue; }  // resolved below as a cluster
      pt7 = pt7 || ptFor(lat, lon, refMs, seventhParams(params));
      out[k] = { ms: msOf(pt7[k]), source: "seventh", estimated: true };
    }
    if (floor) {
      // rule 3: the whole night cluster from the 60° sky — order-coherent by construction
      const b = borrow60(lat, lon, refMs, params);
      for (const k of ["fajr", "sunrise", "maghrib", "isha"]) {
        out[k] = { ms: b[k], source: "borrow60", estimated: true };
      }
    }
    return out;
  }

  /* prayer instants at a position for the local calendar date implied by the
     longitude (mean solar offset) around a reference instant — raw adhan output */
  function rawInstants(lat, lon, refMs, params) {
    const localApprox = new Date(refMs + (lon / 15) * 3600000);
    const d = new Date(Date.UTC(localApprox.getUTCFullYear(),
                                localApprox.getUTCMonth(),
                                localApprox.getUTCDate(), 12));
    const pt = new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
    const out = {};
    ORDER.forEach(k => { const v = pt[k]; out[k] = (v && !isNaN(v.getTime())) ? v : null; });
    out.sunrise = (pt.sunrise && !isNaN(pt.sunrise.getTime())) ? pt.sunrise : null;
    return out;
  }

  /* Banded high-latitude policy, per prayer and date (estimateBasisFor decides the case):
       - "real":       the sun reaches the chosen angle (or the event exists) → the method's own
                       time stands (MiddleOfTheNight = the real angle wherever it's reachable).
       - "portioned":  the angle has no moment to mark and we're ≤60° → a seventh of the LOCAL night.
       - "substituted":no usable local event AND >60° → borrow latitude 60 (twilight without a night,
                       Maghrib/sunrise without a sunset, Asr in polar night). Dhuhr (solar noon) stays. */
  function instantsAt(lat, lon, refMs, params) {
    const out = Object.assign({}, rawInstants(lat, lon, refMs, params));   // real angle where reachable
    let seventh = null, borrow = null;
    ORDER.forEach(k => {
      if (k === "dhuhr") return;
      const basis = estimateBasisFor(k, lat, refMs, params);
      if (basis === "real") return;
      if (basis === "portioned") {                                         // ≤60°: a seventh of the local night
        seventh = seventh || rawInstants(lat, lon, refMs, seventhParams(params));
        out[k] = seventh[k];
      } else {                                                             // substituted: borrow latitude 60
        borrow = borrow || rawInstants(Math.sign(lat) * HIGHLAT_FLOOR, lon, refMs, seventhParams(params));
        out[k] = borrow[k];
      }
    });
    if (!out.sunrise && Math.abs(lat) > HIGHLAT_FLOOR) {
      borrow = borrow || rawInstants(Math.sign(lat) * HIGHLAT_FLOOR, lon, refMs, seventhParams(params));
      out.sunrise = borrow.sunrise;
    }
    return out;
  }

  /* sunrise instant at a position (when Fajr ends) — follows the same banded policy */
  function sunriseAt(lat, lon, refMs, params) {
    return instantsAt(lat, lon, refMs, params).sunrise;
  }

  const dayKeyOf = (ms, lon) => {
    const l = new Date(ms + (lon / 15) * 3600000);
    return l.getUTCFullYear() + "-" + l.getUTCMonth() + "-" + l.getUTCDate();
  };

  /* sun elevation proxy → arc height. mean solar time of day at the position */
  function solarFrac(lat, lon, ms) {
    const l = new Date(ms + (lon / 15) * 3600000);
    return (l.getUTCHours() + l.getUTCMinutes() / 60) / 24;
  }
  const fmtSolar = (ms, lon) => {
    const l = new Date(ms + (lon / 15) * 3600000);
    return String(l.getUTCHours()).padStart(2, "0") + ":" + String(l.getUTCMinutes()).padStart(2, "0");
  };

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
  const fmtDateSolar = (ms, lon) => _fmtU.format(new Date(ms + (lon / 15) * 3600000));

  function inflightSub(key, ms, dep) {
    if (key === "maghrib") return "Sunset from the window — face the qibla as able";
    const mins = Math.max(0, Math.round((ms - dep) / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    const rel = h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
    if (key === "isha")  return `Aloft — about ${rel} after take-off · may combine with Maghrib`;
    if (key === "dhuhr") return `Aloft — about ${rel} after take-off · may combine with Asr`;
    return `Aloft — about ${rel} after take-off`;
  }

  // hour 0..23 in a civil timezone
  function tzHour(ms, tz) {
    return (+new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz })
              .format(new Date(ms))) % 24;
  }
  function partOfDay(h) {
    if (h < 5)  return "Early hours";
    if (h < 8)  return "Early morning";
    if (h < 12) return "Morning";
    if (h < 14) return "Midday";
    if (h < 17) return "Afternoon";
    if (h < 20) return "Evening";
    return "Night";
  }
  function gapStr(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }
  // Before-departure guidance, aware of HOW LONG before the flight it fell:
  // a prayer just before boarding is actionable; one hours earlier is context.
  function beforeSub(key, ms, dep, tz) {
    const gap = Math.max(0, Math.round((dep - ms) / 60000));
    if (gap <= 210) {   // within ~3.5h of departure → you're heading to the airport
      if (key === "dhuhr") return "Pray at the gate before boarding · may combine with Asr";
      if (key === "asr")   return "Pray at the gate before boarding · may combine with Dhuhr";
      return "Pray at the gate before boarding";
    }
    return `${partOfDay(tzHour(ms, tz))} · about ${gapStr(gap)} before take-off — pray before you set out`;
  }

  function compute(raw, opts) {
    opts = opts || {};
    const params = makeParams(opts.method || "mwl", opts.madhab || "shafi");
    const dep = Date.parse(raw.depUTC), arr = Date.parse(raw.arrUTC);
    const from = raw.from, to = raw.to;
    const entries = [];        // { key, status, ms, lat, lon }
    const seen = new Set();    // key@dayKey — keeps repeats on different days distinct

    // 1. BEFORE departure — prayers already due at the origin (keep the last few)
    const ob = instantsAt(from.lat, from.lon, dep, params);
    const before = [];
    ORDER.forEach(k => { const t = ob[k]; if (t && t.getTime() <= dep) before.push({ key: k, ms: t.getTime() }); });
    before.sort((a, b) => a.ms - b.ms).slice(-BEFORE_CAP).forEach(e => {
      entries.push({ key: e.key, status: "before", ms: e.ms, lat: from.lat, lon: from.lon });
      seen.add(e.key + "@" + dayKeyOf(e.ms, from.lon));
    });

    // 2. IN-FLIGHT — walk the great circle. The local prayer instant is a
    //    MOVING target (it drifts as the aircraft changes longitude), so we
    //    detect a crossing by sign change: the moment the aircraft's clock
    //    catches up to a prayer's instant. A genuine in-flight prayer is one
    //    whose instant falls within the flight window [dep, arr].
    const STEP = 60000; // 1 min
    const prevResid = {};   // dayKey'd residual (ms - prayerInstant)
    for (let ms = dep; ms <= arr; ms += STEP) {
      const f = (arr === dep) ? 0 : (ms - dep) / (arr - dep);
      const pos = greatCircle(from.lat, from.lon, to.lat, to.lon, f);
      const inst = instantsAt(pos.lat, pos.lon, ms, params);
      ORDER.forEach(k => {
        const t = inst[k]; if (!t) return;
        const pm = t.getTime();
        const dk = k + "@" + dayKeyOf(pm, pos.lon);
        const resid = ms - pm;
        const prev = prevResid[dk];
        if (prev !== undefined && prev < 0 && resid >= 0 &&
            pm >= dep && pm <= arr && !seen.has(dk)) {
          seen.add(dk);
          entries.push({ key: k, status: "inflight", ms: pm, lat: pos.lat, lon: pos.lon });
        }
        prevResid[dk] = resid;
      });
    }

    // 3. AFTER arrival — the next few prayers due on the ground at the destination. For a
    //    no-cycle destination (midnight sun / polar night) the next prayers are rolled forward
    //    from latitude-60 estimates; otherwise they are the real arrival-day times. Same count
    //    either way. The branch below picks based on destNoCycle.
    const inst = instantsAt(to.lat, to.lon, arr, params);
    const _arrDecl = solarDeclination(arr);
    const destNoCycle = Math.abs(to.lat + _arrDecl) > 90 || Math.abs(to.lat - _arrDecl) > 90;
    // Only a TRUE no-cycle destination (midnight sun / polar night) gets the special
    // dedup + roll-forward + banner. An above-60 destination that still has a real night
    // (e.g. Oslo in summer) borrows latitude-60 twilight times but otherwise flows through
    // the normal before/in-flight/after placement — and shows no "sun won't set" banner.
    const destSub = destNoCycle
      ? ORDER.filter(k => estimateBasisFor(k, to.lat, arr, params) === "substituted")
      : [];
    let midnightSun = null;
    if (destNoCycle) {
      // Midnight-sun / polar-night DESTINATION: there is no ordinary day/night to set the prayers
      // against, so every prayer is taken from latitude 60 (Dhuhr is the real solar noon). Prayers
      // that fall within the flight window are already captured in-flight; here we add only the
      // NEXT few due after arrival — each rolled to its first occurrence at/after arrival, skipping
      // any already shown — so the journey reads as one gap-free, capped sequence.
      const next = [];
      ORDER.forEach(k => {
        if (!inst[k]) return;
        let t = inst[k].getTime();
        while (t < arr) t += 86400000;
        const dk = k + "@" + dayKeyOf(t, to.lon);
        if (!seen.has(dk)) next.push({ key: k, ms: t, dk });
      });
      next.sort((a, b) => a.ms - b.ms).slice(0, AFTER_CAP).forEach(e => {
        seen.add(e.dk);
        entries.push({ key: e.key, status: "after", ms: e.ms, lat: to.lat, lon: to.lon });
      });
      // distinguish midnight sun (no sunset) from polar night (no sunrise) for honest copy.
      // allEstimated: polar night flags every prayer (Dhuhr/Asr included); midnight sun keeps
      // Dhuhr/Asr real, so only some are estimated.
      midnightSun = {
        city: to.city, iata: to.iata,
        latitude: Math.abs(to.lat).toFixed(1) + "° " + (to.lat >= 0 ? "N" : "S"),
        kind: Math.abs(to.lat + _arrDecl) > 90 ? "midnightsun" : "polarnight",
        allEstimated: ORDER.every(k => estimateBasisFor(k, to.lat, arr, params) !== "real"),
        names: destSub.map(k => META[k].en)
      };
    } else {
      // Normal destination (incl. above-60 with a real night, e.g. Oslo in summer): the next
      // prayers due on the ground at the destination, on the arrival local day (keep the first few).
      const after = [];
      ORDER.forEach(k => {
        const t = inst[k]; if (!t) return;
        const pm = t.getTime();
        const dk = k + "@" + dayKeyOf(pm, to.lon);
        if (pm > arr && !seen.has(dk)) after.push({ key: k, ms: pm, dk });
      });
      after.sort((a, b) => a.ms - b.ms).slice(0, AFTER_CAP).forEach(e => {
        seen.add(e.dk);
        entries.push({ key: e.key, status: "after", ms: e.ms, lat: to.lat, lon: to.lon });
      });
    }

    // ---- assemble ordered display model -------------------------------------
    entries.sort((a, b) => a.ms - b.ms);
    const durationMin = Math.round((arr - dep) / 60000);

    // day labels at each prayer's own locale (origin/dest civil, or solar aloft)
    const dateOf = (e) => e.status === "before" ? fmtDate(e.ms, from.tz)
                        : e.status === "after"  ? fmtDate(e.ms, to.tz)
                        : fmtDateSolar(e.ms, e.lon);
    const dates = entries.map(dateOf);
    const multiDay = new Set(dates).size > 1;
    const counts = {}; entries.forEach(e => { counts[e.key] = (counts[e.key] || 0) + 1; });
    const running = {};

    const prayers = entries.map((a, i) => {
      running[a.key] = (running[a.key] || 0) + 1;
      const seq = counts[a.key] > 1 ? running[a.key] : 0;   // 0 = unique
      const _basis = estimateBasisFor(a.key, a.lat, a.ms, params);
      const _estimated = _basis !== "real";
      // qibla as a CLOCK POSITION off the aircraft's nose (12 = direction of
      // travel) — only meaningful while aloft; on the ground use a normal app
      let qiblaClock = null, qiblaRel = null;
      if (a.status === "inflight") {
        const qAbs = adhan.Qibla(new adhan.Coordinates(a.lat, a.lon));
        const hdg = initialBearing(a.lat, a.lon, to.lat, to.lon);
        qiblaRel = ((qAbs - hdg) % 360 + 360) % 360;
        let hr = Math.round(qiblaRel / 30) % 12; if (hr === 0) hr = 12;
        qiblaClock = hr;
      }
      // altitude horizon-dip: aloft, the sun-disk events shift (Maghrib later,
      // the sunrise that ends Fajr earlier). On the ground there is no shift.
      const altFt = a.status === "inflight" ? (raw.cruiseAltFt || 38000) : 0;
      const dipMs = Math.round(altDipMinutes(a.lat, altFt) * 60000);
      const ms = a.key === "maghrib" ? a.ms + dipMs : a.ms;
      const zones = {
        [from.iata]: { iata: from.iata, city: from.city, time: fmtTZ(ms, from.tz), date: fmtDate(ms, from.tz) },
        [to.iata]:   { iata: to.iata,   city: to.city,   time: fmtTZ(ms, to.tz),   date: fmtDate(ms, to.tz) }
      };
      // Fajr ends at sunrise — captured in both zones (advanced for altitude aloft)
      let sunrise = null;
      if (a.key === "fajr") {
        const sr = sunriseAt(a.lat, a.lon, a.ms, params);
        if (sr) {
          const srMs = sr.getTime() - dipMs;
          sunrise = { [from.iata]: fmtTZ(srMs, from.tz), [to.iata]: fmtTZ(srMs, to.tz) };
        }
      }
      return {
        id: a.key + "-" + i,
        key: a.key, en: META[a.key].en, ar: META[a.key].ar, status: a.status,
        dusk: a.key === "maghrib",
        t: solarFrac(a.lat, a.lon, ms),
        ms,
        qiblaClock, qiblaRel, sunrise,
        estimated: _estimated, estimateBasis: _estimated ? _basis : null,
        zones, seq
      };
    });

    const model = Object.assign({}, raw, {
      durationMin,
      dep: { local: fmtTZ(dep, from.tz) },
      arr: { local: fmtTZ(arr, to.tz) },
      from: Object.assign({}, from),
      to:   Object.assign({}, to),
      cruiseAltFt: raw.cruiseAltFt || 38000,
      prayers, multiDay, midnightSun
    });

    return model;
  }

  return { compute, greatCircle, _test: { makeParams, solarDeclination, daySchedule } };
})();

export const { compute, greatCircle } = ISFAR_ENGINE;
export const ISFAR_TEST = ISFAR_ENGINE._test;
