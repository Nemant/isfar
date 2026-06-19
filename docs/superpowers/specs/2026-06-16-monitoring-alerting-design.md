# Monitoring & alerting — design

**Date:** 2026-06-16
**Status:** approved (brainstorm), pre-implementation
**Sub-project C** of the analytics/observability workstream (build order B → A → **C**).
Implements the "Monitoring & alerting" section of `ROADMAP.md`.

## Goal

Email the operator when one of two things needs attention, so action happens
*before* users are hurt or *while* an incident is live:

1. **Ceiling (cost/capacity, slow):** today's upstream AeroDataBox usage crosses
   80% of the daily `CEILING` — the signal to raise the ceiling / upgrade the
   tier **before** lookups start returning `busy`. Proactive.
2. **Busy rate (failure, fast):** an unusual number of `/api/flight` lookups
   returned `busy` (HTTP 503 — upstream 5xx/429, ceiling hit, or worker error)
   in the last hour. Reactive — "users are getting errors now, investigate."

Explicitly **out of scope** (operator actions, per roadmap / brainstorm):
uptime/latency pinging (UptimeRobot/Health Checks — the monitor's README lists
the health URLs to plug in), cache-hit-ratio alert, and a daily "all healthy"
digest. Cloudflare dashboard Notifications remain a separate zero-code backstop.

## What "busy" is (the alert's input)

`isfar-flight` answers each `/api/flight` lookup as `ok` / `notfound` / `busy`
and records `errorKind` in the `isfar_lookups` Analytics Engine dataset.
`notfound` is a normal user typo (ignored). **`busy` = a failure on our side**
(upstream 5xx, RapidAPI 429 after retries, `CEILING` reached, or unexpected
error). The busy alert watches the rate of `busy` over the trailing hour.

## Architecture

A **new, separate Worker** `isfar-monitor` in `monitor/`, decoupled from
`isfar-flight` so a monitoring failure can never affect live lookups. It does no
real web serving; it wakes on an **hourly cron** and emails via Resend when a
threshold trips. Free-plan friendly (24 cron invocations/day; tiny KV usage).

### Bindings / vars / secrets
- **KV `FLIGHT_CACHE`** (same namespace as `isfar-flight`, id
  `7cb844a84ef149a88d0c4cbe517461ed`): reads `upstream:count:{YYYY-MM-DD}` (the
  ceiling input) and stores the alert-dedup keys.
- **Vars:** `CEILING="1000"` (monitor's own copy; keep in sync with
  `isfar-flight`), `ALERT_EMAIL="danishkhan91@gmail.com"`,
  `FROM_EMAIL="alerts@isfar.app"`, `ACCOUNT_ID="1eb2fd914b081774a2b5fe1db1fcecf0"`,
  `CEILING_PCT="0.8"`, `BUSY_MIN="10"`, `BUSY_RATIO="0.25"`, `BUSY_MIN_TOTAL="8"`.
- **Secrets:** `RESEND_API_KEY` (operator-provided, from `~/.isfar_env`),
  `CF_API_TOKEN` (= the existing `CLOUDFLARE_API_TOKEN`; reads the AE dataset via
  the SQL API — verified that token can read AE), `MONITOR_SECRET` (random;
  gates the manual probe).
- **Cron:** `crons = ["0 * * * *"]` (hourly).

## Components (each a small, testable unit)

| Unit | Responsibility | Serves |
|---|---|---|
| `ceilingBreach(count, ceiling, pct)` | pure: `count ≥ pct × ceiling`? | ceiling alert decision |
| `busyBreach(busy, total, {min, ratio, minTotal})` | pure: `busy ≥ min` OR (`busy/total ≥ ratio` AND `total ≥ minTotal`) | busy alert decision |
| `ceilingEmail(count, ceiling)` / `busyEmail(busy, total, windowHrs)` | pure: `{subject, text}` (numbers + suggested action) | clear, testable email bodies |
| `queryBusy(env)` | POST the AE SQL API; returns `{busy, total}` for the last hour | busy alert input |
| `sendEmail(env, {subject, text})` | POST Resend `/emails` (From `FROM_EMAIL`, To `ALERT_EMAIL`, `Authorization: Bearer RESEND_API_KEY`) | delivery |
| `scheduled(event, env, ctx)` | orchestrate: read counter + query busy → check both rules → email + set dedup; each check independent + error-swallowed | the hourly routine |
| `fetch(request, env)` | secret-gated (`?token=MONITOR_SECRET`) probe: returns current numbers as JSON; `&email=1` sends a test email | live delivery verification + "show numbers now" |

### Data flow (each hourly tick)
1. `today = ` UTC `YYYY-MM-DD`. `count = Number(KV.get(upstream:count:{today}) || 0)`.
2. If `ceilingBreach(count, CEILING, CEILING_PCT)` **and** `!KV.get(alert:ceiling:{today})`
   → `sendEmail(ceilingEmail(count, CEILING))`; `KV.put(alert:ceiling:{today}, "1", {expirationTtl: 48h})`.
3. `{busy, total} = await queryBusy(env)` (last 1h). If `busyBreach(busy, total, …)`
   **and** `!KV.get(alert:busy:cooldown)` → `sendEmail(busyEmail(busy, total, 1))`;
   `KV.put(alert:busy:cooldown, "1", {expirationTtl: 6h})`.
4. Both steps wrapped so one failure (e.g. AE briefly unqueryable) never blocks
   the other; failures are `console.log`ged, not thrown.

### AE query (`queryBusy`)
POST `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/analytics_engine/sql`
with `Authorization: Bearer CF_API_TOKEN`, body:
```sql
SELECT
  sumIf(_sample_interval, blob3 = 'busy') AS busy,
  sum(_sample_interval)                   AS total
FROM isfar_lookups
WHERE timestamp > now() - INTERVAL '1' HOUR
```
Parse `data[0]` → `{busy: Number, total: Number}` (default 0/0 on empty/error).

### Dedup / anti-spam
- Ceiling: `alert:ceiling:{today}` → at most one email per day (resets with the
  daily counter).
- Busy: `alert:busy:cooldown` (TTL 6h) → at most one email per 6h during a
  sustained incident.

## Testing (TDD)

`monitor/test/monitor.test.mjs`, dependency-free `node:test` (matches
`isfar-flight`'s style):
- `ceilingBreach`: under / at / over 80%.
- `busyBreach`: under both rules; over the absolute floor; over the ratio with
  enough sample; **not** firing on tiny samples (e.g. 2 busy of 3 total).
- email builders: subject/body contain the key numbers.
- `scheduled` with mock `env` (mock KV + mock global `fetch` for AE SQL and
  Resend): emails when a rule trips; **no** email when healthy; **no** email
  when the dedup key is already set (suppression).

## Verification (live, gated)
- The secret-gated `fetch` probe (`?token=…&email=1`) confirms real Resend
  delivery to the inbox without touching the live counter.
- A momentary deploy with a low `CEILING` var (the monitor's own var — does NOT
  affect `isfar-flight`) confirms a real ceiling email fires on the next probe,
  then restore `CEILING="1000"`.

## Deploy (GATED — requires operator authorization)
1. Operator adds `RESEND_API_KEY` to `~/.isfar_env` (done out-of-band).
2. `source ~/.isfar_env`; set secrets via stdin pipe (never printed):
   `printf %s "$RESEND_API_KEY" | wrangler secret put RESEND_API_KEY --name isfar-monitor`;
   same for `CF_API_TOKEN` (= `$CLOUDFLARE_API_TOKEN`) and a generated `MONITOR_SECRET`.
3. `cd monitor && wrangler deploy` (registers the hourly cron).
4. Verify via the probe; tune thresholds if needed.

## File structure
- `monitor/src/index.js` — handlers + pure helpers.
- `monitor/wrangler.toml` — name, KV binding, vars, cron.
- `monitor/test/monitor.test.mjs` — node:test.
- `monitor/package.json` — `{ "type": "module", "scripts": { "test": "node --test \"test/*.mjs\"" } }`.
- `monitor/README.md` — what it does, the thresholds, the uptime health URLs, deploy steps.
