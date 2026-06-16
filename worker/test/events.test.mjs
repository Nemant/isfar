// worker/test/events.test.mjs
//
// Dependency-free Node tests for the Analytics Engine emission added to the
// flight handler. We exercise the two exits that need NO upstream fetch:
//   - cache HIT  -> writeDataPoint(['LHR-JED','hit','ok'])
//   - blank code -> writeDataPoint(['','miss','notfound'])
// plus routeOf() purely, and the env.AE-absent no-throw guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { routeOf } from "../src/index.js";

function aeSpy() {
  const points = [];
  return { points, writeDataPoint: (p) => points.push(p) };
}
const req = (qs) => new Request("https://isfar.app/api/flight" + qs);

test("routeOf builds dep-arr or empty", () => {
  assert.equal(routeOf({ from: { iata: "LHR" }, to: { iata: "JED" } }), "LHR-JED");
  assert.equal(routeOf({}), "");
  assert.equal(routeOf(null), "");
});

test("cache hit emits hit/ok with the route", async () => {
  const AE = aeSpy();
  const cached = JSON.stringify({ found: true, from: { iata: "LHR" }, to: { iata: "JED" } });
  const env = { AE, FLIGHT_CACHE: { get: async () => cached, put: async () => {} } };
  const res = await worker.fetch(req("?code=SV124"), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(AE.points.length, 1);
  assert.deepEqual(AE.points[0].blobs, ["LHR-JED", "hit", "ok"]);
  assert.deepEqual(AE.points[0].indexes, ["LHR-JED"]);
});

test("blank code emits miss/notfound with empty route", async () => {
  const AE = aeSpy();
  const env = { AE, FLIGHT_CACHE: { get: async () => null, put: async () => {} } };
  const res = await worker.fetch(req("?code="), env, { waitUntil() {} });
  assert.equal(res.status, 404);
  assert.equal(AE.points.length, 1);
  assert.deepEqual(AE.points[0].blobs, ["", "miss", "notfound"]);
});

test("missing AE binding does not throw", async () => {
  const cached = JSON.stringify({ found: true, from: { iata: "LHR" }, to: { iata: "JED" } });
  const env = { FLIGHT_CACHE: { get: async () => cached, put: async () => {} } };
  const res = await worker.fetch(req("?code=SV124"), env, { waitUntil() {} });
  assert.equal(res.status, 200);
});
