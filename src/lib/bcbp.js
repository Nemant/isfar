// Pure parser for IATA BCBP ("M" format) boarding-pass barcodes — extracts the
// first leg's flight number, route, and date. No DOM, no imports. Returns null
// for anything that is not a parseable M-format pass. The barcode carries a
// day-of-year but NO year and NO clock times (see julianToDateISO).

function iso(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// Resolve a 1..366 day-of-year to the soonest YYYY-MM-DD that is >= today.
// new Date(year, 0, dayOfYear) is leap-year-correct and rolls over cleanly,
// which we use to reject day 366 in a non-leap year.
export function julianToDateISO(dayOfYear, today = new Date()) {
  if (!(dayOfYear >= 1 && dayOfYear <= 366)) return null;
  const y0 = today.getFullYear();
  const todayMid = new Date(y0, today.getMonth(), today.getDate());
  for (const y of [y0, y0 + 1]) {
    const d = new Date(y, 0, dayOfYear);
    if (d.getFullYear() === y && d >= todayMid) return iso(d);
  }
  // day 366 in a non-leap year is not a representable date — reject it
  return null;
}

export function parseBCBP(raw, today = new Date()) {
  if (typeof raw !== 'string' || raw.length < 60 || raw[0] !== 'M') return null;
  const from = raw.slice(30, 33).trim();
  const to = raw.slice(33, 36).trim();
  const carrier = raw.slice(36, 39).trim();
  const flightRaw = raw.slice(39, 44).trim();
  const julian = parseInt(raw.slice(44, 47), 10);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  if (!/^[A-Z0-9]{2,3}$/.test(carrier)) return null;
  const m = flightRaw.match(/^0*(\d{1,4}[A-Z]?)$/);
  if (!m || !Number.isFinite(julian)) return null;
  const dateISO = julianToDateISO(julian, today);
  if (!dateISO) return null;
  return { code: carrier + m[1], dateISO, fromIata: from, toIata: to };
}
