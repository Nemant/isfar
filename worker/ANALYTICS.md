# Isfar analytics — querying usage

Two independent sources:

## 1. Web Analytics (site traffic)
Cloudflare dashboard → **Analytics & Logs → Web Analytics** → site `isfar.app`
(`site_tag fe65d368751c4df2af43e10aacc820c0`). Cookieless pageviews, top pages,
referrers, geo, Core Web Vitals. Beacon is the manual `<script>` in every page
`<head>` (see `src/components/StaticShell.astro` + the bespoke heads).
SPA note: the calculator pushes `?flight=…` / `?from=…` virtual pageviews via
the History API, which the beacon auto-tracks; the dashboard may roll these
under `/` rather than splitting by query string.

## 2. Workers Analytics Engine (`isfar_lookups` dataset)
One data point per `/api/flight` lookup, emitted by `worker/src/index.js`:
- `blob1` = route (`"LHR-JED"`, or `""` when unresolved)
- `blob2` = cache result (`"hit"` | `"miss"`)
- `blob3` = error kind (`"ok"` | `"notfound"` | `"busy"`)
- `index1` = route (sampling key)
- `double1` = 1 (count)

### SQL API
```bash
source ~/.isfar_env   # CLOUDFLARE_API_TOKEN
ACCT=1eb2fd914b081774a2b5fe1db1fcecf0
curl -4 "https://api.cloudflare.com/client/v4/accounts/$ACCT/analytics_engine/sql" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data "SELECT blob1 AS route, blob2 AS cache, blob3 AS err, sum(_sample_interval) AS n
          FROM isfar_lookups
          WHERE timestamp > now() - INTERVAL '1' DAY
          GROUP BY route, cache, err ORDER BY n DESC"
```

### Cache-hit ratio (the cost-shield health number)
```sql
SELECT
  sumIf(_sample_interval, blob2 = 'hit')  AS hits,
  sum(_sample_interval)                    AS total,
  hits / total                             AS hit_ratio
FROM isfar_lookups
WHERE timestamp > now() - INTERVAL '1' DAY
```

### Top routes (feeds the GSC-gated SEO route waves)
```sql
SELECT blob1 AS route, sum(_sample_interval) AS n
FROM isfar_lookups
WHERE blob1 != '' AND timestamp > now() - INTERVAL '7' DAY
GROUP BY route ORDER BY n DESC LIMIT 25
```

### Error-kind breakdown (busy = ceiling/upstream pressure; feeds alerting)
```sql
SELECT blob3 AS err, sum(_sample_interval) AS n
FROM isfar_lookups
WHERE timestamp > now() - INTERVAL '1' DAY
GROUP BY err ORDER BY n DESC
```

These queries are what the sub-project C cron alert worker will automate.
