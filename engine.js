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

window.ISFAR_ENGINE = (function () {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const ORDER = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  const BEFORE_CAP = 2, AFTER_CAP = 2;

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
    return p;
  }

  /* prayer instants at a position for the local calendar date implied by the
     longitude (mean solar offset) around a reference instant */
  function instantsAt(lat, lon, refMs, params) {
    const localApprox = new Date(refMs + (lon / 15) * 3600000);
    const d = new Date(Date.UTC(localApprox.getUTCFullYear(),
                                localApprox.getUTCMonth(),
                                localApprox.getUTCDate(), 12));
    const pt = new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
    const out = {};
    ORDER.forEach(k => { const v = pt[k]; out[k] = (v && !isNaN(v.getTime())) ? v : null; });
    return out;
  }

  /* sunrise instant at a position (when Fajr ends) for the same local date */
  function sunriseAt(lat, lon, refMs, params) {
    const localApprox = new Date(refMs + (lon / 15) * 3600000);
    const d = new Date(Date.UTC(localApprox.getUTCFullYear(),
                                localApprox.getUTCMonth(),
                                localApprox.getUTCDate(), 12));
    const pt = new adhan.PrayerTimes(new adhan.Coordinates(lat, lon), d, params);
    return (pt.sunrise && !isNaN(pt.sunrise.getTime())) ? pt.sunrise : null;
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

    // 3. AFTER arrival — the next prayers due on the ground at the destination,
    //    on the arrival local day (keep the first few)
    const after = [];
    const inst = instantsAt(to.lat, to.lon, arr, params);
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

    // ---- assemble ordered display model -------------------------------------
    entries.sort((a, b) => a.ms - b.ms);
    const META = window.ISFAR_DATA.META;
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
      prayers, multiDay
    });

    // no-sunset: a prayer type undefined at the destination on arrival day
    const destT = instantsAt(to.lat, to.lon, arr, params);
    const undefinedKeys = ORDER.filter(k => !destT[k]);
    if (undefinedKeys.length) {
      model.noSunset = true;
      model.latitude = Math.abs(to.lat).toFixed(1) + "° " + (to.lat >= 0 ? "N" : "S");
      model.defined = prayers.filter(p => p.status !== "after").map(p => ({
        key: p.key, en: p.en, ar: p.ar,
        time: (p.zones[from.iata] || Object.values(p.zones)[0]).time,
        note: p.status === "before" ? "before departure" : "aloft"
      }));
      model.undefinedPrayers = undefinedKeys.map(k => ({ key: k, en: META[k].en, ar: META[k].ar }));
    }

    return model;
  }

  return { compute, greatCircle };
})();
