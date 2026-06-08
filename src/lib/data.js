/* ===========================================================================
   Isfar — flight records (placeholder; in production from a flight API)
   Real coordinates + true departure/arrival in UTC, plus IANA timezones.
   Prayer times are NOT stored here — they are computed live by engine.js
   (adhan-js) at the aircraft's position along the great-circle path.
   =========================================================================== */

const ISFAR_DATA = (function () {

  // ---- Hero route: London → Jeddah (the pilgrim's arc, crosses dusk) ------
  const SV124 = {
    found: true,
    airline: "Saudia",
    code: "SV124",
    aircraft: "Boeing 787-9",
    dateISO: "2026-06-06",
    date: "Saturday, 6 June 2026",
    from: { iata: "LHR", city: "London", airport: "Heathrow",
            lat: 51.4700, lon: -0.4543, tz: "Europe/London", zone: "BST", gmt: "GMT+1" },
    to:   { iata: "JED", city: "Jeddah", airport: "King Abdulaziz",
            lat: 21.6796, lon: 39.1565, tz: "Asia/Riyadh", zone: "AST", gmt: "GMT+3" },
    depUTC: "2026-06-06T13:20:00Z",   // 14:20 BST
    arrUTC: "2026-06-06T20:05:00Z"    // 23:05 AST  → 6h 45m
  };

  // ---- BA codeshare alias -------------------------------------------------
  const BA286 = Object.assign({}, SV124, { airline: "British Airways", code: "BA286" });

  // ---- Ultra-long-haul, eastbound: sweeps >24h of solar time, so prayers
  //      recur (a 2nd Fajr/Dhuhr) — more than five prayer windows in one flight
  const QF10 = {
    found: true,
    airline: "Qantas",
    code: "QF10",
    aircraft: "Boeing 787-9",
    dateISO: "2026-06-06",
    date: "Saturday, 6 June 2026",
    from: { iata: "LHR", city: "London", airport: "Heathrow",
            lat: 51.4700, lon: -0.4543, tz: "Europe/London", zone: "BST", gmt: "GMT+1" },
    to:   { iata: "PER", city: "Perth", airport: "Perth Intl",
            lat: -31.9403, lon: 115.9669, tz: "Australia/Perth", zone: "AWST", gmt: "GMT+8" },
    depUTC: "2026-06-06T12:00:00Z",   // 13:00 BST
    arrUTC: "2026-06-07T05:00:00Z"    // 13:00 AWST next day → 17h 00m
  };

  // ---- Westbound, chasing the sun: the day STRETCHES, so very few prayers
  //      fall in flight — 16h aloft but the sun barely moves
  const EK215 = {
    found: true,
    airline: "Emirates",
    code: "EK215",
    aircraft: "Airbus A380-800",
    dateISO: "2026-06-06",
    date: "Saturday, 6 June 2026",
    from: { iata: "DXB", city: "Dubai", airport: "Dubai Intl",
            lat: 25.2528, lon: 55.3644, tz: "Asia/Dubai", zone: "GST", gmt: "GMT+4" },
    to:   { iata: "LAX", city: "Los Angeles", airport: "Los Angeles Intl",
            lat: 33.9416, lon: -118.4085, tz: "America/Los_Angeles", zone: "PDT", gmt: "GMT−7" },
    depUTC: "2026-06-06T04:30:00Z",   // 08:30 GST
    arrUTC: "2026-06-06T20:45:00Z"    // 13:45 PDT same day → 16h 15m
  };

  // ---- Edge case: high-latitude midnight sun (no true sunset) -------------
  const DY394 = {
    found: true,
    airline: "Norwegian",
    code: "DY394",
    aircraft: "Boeing 737-800",
    dateISO: "2026-06-06",
    date: "Saturday, 6 June 2026",
    from: { iata: "OSL", city: "Oslo",   airport: "Gardermoen",
            lat: 60.1939, lon: 11.1004, tz: "Europe/Oslo", zone: "CEST", gmt: "GMT+2" },
    to:   { iata: "TOS", city: "Tromsø", airport: "Langnes",
            lat: 69.6833, lon: 18.9189, tz: "Europe/Oslo", zone: "CEST", gmt: "GMT+2" },
    depUTC: "2026-06-06T20:10:00Z",   // 22:10 CEST
    arrUTC: "2026-06-06T22:05:00Z"    // 00:05 CEST  → 1h 55m
  };

  const FLIGHTS = { SV124, BA286, QF10, EK215, DY394 };

  function lookup(raw) {
    const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code) return { error: "empty" };
    if (FLIGHTS[code]) return FLIGHTS[code];
    if (/^[A-Z]{2}\d{1,4}$/.test(code)) return { found: false, error: "notfound", code };
    return { found: false, error: "format", code };
  }

  // Optional absolute base for the flight Worker (e.g. a cross-origin API host).
  // Left empty in production so requests go to the SAME origin: "" + "/api/flight".
  const API_BASE = (typeof window !== "undefined" && window.ISFAR_API_BASE) || "";

  // Whether to hit the real Worker API or the built-in sample table.
  //   Production (served from a real domain) → real API (same-origin /api/flight).
  //   Local dev (file://, localhost, blank host) → sample table, so the chips work
  //   with no backend and offline.
  // Override with window.ISFAR_USE_REMOTE = true | false.
  function useRemoteApi() {
    if (typeof window === "undefined" || !window.location) return false;
    if (window.ISFAR_USE_REMOTE === true) return true;
    if (window.ISFAR_USE_REMOTE === false) return false;
    const h = window.location.hostname || "";
    const local = window.location.protocol === "file:" || h === "" ||
                  h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" ||
                  h.endsWith(".local");
    return !local;
  }

  // Async lookup. Resolves to the SAME shapes as lookup(): a success record, or
  // { found:false, error:... } / { error:"empty" }. Format + empty checks happen
  // client-side first (instant feedback, no network round-trip).
  function lookupRemote(raw, date) {
    const code = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code) return Promise.resolve({ error: "empty" });
    if (!/^[A-Z]{2,3}\d{1,4}$/.test(code)) {
      return Promise.resolve({ found: false, error: "format", code });
    }

    // Local dev: use the synchronous sample table (no backend needed, works offline).
    if (!useRemoteApi()) {
      return Promise.resolve(lookup(code));
    }

    // Production: the curated sample codes still resolve from the local table so the
    // demo chips reliably illustrate their edge cases (midnight sun, stretched day,
    // recurring prayers); every other flight number goes to the live Worker.
    if (FLIGHTS[code]) {
      return Promise.resolve(FLIGHTS[code]);
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return Promise.resolve({ found: false, error: "offline" });
    }

    const url = `${API_BASE}/api/flight?code=${encodeURIComponent(code)}` +
                (date ? `&date=${encodeURIComponent(date)}` : "");

    return fetch(url)
      .then((resp) => {
        if (resp.status === 503 || resp.status === 429) return { found: false, error: "busy" };
        return resp.json().then((body) => {
          if (resp.status === 404) {
            return body && body.error
              ? body
              : { found: false, error: "notfound", code };
          }
          return body;
        });
      })
      .catch(() => ({ found: false, error: "offline" }));
  }

  // colour key per prayer → CSS sun-arc variables
  const COLOR = {
    fajr: "var(--sky-fajr)",
    dhuhr: "var(--sky-dhuhr)",
    asr: "var(--sky-asr)",
    maghrib: "var(--sky-maghrib)",
    isha: "var(--sky-isha)"
  };

  const META = {
    fajr:    { en: "Fajr",    ar: "الفجر" },
    dhuhr:   { en: "Dhuhr",   ar: "الظهر" },
    asr:     { en: "Asr",     ar: "العصر" },
    maghrib: { en: "Maghrib", ar: "المغرب" },
    isha:    { en: "Isha",    ar: "العشاء" }
  };

  // calculation methods — each maps directly to an adhan library method
  const METHODS = [
    { key: "mwl",          label: "Muslim World League" },
    { key: "isna",         label: "ISNA (North America)" },
    { key: "moonsighting", label: "Moonsighting Committee" },
    { key: "egyptian",     label: "Egyptian General Authority" },
    { key: "ummalqura",    label: "Umm al-Qura (Makkah)" },
    { key: "dubai",        label: "Dubai (UAE)" },
    { key: "qatar",        label: "Qatar" },
    { key: "kuwait",       label: "Kuwait" },
    { key: "karachi",      label: "Karachi (Pakistan)" },
    { key: "singapore",    label: "Singapore (MUIS)" },
    { key: "turkey",       label: "Diyanet (Turkey)" },
    { key: "tehran",       label: "Tehran (Ja‘fari)" }
  ];

  const GUIDANCE = [
    {
      key: "qasr", title: "Qasr", ar: "قصر", label: "Shortening",
      body: "On a journey, the four-rak'ah prayers — Dhuhr, Asr and Isha — are prayed as two rak'ah. Fajr (2) and Maghrib (3) are unchanged. Qasr applies once you leave your town and continues until you return."
    },
    {
      key: "jam", title: "Jam'", ar: "جمع", label: "Combining",
      body: "A traveller may combine Dhuhr with Asr, and Maghrib with Isha — praying them together at the time of either the earlier (taqdīm) or the later (ta'khīr) prayer. This is a mercy that eases worship while in transit, such as on a long flight."
    }
  ];

  return { lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, SAMPLE: "SV124" };
})();

export const { lookup, lookupRemote, COLOR, META, METHODS, GUIDANCE, SAMPLE } = ISFAR_DATA;
