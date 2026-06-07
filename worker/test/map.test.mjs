// worker/test/map.test.mjs
//
// Dependency-free Node tests for the pure mapFlight() layer.
//   run:  node --test worker/test/
//
// Feeds a realistic AeroDataBox segment (SV124 LHR->JED, matching their
// documented withLocation=true shape) through mapFlight() and asserts the
// output matches worker/fixtures/SV124.json, plus the non-recoverable
// (missing-location) -> notfound path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { mapFlight, _internals } from "../src/map.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "../fixtures/SV124.json"), "utf8"));

// A realistic AeroDataBox segment for SV124 LHR->JED, ?withLocation=true.
// Shapes follow AeroDataBox's documented "flights/number" response: an array
// of segments, each with departure/arrival.airport.{iata,name,shortName,
// municipalityName,location.{lat,lon},timeZone} and scheduledTime.{utc,local}.
function sampleSV124() {
  return {
    number: "SV 124",
    airline: { name: "Saudia" },
    aircraft: { model: "Boeing 787-9" },
    departure: {
      airport: {
        iata: "LHR",
        icao: "EGLL",
        name: "London Heathrow",
        shortName: "Heathrow",
        municipalityName: "London",
        location: { lat: 51.47, lon: -0.4543 },
        timeZone: "Europe/London",
      },
      scheduledTime: { utc: "2026-06-06 13:20Z", local: "2026-06-06 14:20+01:00" },
    },
    arrival: {
      airport: {
        iata: "JED",
        icao: "OEJN",
        name: "King Abdulaziz International Airport",
        shortName: "King Abdulaziz",
        municipalityName: "Jeddah",
        location: { lat: 21.6796, lon: 39.1565 },
        timeZone: "Asia/Riyadh",
      },
      scheduledTime: { utc: "2026-06-06 20:05Z", local: "2026-06-06 23:05+03:00" },
    },
  };
}

test("mapFlight maps SV124 to the contract record (matches fixture)", () => {
  const rec = mapFlight(sampleSV124());

  assert.equal(rec.found, true);
  assert.equal(rec.airline, fixture.airline);
  assert.equal(rec.code, fixture.code);
  assert.equal(rec.aircraft, fixture.aircraft);
  assert.equal(rec.dateISO, fixture.dateISO);

  // Strict-ISO Z reformat (Date.parse-safe, engine.js:173).
  assert.equal(rec.depUTC, fixture.depUTC);
  assert.equal(rec.arrUTC, fixture.arrUTC);

  // from / to — string fields must equal the fixture exactly.
  for (const side of ["from", "to"]) {
    assert.equal(rec[side].iata, fixture[side].iata, `${side}.iata`);
    assert.equal(rec[side].city, fixture[side].city, `${side}.city`);
    assert.equal(rec[side].airport, fixture[side].airport, `${side}.airport`);
    assert.equal(rec[side].tz, fixture[side].tz, `${side}.tz`);
    // Intl-derived labels — the load-bearing reconciliation (BST / AST etc).
    assert.equal(rec[side].zone, fixture[side].zone, `${side}.zone`);
    assert.equal(rec[side].gmt, fixture[side].gmt, `${side}.gmt`);
    // lat/lon with float tolerance.
    assert.ok(Math.abs(rec[side].lat - fixture[side].lat) < 1e-4, `${side}.lat`);
    assert.ok(Math.abs(rec[side].lon - fixture[side].lon) < 1e-4, `${side}.lon`);
  }

  // cruiseAltFt must NOT be present (engine defaults to 38000).
  assert.equal("cruiseAltFt" in rec, false);
});

test("date is the correctly Intl-derived en-GB weekday for dateISO", () => {
  // NOTE: the fixture's hand-authored `date` reads "Friday, 6 June 2026", but
  // 2026-06-06 is in fact a SATURDAY. The contract says `date` is *derived*
  // from dateISO via Intl en-GB, so we assert the correct derivation here (and
  // flag the fixture typo for the orchestrator). The string format is what the
  // contract pins; the weekday is computed, never trusted from the fixture.
  const rec = mapFlight(sampleSV124());
  assert.equal(rec.date, "Saturday, 6 June 2026");
});

test("missing departure location => notfound (engine would NaN)", () => {
  const seg = sampleSV124();
  delete seg.departure.airport.location; // non-recoverable
  const rec = mapFlight(seg);
  assert.deepEqual(rec, { found: false, error: "notfound", code: "SV124" });
});

test("missing arrival timezone => notfound", () => {
  const seg = sampleSV124();
  delete seg.arrival.airport.timeZone;
  const rec = mapFlight(seg);
  assert.deepEqual(rec, { found: false, error: "notfound", code: "SV124" });
});

test("aircraft missing => em-dash placeholder", () => {
  const seg = sampleSV124();
  delete seg.aircraft;
  const rec = mapFlight(seg);
  assert.equal(rec.aircraft, "—");
});

test("ICAO fallback when IATA absent", () => {
  const seg = sampleSV124();
  delete seg.departure.airport.iata;
  const rec = mapFlight(seg);
  assert.equal(rec.from.iata, "EGLL");
});

test('trailing " Airport" is stripped from the calm label', () => {
  // arrival shortName is "King Abdulaziz"; force the name-with-Airport path.
  const seg = sampleSV124();
  delete seg.arrival.airport.shortName;
  const rec = mapFlight(seg);
  assert.equal(rec.to.airport, "King Abdulaziz International"); // "Airport" suffix stripped
});

test("internal helpers: strict ISO + zone derivation", () => {
  assert.equal(_internals.toStrictIsoZ("2026-06-06 13:20Z"), "2026-06-06T13:20:00Z");
  assert.equal(_internals.toStrictIsoZ("2026-06-06T20:05:00.000Z"), "2026-06-06T20:05:00Z");
  const inst = new Date("2026-06-06T13:20:00Z");
  assert.equal(_internals.deriveZone("Europe/London", inst), "BST");
  assert.equal(_internals.deriveZone("Asia/Riyadh", inst), "AST");
  assert.equal(_internals.deriveGmt("Asia/Riyadh", inst), "GMT+3");
});
