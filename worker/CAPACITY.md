# CAPACITY.md — stop worrying about the 1 QPS AeroDataBox limit

**TL;DR: 1 QPS is never the binding constraint. The `CEILING=1000/day` cost cap
and the monthly plan quota bind *first*, by a wide margin. Re-read this instead
of being paranoid.**

This is a back-of-envelope capacity model for the `/api/flight` upstream call to
[AeroDataBox](https://aerodatabox.com/). It exists so future-me stops re-deriving
"is 1 query/second enough?" every time traffic ticks up.

## The throughput budget

1 QPS is a *rate*, so the raw daily ceiling is:

```
1 req/s × 86,400 s/day = 86,400 upstream calls/day   (theoretical max)
```

The Worker self-caps upstream at `CEILING = 1000/day` (`src/index.js`, KV key
`upstream:count:{date}`). So on pure throughput there's **~86× headroom** — we'd
have to lift our own ceiling 86-fold before the *average* rate could approach
1 QPS.

To **sustain** >1 QPS you'd need >1 cache-miss every second, all day =
86,400 misses/day. The 1000/day ceiling makes that structurally impossible.
**1 QPS can therefore only be breached by sub-second bursts, never by volume.**
Everything below is about how (un)likely those bursts are.

## Why misses are rare: the cache only ever sees *unique flight-days*

Upstream is hit only on a cache miss = the *first* lookup of a given
`(flight, date)`. Demand that reaches AeroDataBox is **unique flight-days**, not
total user lookups.

Globally there are **~110,000 scheduled commercial flights/day**. Spread `L`
lookups across that pool; average lookups-per-flight = `L / 110,000`:

| Daily lookups `L` | Avg lookups/flight | Cache hit rate | Upstream calls/day |
|---|---|---|---|
| 100 (soft launch) | 0.0009 | ~0% | ~100 |
| 1,000 (modest) | 0.009 | ~2% | ~980 |
| 10,000 (popular) | 0.09 | ~8% | ~9,200 → **capped at 1,000** |
| 100,000 (viral) | 0.9 | ~35% | ~65,000 → **capped at 1,000** |

The twist: early on the cache barely helps (almost nobody looks up the *same*
flight-day), so misses ≈ lookups. **`CEILING=1000` bites long before 1 QPS does**
— at roughly ~1,000–1,500 lookups/day the daily cost cap, not the rate limit,
becomes the governing constraint.

## Burst risk #1 — random collision (Poisson)

Even at the full 1,000 misses/day, model arrivals as Poisson and concentrate them
pessimistically — say 80% inside a 6-hour peak window:

```
λ_peak = 800 / (6×3600 s) ≈ 0.037 misses/second
P(≥2 misses in the same 1 s bucket) ≈ λ²/2 ≈ 0.00069
```

Across 21,600 peak seconds: `21,600 × 0.00069 ≈ 15 seconds/day` where two
upstream calls collide. In those ~15 seconds one request waits ~1 s (or retries).
**Negligible.**

## Burst risk #2 — cache stampede (the only real one)

The genuine failure mode isn't average load — it's a *thundering herd*: many
people looking up one popular flight in the ~1 s before KV populates, all missing
at once.

Worst realistic case at 10,000 lookups/day: 1% (100 lookups) hit a single
mega-popular route (a Hajj/Umrah trunk leg), looked up mostly in a ~12 h window
before travel:

```
λ_flight = 100 / 43,200 s ≈ 0.0023/s
P(≥2 within the 1 s fill window) ≈ λ²/2 ≈ 2.7e-6 per second
× 43,200 s ≈ 0.1 stampede events/day
```

So even the hottest flight stampedes ~once every 10 days, producing a *2-call*
burst. Stampedes only become a 1-QPS problem if a single flight-day pulls
**thousands** of near-simultaneous lookups — a scale at which we'd have
re-architected anyway.

## What actually limits us, in order

1. **`CEILING=1000/day`** (cost cap) — bites first, ~1k lookups/day.
2. **Per-IP rate limit** (Cloudflare WAF, currently 10 req/10 s) — stops
   single-user abuse; unrelated to upstream rate.
3. **1 QPS upstream** — only reachable via sub-second stampede (~0.1 events/day
   even for the hottest flight at "popular app" scale).

## Recommendations (priority order)

- **Watch the monthly plan quota, not the QPS.** AeroDataBox tiers cap *monthly*
  calls. At 1,000 misses/day a 30k/month quota burns out in ~30 days — that's the
  real ceiling. Lower `CEILING` if the quota is tight.
- **Add single-flight de-dup** (stale-while-revalidate / a short KV lock) only if
  we ever scale past ~10k lookups/day — it collapses the one real burst mode
  (stampede) into a single upstream call. Cheap insurance, not urgent.
- **Don't touch the rate handling.** Nothing in plausible traffic justifies more
  than 1 QPS upstream.

## Re-run this when

The numbers shift only if: (a) the AeroDataBox plan's monthly quota changes,
(b) `CEILING` changes, or (c) DAU jumps an order of magnitude. Plug the new
`L` (daily lookups) and quota into the table above; the QPS conclusion holds
until the *monthly* quota is the thing you're hitting.
