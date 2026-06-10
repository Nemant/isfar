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
    // a method whose maghrib is an angle after sunset (Tehran) can outrun the
    // seventh-of-night isha — re-anchor the portion on the method's own nightfall
    const sunset = msOf(pt.sunset);
    if (out.isha != null && out.maghrib != null && sunset != null && out.isha <= out.maghrib) {
      out.isha = out.maghrib + (out.isha - sunset);
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
      const asrSane = asrMs != null && asrMs > out.dhuhr.ms &&
                      b.maghrib != null && asrMs < b.maghrib;  // keep the afternoon before the (borrowed) dusk
      out.asr = (!polarNight && asrSane) ? real(asrMs) : est("asr");
      out.kind = polarNight ? "polarnight" : "midnightsun";
      return out;
    }

    // ---- a real day and night exist: sun-disk events + asr are local --------
    out.kind = "normal";
    out.sunrise = real(sunriseMs);
    out.maghrib = real(msOf(pt.maghrib));
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
    // a method whose maghrib is an angle after sunset (Tehran) can outrun the
    // seventh-of-night isha — re-anchor the portion on the method's own nightfall
    if (out.isha && out.isha.source === "seventh" && out.isha.ms <= out.maghrib.ms) {
      out.isha = { ms: out.maghrib.ms + (out.isha.ms - sunsetMs), source: "seventh", estimated: true };
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
    const method = opts.method || "mwl";
    const params = makeParams(method, opts.madhab || "shafi");
    const dep = Date.parse(raw.depUTC), arr = Date.parse(raw.arrUTC);
    const from = raw.from, to = raw.to;
    const sched = (lat, lon, refMs) => daySchedule(lat, lon, refMs, params, method);

    const entries = [];   // {key, status, ms, lat, lon, source, estimated, sunriseMs, sunriseReal}
    const push = (key, status, e, day, lat, lon, ms) => entries.push({
      key, status, ms, lat, lon, source: e.source, estimated: e.estimated,
      sunriseMs: day.sunrise.ms, sunriseReal: !day.sunrise.estimated
    });

    // 1. BEFORE — the last prayers due at the origin, scanning the previous
    //    solar day too so red-eye departures still get their context prayers.
    const before = [];
    for (const off of [-1, 0]) {
      const s = sched(from.lat, from.lon, dep + off * DAY);
      ORDER.forEach(k => { if (s[k].ms <= dep) before.push({ k, s, e: s[k] }); });
    }
    before.sort((a, b) => a.e.ms - b.e.ms).slice(-BEFORE_CAP)
      .forEach(({ k, s, e }) => push(k, "before", e, s, from.lat, from.lon, e.ms));

    // 2. IN-FLIGHT — walk the great circle minute by minute. Each prayer's
    //    instant is a MOVING target (it drifts as the aircraft changes
    //    longitude); a sign flip of (clock − instant) marks the moment it
    //    becomes due aloft. The policy is discontinuous where the angle stops
    //    being reachable, so when the schedule JUMPED past the clock we record
    //    the moment of the jump (when it became due) — never a time from the
    //    past, and never silently dropped.
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
            T = Math.min(arr, T + Math.round(altDipMinutes(pos.lat, raw.cruiseAltFt || 38000) * 60000));
          }
          push(k, "inflight", e, s, pos.lat, pos.lon, T);
        }
        prevResid[dk] = resid;
      });
    }

    // 3. AFTER — the next prayers on the ground at the destination, rolling
    //    into the following day so a late-night arrival still sees tomorrow's
    //    Fajr. Same path for normal and polar destinations. A prayer already
    //    shown (e.g. prayed aloft on a westbound leg) is skipped and the list
    //    topped up, so it always holds the next AFTER_CAP genuine prayers.
    const after = [];
    for (const off of [0, 1]) {
      const s = sched(to.lat, to.lon, arr + off * DAY);
      ORDER.forEach(k => { if (s[k].ms > arr) after.push({ k, s, e: s[k] }); });
    }
    after.sort((a, b) => a.e.ms - b.e.ms);
    const shownNear = (key, ms) => entries.some(x => x.key === key && Math.abs(ms - x.ms) < 6 * 3600000);
    let added = 0;
    for (const { k, s, e } of after) {
      if (added >= AFTER_CAP) break;
      if (shownNear(k, e.ms)) continue;
      push(k, "after", e, s, to.lat, to.lon, e.ms);
      added++;
    }

    // 4. MERGE — sort, then drop any same-prayer repeat within 6 h (the same
    //    prayer cannot recur that fast; genuine repeats on long eastbound
    //    flights are ~16 h+ apart). Replaces cross-list dedup keys.
    entries.sort((a, b) => a.ms - b.ms);
    const lastAt = {};
    const merged = entries.filter(e => {
      if (lastAt[e.key] !== undefined && e.ms - lastAt[e.key] < 6 * 3600000) return false;
      lastAt[e.key] = e.ms;
      return true;
    });

    // 5. SKY NOTES — a banner per no-cycle endpoint (origin AND destination).
    const skyNotes = [];
    for (const [place, pt, refMs] of [["origin", from, dep], ["destination", to, arr]]) {
      const s = sched(pt.lat, pt.lon, refMs);
      if (s.kind === "normal") continue;
      skyNotes.push({
        place, city: pt.city, iata: pt.iata,
        latitude: Math.abs(pt.lat).toFixed(1) + "° " + (pt.lat >= 0 ? "N" : "S"),
        kind: s.kind,
        allEstimated: ORDER.every(k => s[k].estimated),
        names: ORDER.filter(k => s[k].estimated).map(k => META[k].en)
      });
    }

    // ---- assemble ordered display model -------------------------------------
    const durationMin = Math.round((arr - dep) / 60000);

    // day labels at each prayer's own locale (origin/dest civil, or solar aloft)
    const dateOf = (e) => e.status === "before" ? fmtDate(e.ms, from.tz)
                        : e.status === "after"  ? fmtDate(e.ms, to.tz)
                        : fmtDateSolar(e.ms, e.lon);
    const multiDay = new Set(merged.map(dateOf)).size > 1;
    const counts = {}; merged.forEach(e => { counts[e.key] = (counts[e.key] || 0) + 1; });
    const running = {};

    const prayers = merged.map((a, i) => {
      running[a.key] = (running[a.key] || 0) + 1;
      const seq = counts[a.key] > 1 ? running[a.key] : 0;   // 0 = unique
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
      // altitude horizon-dip for the Fajr-ending sunrise (earlier aloft) — the
      // Maghrib dip was already baked in at capture, before sorting. Real sun
      // events only; estimates get no fake precision.
      const altFt = a.status === "inflight" ? (raw.cruiseAltFt || 38000) : 0;
      const dipMs = Math.round(altDipMinutes(a.lat, altFt) * 60000);
      const ms = a.ms;
      const zones = {
        [from.iata]: { iata: from.iata, city: from.city, time: fmtTZ(ms, from.tz), date: fmtDate(ms, from.tz) },
        [to.iata]:   { iata: to.iata,   city: to.city,   time: fmtTZ(ms, to.tz),   date: fmtDate(ms, to.tz) }
      };
      // Fajr ends at sunrise — captured in both zones (advanced for altitude
      // aloft only when the sunrise is the real local one)
      let sunrise = null;
      if (a.key === "fajr" && a.sunriseMs != null) {
        const srMs = a.sunriseMs - (a.sunriseReal ? dipMs : 0);
        const pre = a.sunriseReal ? "" : "~";              // borrowed sunrise is an estimate too
        sunrise = { [from.iata]: pre + fmtTZ(srMs, from.tz), [to.iata]: pre + fmtTZ(srMs, to.tz) };
      }
      return {
        id: a.key + "-" + i,
        key: a.key, en: META[a.key].en, ar: META[a.key].ar, status: a.status,
        dusk: a.key === "maghrib",
        t: solarFrac(a.lat, a.lon, ms),
        ms,
        qiblaClock, qiblaRel, sunrise,
        estimated: a.estimated, estimateBasis: a.estimated ? a.source : null,
        source: a.source,
        zones, seq
      };
    });

    return Object.assign({}, raw, {
      durationMin,
      dep: { local: fmtTZ(dep, from.tz) },
      arr: { local: fmtTZ(arr, to.tz) },
      from: Object.assign({}, from),
      to:   Object.assign({}, to),
      cruiseAltFt: raw.cruiseAltFt || 38000,
      prayers, multiDay, skyNotes
    });
  }

  return { compute, greatCircle, _test: { makeParams, solarDeclination, daySchedule } };
})();

export const { compute, greatCircle } = ISFAR_ENGINE;
export const ISFAR_TEST = ISFAR_ENGINE._test;
