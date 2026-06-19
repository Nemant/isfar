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

import worker, { readCeiling, runChecks } from "../src/index.js";

// minimal in-memory KV + a fetch stub router
function mockKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v); },
  };
}
function stubFetch(routes) {
  const calls = { resend: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/workers/scripts/isfar-flight/settings")) {
      return { ok: true, json: async () => ({ result: { bindings: [{ type: "plain_text", name: "CEILING", text: "1000" }] } }) };
    }
    if (u.includes("/analytics_engine/sql")) {
      return { ok: true, json: async () => ({ data: [routes.busyRow || { busy: 0, total: 0 }] }) };
    }
    if (u.includes("api.resend.com")) {
      calls.resend.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: "test" }) };
    }
    throw new Error("unexpected fetch " + u);
  };
  return calls;
}
const baseEnv = (kv) => ({
  FLIGHT_CACHE: kv, ACCOUNT_ID: "acct", CF_API_TOKEN: "t", RESEND_API_KEY: "re_x",
  ALERT_EMAIL: "to@example.com", FROM_EMAIL: "alerts@isfar.app",
  CEILING_PCT: "0.8", CEILING_FALLBACK: "1000", BUSY_RATIO: "0.25", BUSY_MIN_TOTAL: "8",
});
const today = () => new Date().toISOString().slice(0, 10);

test("readCeiling reads live value, falls back on error", async () => {
  stubFetch({});
  assert.equal(await readCeiling(baseEnv(mockKV())), 1000);
  globalThis.fetch = async () => { throw new Error("down"); };
  assert.equal(await readCeiling({ ...baseEnv(mockKV()), CEILING_FALLBACK: "777" }), 777);
});

test("scheduled: ceiling breach sends one email then dedups", async () => {
  const kv = mockKV({ [`upstream:count:${today()}`]: "900" });
  const calls = stubFetch({ busyRow: { busy: 0, total: 0 } });
  const env = baseEnv(kv);
  await worker.scheduled({}, env, { waitUntil() {} });
  assert.equal(calls.resend.length, 1);
  assert.match(calls.resend[0].subject, /ceiling/i);
  assert.ok(await kv.get(`alert:ceiling:${today()}`));     // dedup set
  await worker.scheduled({}, env, { waitUntil() {} });       // second run
  assert.equal(calls.resend.length, 1);                      // suppressed
});

test("scheduled: busy breach sends, healthy sends nothing", async () => {
  const kv = mockKV({ [`upstream:count:${today()}`]: "0" });
  const calls = stubFetch({ busyRow: { busy: 5, total: 10 } });  // 50% >= 25%, total >= 8
  await worker.scheduled({}, baseEnv(kv), { waitUntil() {} });
  assert.equal(calls.resend.length, 1);
  assert.match(calls.resend[0].subject, /busy/i);

  const kv2 = mockKV({ [`upstream:count:${today()}`]: "0" });
  const calls2 = stubFetch({ busyRow: { busy: 0, total: 50 } });
  await worker.scheduled({}, baseEnv(kv2), { waitUntil() {} });
  assert.equal(calls2.resend.length, 0);
});
