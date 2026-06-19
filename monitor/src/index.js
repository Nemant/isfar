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
