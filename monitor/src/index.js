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
