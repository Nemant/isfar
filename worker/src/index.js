// worker/src/index.js
//
// Isfar flight-lookup Worker.  GET /api/flight?code=&date=  ->  the success
// record consumed verbatim by engine.compute() (see worker/CONTRACT.md).
//
// Request lifecycle (in order):
//   1. parse + normalize `code` exactly like data.js:82; reject empty
//   2. resolve `date` (given, else today's UTC date / next segment)
//   3. KV read-through  (X-Isfar-Cache: hit|miss)
//   4. abuse scaffolding: daily upstream CEILING counter + optional Turnstile
//   5. call AeroDataBox, map via the pure mapFlight()
//   6. store in KV with TTL, return record
//
// Everything is wrapped so a stack never leaks; unexpected upstream failure
// degrades to 503 { found:false, error:"busy" }.

import { mapFlight } from "./map.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ADB_HOST = "aerodatabox.p.rapidapi.com";

/* ----------------------------------------------------------------------- *
 * small response helpers
 * ----------------------------------------------------------------------- */

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Same-origin app; CORS kept permissive-but-harmless for read-only GET.
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

const notfound = (code, headers) => json({ found: false, error: "notfound", code }, 404, headers);
const busy = (headers) => json({ found: false, error: "busy" }, 503, headers);

/* ----------------------------------------------------------------------- *
 * date helpers
 * ----------------------------------------------------------------------- */

/** Today's date in UTC as YYYY-MM-DD. */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** TTL in seconds: 6h for today/future, 30d for past flights. */
function ttlSeconds(resolvedDate) {
  return resolvedDate < todayUtc() ? 60 * 60 * 24 * 30 : 60 * 60 * 6;
}

/* ----------------------------------------------------------------------- *
 * abuse-protection scaffolding (real values wired in Wave 1)
 * ----------------------------------------------------------------------- */

/**
 * Hard daily ceiling on UPSTREAM calls, independent of per-IP rate limiting
 * (which is a Cloudflare native rule — see wrangler.toml). Backed by a KV
 * counter `upstream:count:{YYYY-MM-DD}`. Returns true when we may proceed.
 *
 * Note: KV is eventually-consistent, so this is a soft ceiling — good enough
 * as a cost backstop, not a precise quota. Per-IP burst protection is the
 * native rule; this just caps total RapidAPI spend per day.
 */
async function underDailyCeiling(env) {
  const ceiling = Number(env.CEILING);
  if (!Number.isFinite(ceiling) || ceiling <= 0) return true; // unset/invalid -> no ceiling
  const key = `upstream:count:${todayUtc()}`;
  const current = Number((await env.FLIGHT_CACHE.get(key)) || 0);
  return current < ceiling;
}

/** Increment the daily upstream counter (best-effort). */
async function bumpDailyCounter(env) {
  const key = `upstream:count:${todayUtc()}`;
  const current = Number((await env.FLIGHT_CACHE.get(key)) || 0);
  // 48h TTL so yesterday's key self-evicts.
  await env.FLIGHT_CACHE.put(key, String(current + 1), { expirationTtl: 60 * 60 * 48 });
}

/**
 * Verify a Cloudflare Turnstile token. No-op (returns true) when
 * TURNSTILE_SECRET is unset, so we can launch without Turnstile and wire it
 * in later without code changes. Only ever called on cache-miss.
 */
async function verifyTurnstile(token, secret, ip) {
  if (!secret) return true; // Turnstile deferred -> skip
  if (!token) return false;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    const data = await res.json();
    return data && data.success === true;
  } catch {
    return false; // fail closed on verification error
  }
}

/* ----------------------------------------------------------------------- *
 * AeroDataBox
 * ----------------------------------------------------------------------- */

/**
 * Fetch the segment array for {flightNumber} on {date}. Returns:
 *   { ok:true, segments:[...] }            on 200
 *   { ok:false, status:404 }               on 404/empty -> caller -> notfound
 *   { ok:false, status:<n> }               on other upstream error -> busy
 */
async function fetchAeroDataBox(flightNumber, date, env) {
  const url =
    `https://${ADB_HOST}/flights/number/${encodeURIComponent(flightNumber)}/${date}` +
    `?withLocation=true`;
  const res = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": env.RAPIDAPI_KEY || "",
      "X-RapidAPI-Host": ADB_HOST,
    },
  });

  if (res.status === 404) return { ok: false, status: 404 };
  if (!res.ok) return { ok: false, status: res.status };

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: 502 };
  }

  // AeroDataBox returns an ARRAY of segments. Some plans return a {flights:[]}
  // envelope or a single object — normalise all three.
  let segments = [];
  if (Array.isArray(data)) segments = data;
  else if (data && Array.isArray(data.flights)) segments = data.flights;
  else if (data && typeof data === "object" && data.number) segments = [data];

  if (!segments.length) return { ok: false, status: 404 };
  return { ok: true, segments };
}

/**
 * Pick the segment to map. With a concrete date AeroDataBox usually returns the
 * day's segments; we pick the earliest scheduled departure on/after `date`,
 * falling back to the first. (Codeshares like BA286/SV124 resolve to whichever
 * real operating segment the upstream returns.)
 */
function pickSegment(segments, date) {
  const dated = segments
    .map((s) => ({ s, dep: s?.departure?.scheduledTime?.utc || s?.departure?.scheduledTime?.local }))
    .filter((x) => x.dep)
    .sort((a, b) => String(a.dep).localeCompare(String(b.dep)));

  if (!dated.length) return segments[0];

  // Prefer the first segment whose local departure date matches the requested
  // date; otherwise the chronologically-first one (next departure semantics).
  const onDate = dated.find((x) => String(x.s?.departure?.scheduledTime?.local || "").startsWith(date));
  return (onDate || dated[0]).s;
}

/* ----------------------------------------------------------------------- *
 * main handler
 * ----------------------------------------------------------------------- */

async function handleFlight(request, env) {
  const url = new URL(request.url);

  // 1. normalize code exactly like data.js:82
  const code = String(url.searchParams.get("code") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!code) {
    // Blank input is a client-side concern (data.js -> {error:"empty"}); the
    // Worker treats a missing code as notfound-with-empty-code for safety.
    return notfound("", { "X-Isfar-Cache": "miss" });
  }

  // 2. resolve date
  const rawDate = url.searchParams.get("date");
  const resolvedDate = rawDate && ISO_DATE.test(rawDate) ? rawDate : todayUtc();
  // NOTE (Wave 1): true "next scheduled departure >= now" needs an upstream
  // schedule lookup; for now we default to today's UTC date and let
  // pickSegment() choose the chronologically-first matching segment. The
  // resolved date is always echoed back to the client via record.dateISO.

  // 3. KV read-through
  const cacheKey = `flight:${code}:${resolvedDate}`;
  const cached = await env.FLIGHT_CACHE.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "X-Isfar-Cache": "hit",
      },
    });
  }
  const missHeaders = { "X-Isfar-Cache": "miss" };

  // 4a. Turnstile (only on miss; no-op when secret unset)
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const tsToken = request.headers.get("CF-Turnstile-Token") || "";
  const tsOk = await verifyTurnstile(tsToken, env.TURNSTILE_SECRET, ip);
  if (!tsOk) return busy(missHeaders); // failed challenge -> "try again shortly"

  // 4b. daily upstream ceiling
  if (!(await underDailyCeiling(env))) return busy(missHeaders);

  // 5. upstream call (count it)
  await bumpDailyCounter(env);
  const adb = await fetchAeroDataBox(code, resolvedDate, env);

  if (!adb.ok) {
    if (adb.status === 404) return notfound(code, missHeaders);
    return busy(missHeaders); // other upstream failure
  }

  const seg = pickSegment(adb.segments, resolvedDate);
  const record = mapFlight(seg);

  // mapFlight returns notfound on non-recoverable gaps (missing coords/tz).
  if (!record.found) return notfound(code, missHeaders);

  // 6. store + return. Cache under both the requested date and the record's
  // own resolved dateISO so a date-less lookup and a dated lookup share state.
  const ttl = { expirationTtl: ttlSeconds(resolvedDate) };
  const body = JSON.stringify(record);
  await env.FLIGHT_CACHE.put(cacheKey, body, ttl);
  if (record.dateISO && record.dateISO !== resolvedDate) {
    await env.FLIGHT_CACHE.put(`flight:${code}:${record.dateISO}`, body, ttl);
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      ...missHeaders,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "CF-Turnstile-Token, content-type",
            "access-control-max-age": "86400",
          },
        });
      }

      if (url.pathname === "/api/flight") {
        if (request.method !== "GET") return json({ found: false, error: "notfound", code: "" }, 405);
        return await handleFlight(request, env);
      }

      // Anything else under this Worker's route isn't ours.
      return json({ found: false, error: "notfound", code: "" }, 404);
    } catch (err) {
      // Never leak a stack. Any unexpected failure is "busy".
      return busy();
    }
  },
};

// Exposed for tests / reuse.
export { verifyTurnstile, fetchAeroDataBox, pickSegment, ttlSeconds };
