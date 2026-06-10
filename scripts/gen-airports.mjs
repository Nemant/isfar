#!/usr/bin/env node
/* gen-airports.mjs — build src/assets/airports.json for route mode.
   Sources (downloaded at RUN time; the OUTPUT is committed, builds are offline):
   - OurAirports airports.csv — which airports have scheduled service + IATA
   - mwgg/Airports airports.json — IANA timezone per airport
   Rerun manually if the dataset ever needs refreshing: node scripts/gen-airports.mjs */
import { writeFileSync } from 'node:fs';

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const MWGG = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

// minimal CSV parser (handles quoted fields with commas)
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const clean = (name) => name.replace(/\s+(International\s+)?Airport$/i, '').trim();

const [csvText, mwgg] = await Promise.all([
  fetch(OURAIRPORTS).then((r) => r.text()),
  fetch(MWGG).then((r) => r.json()),
]);

// IANA tz by IATA from mwgg (ICAO-keyed entries carry an `iata` + `tz` field)
const tzByIata = {};
for (const k of Object.keys(mwgg)) {
  const a = mwgg[k];
  if (a.iata && a.tz) tzByIata[a.iata] = a.tz;
}

const rows = parseCSV(csvText);
const head = rows[0];
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const TYPE_RANK = { large_airport: 0, medium_airport: 1, small_airport: 2 };

const out = [];
for (const r of rows.slice(1)) {
  if (r.length < head.length) continue;
  if (r[col.scheduled_service] !== 'yes') continue;
  const iata = r[col.iata_code];
  if (!/^[A-Z]{3}$/.test(iata)) continue;
  const type = r[col.type];
  if (!(type in TYPE_RANK)) continue;
  const tz = tzByIata[iata];
  if (!tz) continue;                       // no IANA tz → unusable for us
  const lat = +(+r[col.latitude_deg]).toFixed(4);
  const lon = +(+r[col.longitude_deg]).toFixed(4);
  if (!isFinite(lat) || !isFinite(lon)) continue;
  const city = r[col.municipality] || clean(r[col.name]);
  out.push({ rank: TYPE_RANK[type], row: [iata, city, clean(r[col.name]), lat, lon, tz] });
}

out.sort((a, b) => a.rank - b.rank || (a.row[0] < b.row[0] ? -1 : 1));
const seen = new Set();
const airports = out.filter(({ row }) => !seen.has(row[0]) && seen.add(row[0])).map(({ row }) => row);

if (airports.length < 2000 || airports.length > 8000) {
  throw new Error(`suspicious airport count: ${airports.length}`);
}
for (const iata of ['LHR', 'JED', 'TOS', 'LAX', 'PER', 'DXB']) {
  if (!airports.some((a) => a[0] === iata)) throw new Error(`missing sanity airport ${iata}`);
}

const json = JSON.stringify({ v: 1, airports });
writeFileSync(new URL('../src/assets/airports.json', import.meta.url), json);
console.log(`wrote ${airports.length} airports, ${(json.length / 1024).toFixed(0)} KB raw`);
