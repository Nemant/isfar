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
