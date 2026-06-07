// A0 validation harness — run this with YOUR RapidAPI key to confirm AeroDataBox
// returns everything the engine needs, BEFORE we deploy. The key is read from the
// environment, never hard-coded, so it stays out of git and out of any transcript.
//
// Usage (run it yourself in the terminal):
//   ! RAPIDAPI_KEY=your_key node worker/validate.mjs SV124
//   ! RAPIDAPI_KEY=your_key node worker/validate.mjs SV124 2026-06-09
//
// It prints the mapped Isfar record + a PASS/FAIL on the two non-recoverable
// fields (lat/lon + IANA tz for both endpoints). Share the output (it contains
// no secret) and we adjust the mapping if anything is missing.

import { mapFlight } from "./src/map.js";

const KEY = process.env.RAPIDAPI_KEY;
const code = (process.argv[2] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const date = process.argv[3] || new Date().toISOString().slice(0, 10);

if (!KEY) { console.error("✗ Set RAPIDAPI_KEY in the environment first."); process.exit(1); }
if (!code) { console.error("✗ Pass a flight code, e.g. node worker/validate.mjs SV124"); process.exit(1); }

const url = `https://aerodatabox.p.rapidapi.com/flights/number/${code}/${date}?withLocation=true`;
console.log(`→ AeroDataBox: ${code} on ${date}\n`);

const resp = await fetch(url, {
  headers: { "X-RapidAPI-Key": KEY, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" },
});

if (!resp.ok) {
  console.error(`✗ HTTP ${resp.status} ${resp.statusText}`);
  console.error(await resp.text());
  process.exit(1);
}

const data = await resp.json();
const segments = Array.isArray(data) ? data : (data.flights || [data]);
console.log(`Raw segments returned: ${segments.length}`);
console.log("─".repeat(60));
console.log("RAW (first segment, trimmed):");
console.log(JSON.stringify(segments[0], null, 2).slice(0, 1400));
console.log("─".repeat(60));

const record = mapFlight(segments[0]);
console.log("MAPPED Isfar record:");
console.log(JSON.stringify(record, null, 2));
console.log("─".repeat(60));

// PASS/FAIL on the fields the engine cannot live without
const ok = record.found
  && Number.isFinite(record.from?.lat) && Number.isFinite(record.from?.lon)
  && Number.isFinite(record.to?.lat) && Number.isFinite(record.to?.lon)
  && record.from?.tz && record.to?.tz
  && record.depUTC && record.arrUTC;

console.log(ok ? "✓ PASS — has lat/lon + tz + UTC times for both endpoints." :
                 "✗ FAIL — missing a required field above (lat/lon, tz, or UTC time).");
console.log(`  zone/gmt derived: ${record.from?.zone}/${record.from?.gmt} → ${record.to?.zone}/${record.to?.gmt}`);
console.log(`  human date: ${record.date}`);
process.exit(ok ? 0 : 2);
