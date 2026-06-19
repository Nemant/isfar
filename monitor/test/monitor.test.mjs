// monitor/test/monitor.test.mjs — dependency-free node:test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilingBreach, busyBreach, ceilingEmail, busyEmail } from "../src/index.js";

test("ceilingBreach at/over/under 80%", () => {
  assert.equal(ceilingBreach(799, 1000, 0.8), false);
  assert.equal(ceilingBreach(800, 1000, 0.8), true);
  assert.equal(ceilingBreach(950, 1000, 0.8), true);
  // string env values must coerce
  assert.equal(ceilingBreach("800", "1000", "0.8"), true);
});

test("busyBreach is ratio-only with a minimum sample", () => {
  assert.equal(busyBreach(2, 3, { ratio: 0.25, minTotal: 8 }), false);   // tiny sample
  assert.equal(busyBreach(1, 10, { ratio: 0.25, minTotal: 8 }), false);  // 10% < 25%
  assert.equal(busyBreach(3, 10, { ratio: 0.25, minTotal: 8 }), true);   // 30% >= 25%
  assert.equal(busyBreach(2, 8, { ratio: 0.25, minTotal: 8 }), true);    // 25% >= 25%, total ok
  assert.equal(busyBreach("3", "10", { ratio: "0.25", minTotal: "8" }), true);
});

test("email builders include the key numbers", () => {
  const c = ceilingEmail(900, 1000);
  assert.match(c.subject, /90%/);
  assert.match(c.text, /900 of 1000/);
  const b = busyEmail(3, 10, 1);
  assert.match(b.subject, /3\/10/);
  assert.match(b.text, /3 of 10/);
});
