# Monitoring & Alerting (isfar-monitor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A separate hourly-cron Cloudflare Worker `isfar-monitor` that emails the operator (via Resend) when today's upstream usage crosses 80% of `isfar-flight`'s `CEILING`, or when the `busy` error rate over the last hour is elevated.

**Architecture:** New Worker in `monitor/`, decoupled from `isfar-flight`. On each hourly tick it reads the KV counter `upstream:count:{date}` (ceiling input) and queries the `isfar_lookups` Analytics Engine dataset via the SQL API (busy input), reads `isfar-flight`'s live `CEILING` via the Workers settings API (single source of truth), and sends de-duped emails. A secret-gated `fetch` probe allows manual runs / test emails.

**Tech Stack:** Cloudflare Workers (ESM), cron triggers, KV, Workers Analytics Engine SQL API, Resend, `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-16-monitoring-alerting-design.md`

**Established facts:**
- KV namespace `FLIGHT_CACHE` id `7cb844a84ef149a88d0c4cbe517461ed` (preview `91de0eb4e47742aeb9ada815275b4e08`); counter key `upstream:count:{YYYY-MM-DD}`.
- Account `1eb2fd914b081774a2b5fe1db1fcecf0`. AE dataset `isfar_lookups` (`blob3` = errorKind `ok|notfound|busy`).
- `isfar-flight`'s `CEILING` is readable as a `plain_text` binding via `GET /accounts/{acct}/workers/scripts/isfar-flight/settings` (verified → `1000`).
- Resend verified working: From `alerts@isfar.app` → `danishkhan91@gmail.com`. Key in `~/.isfar_env` as `RESEND_API_KEY`. `CLOUDFLARE_API_TOKEN` in `~/.isfar_env` reads AE + worker settings.
- Worker tests are dependency-free `node:test` (see `worker/test/`).

---

## File Structure
- `monitor/package.json` — ESM, `test`/`deploy`/`dev` scripts.
- `monitor/wrangler.toml` — name, `main`, cron, KV binding, vars.
- `monitor/src/index.js` — pure helpers + I/O + `scheduled`/`fetch` handlers.
- `monitor/test/monitor.test.mjs` — node:test.
- `monitor/README.md` — purpose, thresholds, uptime health URLs, deploy steps.

---

## Task C1: Scaffold config

**Files:** Create `monitor/package.json`, `monitor/wrangler.toml`.

- [ ] **Step 1: Create `monitor/package.json`**
```json
{
  "name": "isfar-monitor",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"test/*.mjs\"",
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  }
}
```

- [ ] **Step 2: Create `monitor/wrangler.toml`**
```toml
# isfar-monitor — hourly cron Worker: emails on ceiling/busy thresholds.
name = "isfar-monitor"
main = "src/index.js"
compatibility_date = "2025-01-01"

[triggers]
crons = ["0 * * * *"]   # hourly

[vars]
ALERT_EMAIL = "danishkhan91@gmail.com"
FROM_EMAIL = "alerts@isfar.app"
ACCOUNT_ID = "1eb2fd914b081774a2b5fe1db1fcecf0"
CEILING_PCT = "0.8"        # alert at >=80% of CEILING
CEILING_FALLBACK = "1000"  # used only if the live CEILING read fails
BUSY_RATIO = "0.25"        # alert if busy/total >= 25% ...
BUSY_MIN_TOTAL = "8"       # ... with at least this many lookups in the window

# Shares isfar-flight's namespace (reads upstream:count:{date}, stores alert:* dedup keys)
[[kv_namespaces]]
binding = "FLIGHT_CACHE"
id = "7cb844a84ef149a88d0c4cbe517461ed"
preview_id = "91de0eb4e47742aeb9ada815275b4e08"

# Secrets (set via `wrangler secret put`, never committed):
#   RESEND_API_KEY   — Resend sending key
#   CF_API_TOKEN     — reads the isfar_lookups AE dataset + isfar-flight settings
#   MONITOR_SECRET   — gates the manual ?token= probe
```

- [ ] **Step 3: Validate config parses (no deploy, no auth)**

Run: `cd monitor && npx wrangler deploy --dry-run --outdir /tmp/monitor-dryrun 2>&1 | tail -15; cd ..`
Expected: it fails because `src/index.js` doesn't exist yet OR reports the bindings. If it complains only about the missing entry file, that's fine for this step (config itself parsed). Do not treat a missing-secret warning as failure.

- [ ] **Step 4: Commit**
```bash
git add monitor/package.json monitor/wrangler.toml
git commit -m "feat(monitor): scaffold isfar-monitor worker config (hourly cron, KV, vars)"
```

---

## Task C2: Pure helpers (decision + email formatting) — TDD

**Files:** Create `monitor/src/index.js` (helpers only for now), `monitor/test/monitor.test.mjs`.

- [ ] **Step 1: Write the failing tests `monitor/test/monitor.test.mjs`**
```js
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
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd monitor && node --test "test/*.mjs"; cd ..`
Expected: cannot import from `../src/index.js` (file missing) → fail.

- [ ] **Step 3: Create `monitor/src/index.js` with the pure helpers**
```js
// monitor/src/index.js
//
// isfar-monitor — hourly cron Worker. Emails (via Resend) when today's upstream
// usage crosses CEILING_PCT of isfar-flight's live CEILING, or when the "busy"
// error rate over the last hour is elevated. A secret-gated fetch() probe allows
// manual runs / test emails. Decoupled from isfar-flight so it can't affect it.

/* ----------------------------------------------------------------------- *
 * pure decision + formatting helpers
 * ----------------------------------------------------------------------- */

export function ceilingBreach(count, ceiling, pct) {
  return Number(count) >= Number(pct) * Number(ceiling);
}

export function busyBreach(busy, total, { ratio, minTotal }) {
  const t = Number(total);
  if (t < Number(minTotal) || t === 0) return false;
  return Number(busy) / t >= Number(ratio);
}

export function ceilingEmail(count, ceiling) {
  const pctUsed = Math.round((Number(count) / Number(ceiling)) * 100);
  return {
    subject: `⚠️ Isfar: upstream usage at ${pctUsed}% of the daily ceiling`,
    text:
`Today's AeroDataBox upstream usage has reached ${count} of ${ceiling} (${pctUsed}%).

This is the upgrade trigger — raise CEILING or bump the AeroDataBox tier before lookups start returning "busy".

— isfar-monitor`,
  };
}

export function busyEmail(busy, total, windowHrs) {
  const pct = total ? Math.round((Number(busy) / Number(total)) * 100) : 0;
  return {
    subject: `⚠️ Isfar: elevated "busy" errors (${busy}/${total} lookups)`,
    text:
`In the last ${windowHrs}h, ${busy} of ${total} /api/flight lookups returned "busy" (${pct}%).

"busy" means upstream AeroDataBox 5xx/429, the daily ceiling, or a worker error. Worth investigating: an upstream outage, a stampede on a hot flight, or the ceiling being hit.

— isfar-monitor`,
  };
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `cd monitor && node --test "test/*.mjs"; cd ..`
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**
```bash
git add monitor/src/index.js monitor/test/monitor.test.mjs
git commit -m "feat(monitor): pure ceiling/busy breach + email-builder helpers (TDD)"
```

---

## Task C3: I/O + orchestration + handlers — TDD

**Files:** Modify `monitor/src/index.js`, `monitor/test/monitor.test.mjs`.

- [ ] **Step 1: Append failing tests to `monitor/test/monitor.test.mjs`**
```js
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
  // routes: fn(url, opts) -> {json?, ok?} ; records resend calls
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
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd monitor && node --test "test/*.mjs"; cd ..`
Expected: `readCeiling`/`runChecks`/default export not defined → fail.

- [ ] **Step 3: Append I/O + orchestration + handlers to `monitor/src/index.js`**
```js
/* ----------------------------------------------------------------------- *
 * I/O (best-effort; each swallows its own errors)
 * ----------------------------------------------------------------------- */

const todayUtc = () => new Date().toISOString().slice(0, 10);

// isfar-flight's live CEILING (single source of truth); fallback on any error.
export async function readCeiling(env) {
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/workers/scripts/isfar-flight/settings`,
      { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } }
    );
    const d = await r.json();
    const binds = (d && d.result && d.result.bindings) || [];
    const v = binds.find((b) => b.type === "plain_text" && b.name === "CEILING");
    const n = v && Number(v.text);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (e) { console.log("readCeiling failed:", e); }
  return Number(env.CEILING_FALLBACK) || 1000;
}

// busy + total over the last hour from the isfar_lookups AE dataset.
export async function queryBusy(env) {
  const sql =
    "SELECT sumIf(_sample_interval, blob3 = 'busy') AS busy, sum(_sample_interval) AS total " +
    "FROM isfar_lookups WHERE timestamp > now() - INTERVAL '1' HOUR";
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`,
      { method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }, body: sql }
    );
    const d = await r.json();
    const row = (d && d.data && d.data[0]) || {};
    return { busy: Number(row.busy) || 0, total: Number(row.total) || 0 };
  } catch (e) { console.log("queryBusy failed:", e); return { busy: 0, total: 0 }; }
}

export async function sendEmail(env, { subject, text }) {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.FROM_EMAIL, to: [env.ALERT_EMAIL], subject, text }),
    });
    return r.ok;
  } catch (e) { console.log("sendEmail failed:", e); return false; }
}

/* ----------------------------------------------------------------------- *
 * orchestration — both checks independent + error-isolated
 * ----------------------------------------------------------------------- */

export async function runChecks(env) {
  const today = todayUtc();
  const out = { today, ceiling: null, count: 0, busy: 0, total: 0, alerts: [] };

  try {
    out.ceiling = await readCeiling(env);
    out.count = Number(await env.FLIGHT_CACHE.get(`upstream:count:${today}`)) || 0;
    if (ceilingBreach(out.count, out.ceiling, env.CEILING_PCT)) {
      const dedup = `alert:ceiling:${today}`;
      if (!(await env.FLIGHT_CACHE.get(dedup)) &&
          (await sendEmail(env, ceilingEmail(out.count, out.ceiling)))) {
        await env.FLIGHT_CACHE.put(dedup, "1", { expirationTtl: 60 * 60 * 48 });
        out.alerts.push("ceiling");
      }
    }
  } catch (e) { console.log("ceiling check failed:", e); }

  try {
    const { busy, total } = await queryBusy(env);
    out.busy = busy; out.total = total;
    if (busyBreach(busy, total, { ratio: env.BUSY_RATIO, minTotal: env.BUSY_MIN_TOTAL })) {
      const dedup = "alert:busy:cooldown";
      if (!(await env.FLIGHT_CACHE.get(dedup)) &&
          (await sendEmail(env, busyEmail(busy, total, 1)))) {
        await env.FLIGHT_CACHE.put(dedup, "1", { expirationTtl: 60 * 60 * 6 });
        out.alerts.push("busy");
      }
    }
  } catch (e) { console.log("busy check failed:", e); }

  return out;
}

export default {
  async scheduled(event, env, ctx) {
    await runChecks(env);
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.MONITOR_SECRET || url.searchParams.get("token") !== env.MONITOR_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    if (url.searchParams.get("email") === "1") {
      await sendEmail(env, { subject: "Isfar monitor — manual test", text: "Manual probe test email. The monitor can send. — isfar-monitor" });
    }
    const status = await runChecks(env);
    return new Response(JSON.stringify(status, null, 2), { headers: { "content-type": "application/json" } });
  },
};
```

- [ ] **Step 4: Run, confirm PASS**

Run: `cd monitor && node --test "test/*.mjs"; cd ..`
Expected: all tests (C2 + C3) pass.

- [ ] **Step 5: Validate it bundles**

Run: `cd monitor && npx wrangler deploy --dry-run --outdir /tmp/monitor-dryrun 2>&1 | tail -8; cd ..`
Expected: dry-run succeeds (bundles `src/index.js`; secret warnings OK).

- [ ] **Step 6: Commit**
```bash
git add monitor/src/index.js monitor/test/monitor.test.mjs
git commit -m "feat(monitor): readCeiling/queryBusy/sendEmail + scheduled/fetch handlers (TDD)"
```

---

## Task C4: README

**Files:** Create `monitor/README.md`.

- [ ] **Step 1: Write `monitor/README.md`**
```markdown
# isfar-monitor

Hourly cron Worker that emails the operator when something needs attention.
Decoupled from `isfar-flight` so it can never affect live lookups.

## Alerts
- **Ceiling ≥80%** — today's `upstream:count:{date}` (KV) ≥ `CEILING_PCT` × `isfar-flight`'s live `CEILING`. One email/day. The upgrade trigger.
- **Busy rate** — over the last hour, `busy / total ≥ BUSY_RATIO` with `total ≥ BUSY_MIN_TOTAL` (from the `isfar_lookups` AE dataset). One email per 6h. Signals upstream 5xx/429, ceiling, or a stampede.

`CEILING` is read live from `isfar-flight` (single source of truth); `CEILING_FALLBACK` is only used if that read fails.

## Config
Vars in `wrangler.toml`: `ALERT_EMAIL`, `FROM_EMAIL`, `ACCOUNT_ID`, `CEILING_PCT`, `CEILING_FALLBACK`, `BUSY_RATIO`, `BUSY_MIN_TOTAL`.
Secrets: `RESEND_API_KEY`, `CF_API_TOKEN`, `MONITOR_SECRET`.

## Deploy
```bash
source ~/.isfar_env
printf %s "$RESEND_API_KEY"        | npx wrangler secret put RESEND_API_KEY --name isfar-monitor
printf %s "$CLOUDFLARE_API_TOKEN"  | npx wrangler secret put CF_API_TOKEN   --name isfar-monitor
printf %s "<random>"               | npx wrangler secret put MONITOR_SECRET --name isfar-monitor
cd monitor && npx wrangler deploy
```

## Manual probe
`GET https://isfar-monitor.<subdomain>.workers.dev/?token=<MONITOR_SECRET>` → JSON of current numbers.
Add `&email=1` to also send a test email.

## Uptime (separate, operator action)
Point an external monitor (UptimeRobot free / Cloudflare Health Checks) at:
- `https://isfar.app/`
- `https://isfar.app/api/flight?code=BA117`
Alerting on outage independent of Cloudflare's own signals.
```

- [ ] **Step 2: Commit**
```bash
git add monitor/README.md
git commit -m "docs(monitor): README — alerts, config, deploy, uptime URLs"
```

---

## Task C5 (GATED — operator authorized "build and ship"): deploy + verify + merge

- [ ] **Step 1: Set secrets (values never printed)**
```bash
source ~/.isfar_env
printf %s "$RESEND_API_KEY"       | npx wrangler secret put RESEND_API_KEY --name isfar-monitor
printf %s "$CLOUDFLARE_API_TOKEN" | npx wrangler secret put CF_API_TOKEN   --name isfar-monitor
MON_SECRET=$(openssl rand -hex 16)
printf %s "$MON_SECRET"           | npx wrangler secret put MONITOR_SECRET --name isfar-monitor
echo "MONITOR_SECRET set (length ${#MON_SECRET})"   # do not echo the value elsewhere
```
Keep `$MON_SECRET` in the shell for Step 3.

- [ ] **Step 2: Deploy**
```bash
source ~/.isfar_env
cd monitor && npx wrangler deploy 2>&1 | tail -15; cd ..
```
Expected: deploy succeeds; cron `0 * * * *` registered; bindings show `FLIGHT_CACHE` + the three secrets.

- [ ] **Step 3: Verify email delivery + current numbers via the probe**
```bash
URL="https://isfar-monitor.isfar-app.workers.dev/?token=$MON_SECRET&email=1"
curl -4 -s "$URL" | python3 -m json.tool
```
Expected: JSON with `today`, `ceiling` (1000, read live), `count`, `busy`, `total`. A "manual test" email arrives at danishkhan91@gmail.com. (No threshold alert unless actually breached.)

- [ ] **Step 4: Force a real ceiling alert without touching isfar-flight**

Temporarily lower the monitor's own `CEILING_PCT` so the current count breaches, re-run the probe, confirm the ceiling email, then restore. (We change only the monitor's var; `isfar-flight`'s real cap is untouched.)
```bash
cd monitor
# set CEILING_PCT very low via a one-off var override deploy
sed -i 's/CEILING_PCT = "0.8"/CEILING_PCT = "0.0001"/' wrangler.toml
source ~/.isfar_env && npx wrangler deploy 2>&1 | tail -3
curl -4 -s "https://isfar-monitor.isfar-app.workers.dev/?token=$MON_SECRET" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("alerts fired:",d["alerts"])'
# expect alerts includes "ceiling" and a ceiling email arrives
git checkout -- wrangler.toml   # restore CEILING_PCT="0.8"
source ~/.isfar_env && npx wrangler deploy 2>&1 | tail -3
cd ..
```
Expected: `alerts fired: ['ceiling']` and a ceiling email; then restored to 0.8.

- [ ] **Step 5: Confirm clean tree + run all tests once more**
```bash
git checkout -- package-lock.json 2>/dev/null
cd monitor && node --test "test/*.mjs" 2>&1 | grep -E "^# (tests|pass|fail)"; cd ..
git status --short
```
Expected: monitor tests pass; tree clean (wrangler.toml restored).

- [ ] **Step 6: Merge to main (ships nothing to the site build; the monitor is already deployed)**
```bash
git fetch origin
git rebase origin/main
cd monitor && node --test "test/*.mjs" >/dev/null 2>&1 && echo "monitor tests OK after rebase" ; cd ..
git push origin HEAD:main
```
Expected: fast-forward push (re-rebase if origin/main moved). Note: merging only lands the monitor *source* on main; the monitor Worker deploys via `wrangler deploy` (Step 2), not the site build.

---

## Self-review notes (author)
- **Spec coverage:** ceiling alert (C2 `ceilingBreach` + C3 orchestration + KV dedup), busy alert ratio-only (C2 `busyBreach` + C3 `queryBusy`), single-source CEILING (C3 `readCeiling` via settings API + fallback), Resend email (C3 `sendEmail`), hourly cron + KV + vars (C1), manual probe (C3 `fetch`), tests (C2/C3), README + uptime URLs (C4), gated deploy/verify/merge (C5). All covered.
- **No client/site changes** — purely a new worker dir; the site build is untouched.
- **Type consistency:** `ceilingBreach(count,ceiling,pct)`, `busyBreach(busy,total,{ratio,minTotal})`, `readCeiling(env)→number`, `queryBusy(env)→{busy,total}`, `sendEmail(env,{subject,text})→bool`, `runChecks(env)→{...,alerts[]}` consistent across tasks + tests.
- **Error isolation:** every I/O swallows its own errors; one check failing never blocks the other; a failed `sendEmail` does NOT set the dedup key (so it retries next tick).
