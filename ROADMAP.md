# Isfar — Product & Engineering Roadmap

## Status (updated 2026-06-08) — Milestone 1 SHIPPED ✅

**`isfar.app` is live**: real, abuse-protected flight lookups rendered in dual time zones, on the
current no-build stack. Hosting turned out to be **two Cloudflare Workers under one domain via
routes** (not Pages — Cloudflare's "Connect to Git" now creates a static-asset Worker):
- **`isfar`** — the static SPA, GitHub-connected → **auto-deploys on every push** to `Nemant/isfar`
  `main`; serves `isfar.app/*`.
- **`isfar-flight`** — the `/api` backend; serves `isfar.app/api/*` (more-specific route wins).

Operational ids/gotchas live in the `isfar-cloud-infra` memory.

**Done**
- ✅ **Phase A½ — Rename Rihla → Isfar** (identifiers, `localStorage` keys, `.isfar` class, entry
  file `index.html`, Arabic wordmark إسفار, SW cache `isfar-*`).
- ✅ **Phase B — SEO Phase 0** (title/meta, OG/Twitter, JSON-LD WebApplication+FAQ, robots,
  sitemap — all on `isfar.app`). *Self-hosting fonts deferred → follow-ups.*
- ✅ **Phase A (A0–A4) — Real flight lookup (Milestone 1):**
  - A0 AeroDataBox validated live (SV124/QF10/EK215 map cleanly).
  - A1 Worker `GET /api/flight` + `Intl`-derived zone/gmt/date, strict-ISO times.
  - A2 KV `FLIGHT_CACHE` read-through (verified miss→hit via `X-Isfar-Cache`).
  - A3 abuse protection: **KV cache** + **per-IP edge rate limit** (10 req/10s — free plan caps the
    window at 10s; verified 10×200→429, client maps 429→`busy`) + **daily `CEILING=1000`** upstream
    bill cap. **Turnstile deferred** (rate-limit + ceiling already cap the bill).
  - A4 client `lookupRemote` + async submit + `offline`/`busy` ErrorState; `useRemoteApi()` hits
    same-origin `/api/flight` in prod, the sample table locally; curated sample chips stay local.
  - **End-to-end Playwright-verified on `isfar.app`** with a real non-sample flight (BA117 LHR→JFK).
- ✅ Domain `isfar.app` + `www` wired (parking records replaced; Namecheap MX/SPF email kept);
  `favicon.ico` added; browser console clean.

**Left**
- ✅ **User/billing decisions:** AeroDataBox **paid tier** picked; **RapidAPI key rotated**.
- ⏳ **Generate additional RapidAPI/AeroDataBox keys to bypass the 1 QPS limit** — the current key
  caps at ~1 request/sec upstream; pool several keys (round-robin in the Worker) to raise effective
  throughput before any wider launch.
- ✅ **Phase C — Astro port** (Wave 2): SSG shell + one `client:only` React island, Babel dropped,
  `window.*`→ES imports, SW precache-from-manifest (`isfar-v18`). *(A first port shipped then
  reverted over theme/iOS-chrome hydration; this re-attempt uses `client:only` to avoid SSR.)*
- ⏳ **Phase D — SEO build-out** (programmatic route/guide pages, i18n) — now unblocked by C.
  **First guide page SHIPPED 2026-06-09:** the far-north methodology story is live at
  `/guide/far-north-prayer-times/` (`src/pages/guide/far-north-prayer-times.astro`) with all six
  wishlist animations (`src/components/blog/Anim*.astro`), a full multi-lens review pass
  (numbers re-verified via `scripts/verify-blog-times.mjs`), FAQ + BlogPosting JSON-LD, sitemap
  entry, and two-way internal links (app sheet/banner ↔ guide). Draft + production notes remain
  at `docs/blog/2026-06-09-prayer-times-far-north.md`.
  **Wave 1 SHIPPED 2026-06-11** (design: `docs/superpowers/specs/2026-06-11-seo-phase-d-design.md`):
  48 programmatic route pages (`/prayer-times/{from}-to-{to}/`, engine-computed seasonal prayer
  tables, per-route FAQ + Breadcrumb JSON-LD) + hub; **i18n wave 1** — full Arabic mirror
  (`/ar/…`, RTL, hreflang both ways) + `/ar/` landing; crawlable homepage (visible FAQ from
  `faq-home.js`, how-it-works, footer, sr-only h1); 404 page; sitemap generated at build
  (101 URLs, en/ar alternates); `?from=&to=` deep-link prefill; SEO pages excluded from the SW
  precache (v22).

  **Phase-D forward timeline (data-gated — expansion follows Search Console, never bulk dumps):**
  | Date | Work |
  |---|---|
  | 2026-06-12 | [User] GSC + Bing properties, submit sitemap. [Claude] DNS TXT verification record. |
  | 2026-06-18 | Guide #2: "How to pray on a plane" (the head query). |
  | 2026-06-25 | Route wave 2 (+~100, GSC-informed) · Guide #3: "Qibla on a plane". |
  | 2026-07-09 | i18n wave 2: app island Arabic (RTL UI), Arabic guides; Urdu route pages if GSC warrants. |
  | 2026-07-23 | Route wave 3 (purely GSC-driven; prune zero-impression pages) · Guide #4: qasr & jam'. |
  | 2026-08-06 | i18n wave 3: Indonesian + Turkish; hreflang audit. |
  | 2026-12-09 | Guide #5: "Fasting on a flight" (~10 weeks before Ramadan 2027). |
  | ongoing | Per-route OG images; off-page (Product Hunt, Muslim-travel communities — user-driven). |
- ⏳ **Follow-ups:** true "next departure ≥ now" date resolution; per-flight cruise altitude.
  (See *Tracked follow-ups*.)

The phase detail below is the original plan, kept for context; this Status block is the current truth.

---

## Context

Rihla today is a no-build static app (plain HTML + in-browser React via Babel Standalone +
adhan-js) that maps the five prayers across a flight, using a **placeholder flight table** in
`data.js`. Two needs push it past pure-static hosting:

1. **Real flight lookup** requires calling a paid flight API (AeroDataBox) whose **API key cannot
   live in client JS** — it needs a server-side proxy. That same proxy is where **caching** and
   **abuse protection** (so scrapers can't run up the API bill) live.
2. The previous `SEO.md` plan already committed the project to a **build step** (drop Babel) and
   **prerendered pages** — i.e. a port to a framework. We choose **Astro** (static pages + one
   React island) as the long-term foundation.

**Decisions locked with the user:**
- **Hosting:** Cloudflare (Pages for static, Workers for the keyed lookup, KV for cache). Chosen
  for best-in-class *free* abuse protection (rate limiting, Turnstile, WAF) — directly protects
  the user's wallet — and because the operator complexity lands on Claude, not the user.
- **Flight API:** AeroDataBox via RapidAPI.
- **First milestone:** Real flight lookup working (highest-risk part first).
- **Domain:** `isfar.app` (purchased), wired from day one (keeps `/api/*` and the site
  same-origin → no CORS; sets canonical URLs correctly for SEO).
- **Brand:** the app is being renamed **Rihla → Isfar** ("Rihla" is overcrowded). See Phase A½.

**Division of labor:** User drives prompting, review, QA, tool/account setup, and billing. Claude
drives all engineering, infra config (via Wrangler CLI + Cloudflare MCP), and deploys.

This document supersedes the former `SEO.md` and is the single source of truth covering
API/caching, abuse protection, the Astro port, *and* the original SEO phases. It is committed to
`main` and updated as work lands.

---

## Execution architecture — the orchestration layer (how to run this in parallel)

The roadmap below is sequenced *by dependency*. This section sits **above** it and says how to
execute concurrently with sub-agents, where work fans out, and how agents avoid colliding.

**Default: maximum *safe* parallelism.** Fan everything out concurrently up to the only three real
limits — (a) genuine task dependencies (the serial chains called out below), (b) your human/billing
gates, and (c) file-ownership safety (no two live agents editing the same file). Nothing is run
serially "to be tidy"; if two things *can* run at once without colliding, they do.

### Two principles that unlock all the parallelism

1. **The true bottleneck is human setup, not compute.** A sub-agent cannot create your RapidAPI
   account, pay for a tier, or move your domain's nameservers. So the schedule is built to **start
   all account/billing setup up front, in parallel**, while Claude + agents do *every*
   account-independent task concurrently underneath it. The critical path is your setup wall-clock,
   not ours — so we overlap as much engineering with it as possible.
2. **Freeze the API contract early → Worker and client build in parallel.** The moment the
   `/api/flight` request signature **and** the JSON record shape are frozen (a one-page spec the
   orchestrator owns), the Worker track and the client track become independent: the Worker is
   built against AeroDataBox; the client is built against a **static mock fixture** of that exact
   shape. They only meet at integration. This converts a serial A1→A4 chain into two parallel lanes.

### Orchestration model

- **Main thread = Orchestrator (Claude).** Owns three things only: (a) freezing the contract spec
  and the human-gate checklist, (b) assigning each agent a **disjoint set of files** it alone may
  edit, (c) integration + QA (Playwright). The orchestrator does not hand-edit files an active
  agent owns.
- **File-ownership rule (prevents merge collisions).** Concurrency is safe only when parallel
  agents touch *different* files. Files touched by multiple streams — `Rihla.html` `<head>`,
  `data.js`, `components.jsx` — get a **single owning agent** per wave, or are serialized by the
  orchestrator. Use **git-worktree isolation** only where parallel agents must mutate overlapping
  files (e.g. the Astro scaffold vs. the live app).
- **Fan-out tooling.** Independent same-shape tasks (SEO Phase-0 files, per-module global→import
  conversions, programmatic SEO pages) run as a `Workflow` `parallel()`/`pipeline()`; long-lived
  asymmetric work (Worker vs. client) runs as a small number of dedicated background agents the
  orchestrator polls and integrates.

### Dependency DAG (what gates what)

```
[USER SETUP — do all in parallel, up front]
  S1 Cloudflare+Wrangler ─┐
  S2 RapidAPI/AeroDataBox ─┼─► (gates A0 deploy/validate)
  S3 Domain→Cloudflare ────┤
  S4 GitHub→Pages ─────────┘   S5 Turnstile (deferrable)

[CONTRACT FREEZE] ──► unlocks Worker lane AND client lane simultaneously

Worker lane:  A0(validate, needs S2) ─► A1(map) ─► A2(KV) ─► A3(abuse: rate|ceiling|turnstile fan-out)
Client lane:  A4(lookupRemote + app.jsx await + ErrorState)  ──built against MOCK──┐
                                                                                   ├─► INTEGRATE ─► Ship M1
SEO Phase 0 (B): fully independent ── fan out from minute one ─────────────────────┘ (parallel, no gates)
Astro (C): needs M1 shipped ─► scaffold can PREP early in a worktree ─► globals→imports fan-out ─► SW v2
SEO build-out (D): needs C ─► programmatic route/guide pages = pipeline() over routes
```

### Parallel schedule (waves)

**Wave 0 — zero accounts required, start immediately (everything here runs concurrently):**
- *You:* kick off **all** of S1–S4 in parallel (each is independent).
- *Orchestrator:* write the **contract spec** (endpoint + record shape) — this is the keystone.
- *Agent group α (SEO Phase 0 / Track B):* fan out ~5 disjoint-file agents — (1) `<title>`+meta+
  canonical+lang, (2) OG/Twitter tags + generate `og-cover.png`, (3) JSON-LD `WebApplication`+
  `FAQPage`, (4) `robots.txt`+`sitemap.xml` (new files), (5) self-host fonts in `styles.css`+
  `/fonts`. Only (1)(2)(3) touch `Rihla.html` `<head>` → **one agent owns the head**, the others
  hand it diffs to apply, or serialize those three. No accounts needed.
- *Agent β (Worker code):* author the Worker + AeroDataBox mapping + KV logic against the
  documented schema (no live key yet) in a worktree — ready to validate the instant S2 lands.
- *Agent γ (Client wiring):* build `data.js` `lookupRemote` + `app.jsx:139-147` await + `ErrorState`
  branches against a **mock fixture** of the frozen record shape. Verifiable with Playwright
  offline (mock = no account).
- *Agent δ (Astro scaffold prep):* stand up the Astro skeleton in an **isolated worktree** (no
  cutover) so it's ready for Wave 2.

**Wave 1 — accounts have landed → make lookups real (Worker lane serial, client integrates):**
- A0 validate AeroDataBox against the 5 sample flights → confirm/adjust the mapping in Agent β's code.
- Deploy Worker (S1+S3) → A2 KV cache → A3 abuse protection. A3's three pieces (edge rate-limit
  rule, KV daily-ceiling counter, Turnstile) are **independent → fan out**.
- Swap Agent γ's mock for the live `/api/flight`; orchestrator integrates + Playwright end-to-end.
- **Ship Milestone 1.**

**Wave 2 — foundation + scale (after M1):**
- Promote Agent δ's Astro scaffold; **fan out global→import conversions** — one agent each for
  `engine.js`→module, `Ic`/icons, `data.js` constants, components — disjoint files, then integrate.
- Regenerate SW precache from the build manifest, bump `rihla-v2` (single owner of `sw.js`).
- Phase D: **`pipeline()` over routes** — each route page generate→verify as its own item; same for
  guides; then i18n.

### What is genuinely serial (don't fake-parallelize)

- A0→A1→A2→A3 *within* the Worker lane (each needs the prior). Parallelism is *across* lanes, not
  inside this chain.
- Integration points (mock→live swap; scaffold→cutover; `rihla-v1`→`v2`) are **single-owner
  barriers** — one agent, orchestrator-supervised, never concurrent.
- Anything mutating `engine.js`'s consumer contract — it must stay frozen, so it's read-only to all
  agents except a deliberate, reviewed change.

### Net effect

Your account setup (the real wall-clock floor) runs while **SEO Phase 0 ships, the Worker is fully
coded, the client is built against a mock, and the Astro scaffold is prepped** — so the instant
your accounts are live, Wave 1 is mostly *validate + deploy + integrate*, not *build from scratch*.

---

## Tooling, MCPs & connectors (setup — user assists, Claude drives)

These get set up once, near the start. **[User]** = needs the user's account/billing/click;
**[Claude]** = Claude does it once access exists.

| What | Who | How |
|---|---|---|
| **Cloudflare account** | [User] | Create/confirm a Cloudflare account (free plan is enough to start). |
| **Wrangler CLI auth** | [User→Claude] | Claude installs Wrangler. User runs `! npx wrangler login` in-session (interactive OAuth) **or** creates a scoped API token and pastes it as `CLOUDFLARE_API_TOKEN`. Then Claude drives Workers/KV/secrets via Wrangler in Bash. |
| **Cloudflare MCP server** (optional, higher-level ops) | [User→Claude] | Add Cloudflare's remote MCP (Workers/KV/observability) via `claude mcp add` — Claude will supply the exact current endpoint at setup time and confirm it connects. Wrangler is the primary path; MCP is a convenience layer. |
| **RapidAPI + AeroDataBox subscription** | [User] | Create RapidAPI account, subscribe to AeroDataBox (pick a tier — Claude will recommend one after validating coverage). Copy the RapidAPI key. |
| **Worker secrets** | [User→Claude] | User provides the RapidAPI key, Turnstile secret, and an HMAC key value; Claude sets them via `wrangler secret put` (`RAPIDAPI_KEY`, `TURNSTILE_SECRET`, `SESSION_HMAC_KEY`). Secrets never touch git or client. |
| **Cloudflare Turnstile widget** | [User] | Create a Turnstile site in the Cloudflare dashboard (invisible/managed mode); share the **site key** (public, Claude embeds it) and **secret key** (Worker secret). *May be deferred — see Phase 2 note.* |
| **Custom domain → Cloudflare** | [User→Claude] | User points the domain's nameservers to Cloudflare (or adds it as a zone). Claude configures DNS records, the `/api/*` Worker route, and the Pages project. |
| **GitHub → Cloudflare Pages** | [User→Claude] | Repo is `Nemant/isfar`. `gh` CLI already available for PRs. User authorizes Cloudflare Pages to access the repo; Claude configures the build. |
| **Playwright MCP** | [already available] | Used by Claude for browser QA/verification of UI and end-to-end lookup. |

### Secret handling (the repo is PUBLIC — this is non-negotiable)

The RapidAPI key (and any other secret) **never enters git, `wrangler.toml`, or client JS**. It
lives in exactly two places, both outside the repo:

- **Production → Cloudflare Secrets.** `npx wrangler secret put RAPIDAPI_KEY` stores it encrypted in
  Cloudflare; the Worker reads it at runtime as `env.RAPIDAPI_KEY`. The repo references only the
  *name*. (Same for `TURNSTILE_SECRET`, `SESSION_HMAC_KEY`.)
- **Local dev → `worker/.dev.vars`** (gitignored). `wrangler dev` reads it; never committed.
- **`.gitignore`** excludes `.dev.vars`, `.env*`, `.wrangler/` — the guardrail against an accidental
  public leak.
- **Keeping the key out of Claude's transcript:** the **user** runs `wrangler secret put` and the A0
  validation call themselves via `!` so the value flows terminal→Cloudflare/RapidAPI, never through
  the model context. Claude provides the exact commands and a validation script that prints only the
  flight JSON (never the key).

---

## The plan, by phase

### Phase A — Real flight lookup (Milestone 1) ✅ SHIPPED — *the primary track*

Ships real lookups **on the current no-build app** first, de-risking the data layer before any
framework change. The contract: whatever the Worker returns is reshaped into the **exact**
`data.js` record so `app.jsx`/`engine.js` need **no changes**.

**A0. Validate AeroDataBox first (before building anything).** Manually call AeroDataBox for the 5
sample routes in `data.js` (SV124, BA286, QF10, EK215, DY394). Confirm it returns airport
`location {lat,lon}` (`withLocation=true`) and IANA `timeZone` for both ends. These two fields are
non-recoverable — the engine NaNs without them. `aircraft`/`city` gaps are cosmetic. This
validation gates the API-tier recommendation.

**A1. Cloudflare Worker — `GET /api/flight?code=SV124&date=YYYY-MM-DD`.**
- Normalize `code` server-side exactly like `data.js:82`; resolve `date` to a concrete day —
  **default = next scheduled departure ≥ now** (a bare flight number recurs daily; the resolved
  date is surfaced to the user so prayer windows match the right day).
- AeroDataBox endpoint: `GET /flights/number/{flightNumber}/{date}?withLocation=true` (RapidAPI
  host header + key). Response is an array of segments; pick the matching/next one.
- **Field mapping** (AeroDataBox → RIHLA record): direct for `lat/lon`, `tz`, `iata`, airline,
  times; **derived in-Worker via `Intl`** for `zone` (e.g. "BST"), `gmt` ("GMT+1"), and the human
  `date` string; `depUTC`/`arrUTC` reformatted to strict ISO `…T..:..:..Z`; `cruiseAltFt` omitted
  (engine defaults 38000). Missing `lat/lon` or `tz` ⇒ return `{found:false, error:"notfound"}`
  rather than a broken record.

**A2. KV cache (read-through) — the cost shield.**
- Namespace `FLIGHT_CACHE`; key `flight:{code}:{resolvedDate}`; value = the shaped record.
- TTL: today/future flights 6h; past flights 30d (immutable history → great for offline replay).
- Read-through: cache hit ⇒ return instantly, **no upstream call, $0**. This makes repeat lookups
  and recents-clicks free across all users.

**A3. Abuse protection (layered, ordered — caps the bill regardless of traffic).**
1. **KV cache** — first defense; re-requested flights never reach the paid API.
2. **Cloudflare native Rate Limiting rule** on `/api/flight` (e.g. 30 req/60s per IP) — runs at the
   edge before the Worker even executes. Recommended over an in-Worker counter.
3. **Hard daily upstream ceiling** — a KV counter incremented only on *actual* AeroDataBox calls;
   at `CEILING` (a number the user picks as their budget) the Worker stops calling upstream and
   returns a soft "busy" error. This is the absolute bill cap.
4. **Turnstile (invisible)** — verify only on cache-miss, cache the result in a short-lived signed
   session token so repeat lookups feel instant. *May launch without it* (rate-limit + ceiling
   already cap the bill) and add it if abuse appears — keeps the calm UX pristine initially.

**A4. Client wiring — make lookup async (minimal diff).**
- `data.js`: add `lookupRemote(raw, date)` returning the **same shapes** as today. Keep
  client-side normalization + format regex + empty check so `format`/`empty` errors render with no
  round-trip (existing `ErrorState`, `components.jsx:312`).
- `app.jsx:139-147`: make the `setTimeout` callback `async`; replace the sync `lookup()` at
  `app.jsx:141` with `await …lookupRemote(...)`. Keep a **minimum loading dwell** (~1.2s) so the
  calm loading animation never flickers on fast cache hits. `setRaw`/`recordRecent`/`compute` and
  recents (`app.jsx:67-78`) stay unchanged.
- Add two small `ErrorState` branches: `offline` ("Saved flights still work; connect to look up a
  new one") and `busy` ("try again shortly"). Offline path serves the SW-cached `/api/flight`
  response when available.

**Done when:** a real flight number returns live data on the deployed custom domain; repeat
lookups are served from KV (verify $0/no upstream); rate-limit + daily ceiling demonstrably cap
upstream calls; saved flights re-display offline.

### Phase A½ — Brand rename (Rihla → Isfar) ✅ DONE — *do early, before deploy + SEO indexing*

A single careful sweep, best done **before** the Worker/KV/Pages cloud resources are created and
before any SEO content gets indexed as "Rihla" (no users yet ⇒ changing `localStorage` keys is
free). This is **serial, not parallel** — it touches nearly every file, so one owner does it as one
atomic change.

- **Identifiers:** `window.RIHLA_DATA/RIHLA_ENGINE/RIHLA_API_BASE` → `ISFAR_*`; `localStorage`
  `rihla.settings/recents/theme` → `isfar.*`; CSS root class `.rihla[data-theme]` → `.isfar`;
  SW cache `rihla-v1` → `isfar-v1` (the version bump also purges old caches cleanly).
- **Entry file:** rename `Rihla.html` → **`index.html`** so `https://isfar.app/` serves it directly
  (matches canonical root); update `manifest.webmanifest` `start_url`/`name`/`short_name`, the SW
  precache list + shell fallback (`sw.js`), and any in-repo references.
- **Copy & assets:** header wordmark "Rihla" → "Isfar"; the Arabic wordmark (currently رحلة) → the
  user's chosen Arabic spelling for Isfar **(needs user input — see open items)**; `manifest` name;
  `og-cover` wordmark (folds into the OG regen follow-up); `README.md`, `CLAUDE.md`,
  `worker/CONTRACT.md`/fixtures comments, `ROADMAP.md` self-references.
- **Cloud naming:** name the Worker/Pages project and `wrangler.toml` `name` `isfar-*` from the
  start; KV namespace can stay `FLIGHT_CACHE`.
- **Done when:** no case-insensitive `rihla` remains except deliberate historical notes; app boots,
  sample flights render, theme/recents persist under the new keys; Playwright-verified.

### Phase B — SEO Phase 0 ✅ DONE (fonts deferred) — (parallel track, no accounts needed)

Can run alongside Phase A since it touches only HTML/static files. Real `<title>`/meta
description, Open Graph + Twitter cards (+ `og-cover.png`), canonical + lang, JSON-LD
(`WebApplication` + `FAQPage`), `robots.txt` + `sitemap.xml`, self-host fonts. Pure win, helps
regardless of the framework choice, nothing thrown away by the later port.

### Phase C — Astro port ✅ SHIPPED (Wave 2) — (the long-term foundation)

> **Shipped 2026-06-08 (2nd attempt).** A first port reached prod and was reverted over theme-FOUC /
> iOS-chrome hydration. The shipped version uses **one `client:only="react"` island** (never
> server-rendered → no hydration mismatch), self-hosted fonts via `public/fonts/` + `@font-face`
> (not `@fontsource`), and SW cache **`isfar-v18`** (precache generated by `scripts/gen-sw-precache.mjs`).
> Design + plan: `docs/superpowers/specs/2026-06-08-astro-port-design.md`. The plan text below is the
> original intent, kept for context.

After lookups work. **Strangler migration — the app stays runnable throughout.**
- Structure: static `index.astro` + future `routes/[slug]` / `guides/[slug]` pages (zero-JS, for
  SEO); the entire calculator becomes **one React island** (`Calculator`, hydrated `client:load`/
  `client:idle`) — the cohesive `#root` tree extracts cleanly.
- Retire `window.*` globals → ES imports: `engine.js`→module, `Ic`/components→imports,
  `data.js` constants→`constants.ts`; `adhan` becomes an npm dep; **Babel Standalone deleted**
  (Astro/Vite compiles at build).
- **Offline preserved:** SSG emits static files; regenerate the SW precache list from the build
  manifest (don't hand-maintain hashes); bump cache name `rihla-v1`→`rihla-v2` (`sw.js:12`) so the
  old jsx precache is purged. The island runs client-side exactly like today; localStorage recents
  + KV-backed SW-cached responses keep saved-flight offline working.
- **Worker stays standalone** on the `/api/*` route (not converted to an Astro endpoint) — it owns
  KV/rate-limit/Turnstile/ceiling and was already shipped in Phase A; don't rewrite it. Pages
  serves the static Astro output; same custom domain ⇒ still same-origin, still no CORS.
- **Retire** the `tweaks-panel.jsx` `__edit_mode_*` postMessage host bridge from the production
  bundle (dev-editor tooling, no end-user value); user-facing theme/warmth tweaks stay.

### Phase D — SEO build-out (the payoff for choosing Astro)

Former `SEO.md` Phases 1–4, now cheap because Astro generates them: precompiled perf (Babel already
gone), programmatic per-route pages (`/prayer-times/lhr-to-jed/`), guide content hub, then i18n
(`hreflang`, RTL) — Arabic/Urdu/Indonesian/Turkish/Malay. Off-page: Search Console + sitemap
submission, Muslim-travel/Hajj-Umrah community links.

**Content drafted ahead of the hub:**
- `docs/blog/2026-06-09-prayer-times-far-north.md` — "Praying by a sun that won't set": the
  high-latitude methodology story (angles → latitude → where each scholarly convention breaks →
  the 60°N floor + city table → summer-vs-winter per-prayer table → what Isfar does). Credits
  moonsighting.com; explicitly non-fiqhi. Includes an animation/illustration wishlist (tilted
  Earth, twilight-angle diagram, shrinking sun-dip, collapsing-night dial, 60th-parallel zoom,
  Tromsø year wheel — in the app's calm sun-arc visual language) and a publication checklist
  (re-verify quoted times against the engine, citation depth for the city table, internal links).

---

## Recommended build order (end to end)

1. Tooling setup (Cloudflare account + Wrangler auth + RapidAPI/AeroDataBox + domain on Cloudflare).
2. **A0** validate AeroDataBox against the 5 sample flights → recommend an API tier.
3. **A1–A2** Worker + AeroDataBox mapping + KV cache.
4. **A3** abuse protection (rate-limit → daily ceiling → Turnstile last/optional).
5. **A4** async client wiring → **ship Milestone 1** on the current stack.
6. **B** SEO Phase 0 (can overlap from step 1).
7. **C** Astro skeleton → convert globals to imports → SW precache from manifest (`rihla-v2`).
8. **D** programmatic SEO pages + guides + i18n; submit sitemap.

---

## Critical files

- `data.js:81-87` — add async `lookupRemote`; reshape Worker JSON to the record; keep
  normalization/regex/error shapes.
- `app.jsx:139-147` — `await` the fetch; min-dwell loading; recents (`:67-78`) unchanged.
- `engine.js:170-292` — **consumer contract; must remain unchanged.** Reads `depUTC`/`arrUTC`/
  `from.{lat,lon,tz,iata}`/`to.{…}`/`cruiseAltFt`(default 38000); verify nothing breaks.
- `components.jsx:312` — add `offline`/`busy` `ErrorState` branches; retire `Ic`/component
  `window` exports (`:238`) during the Astro port.
- `sw.js:12,15-33` — precache list + cache name change at the Astro cutover; same-origin handler
  already covers `/api/*`.
- New: Worker (`worker/` + `wrangler.toml`), Astro project (`src/…`).

---

## Verification

- **AeroDataBox mapping:** Phase A0 manual calls confirm `lat/lon` + IANA `tz` for all 5 sample
  routes before building the cache.
- **Worker:** `curl https://<domain>/api/flight?code=SV124` returns a complete record; a 2nd call
  is served from KV (check logs / a `cache: hit` debug header) with **no upstream call**.
- **Abuse caps:** a burst loop trips the rate-limit (429); simulate the daily ceiling and confirm
  upstream calls stop at `CEILING`.
- **End-to-end UI:** drive `Rihla.html` (then the Astro build) with **Playwright MCP** — enter a
  real flight, confirm prayers render in both time zones; toggle offline and confirm a saved flight
  still displays and a *new* lookup shows the `offline` copy.
- **Offline/PWA after Astro:** test an install→update cycle; confirm `rihla-v2` purges old assets
  and the app loads offline.
- **SEO Phase 0:** view-source shows title/meta/JSON-LD (not JS-injected); Google Rich Results
  Test passes; `robots.txt`/`sitemap.xml` fetch 200.

---

## Tracked follow-ups (small; slot into the waves above)

- [x] ~~**Swap `PLACEHOLDER_DOMAIN` → `isfar.app`**~~ — done (canonical/OG/Twitter/JSON-LD, robots, sitemap).
- [x] ~~**Worker `wrangler.toml` TODOs**~~ — KV id filled; `CEILING=1000`; `/api/*` route + rate-limit
      live (set via the **zone Worker-Routes API**, not the `wrangler.toml` routes block, since the
      SPA is a separate GitHub-connected Worker). The `[[routes]]` block in `worker/wrangler.toml`
      stays commented — routing is managed on the zone.
- [x] ~~**Regenerate `og-cover.png`**~~ — done: rendered at 1200×630 in a headless browser with
      Newsreader "Isfar" + إسفار, the dusk sky-arc + five prayer dots, and a tagline. `og:image`/
      `twitter:image` bumped to `?v=2` to cache-bust social scrapers.
- [ ] **Self-host fonts** (deferred from SEO Phase 0; this is SEO Phase 1): replace the Google Fonts
      `<link>` with local `@font-face` (Newsreader, Hanken Grotesk, Noto Kufi Arabic) + `/fonts`;
      update the SW precache. Kills a render-blocking round-trip → better LCP.
- [ ] **Date resolution:** Worker currently uses "today UTC + first matching segment"; implement true
      "next departure ≥ now" + the optional date chip already present in the UI.
- [ ] **Favicon source:** `favicon.ico` is downscaled from `icon-192.png` via Pillow (`pip install`
      in the sandbox). If the brand mark changes, regenerate it.

## Open items the user owns (billing/accounts/decisions)

- [x] ~~**Pick an AeroDataBox paid tier**~~ — done.
- [x] ~~**Rotate the RapidAPI key**~~ — done.
- [ ] **Generate additional RapidAPI/AeroDataBox keys to bypass the 1 QPS limit** — the active key
      caps upstream at ~1 request/sec. Provision several keys and round-robin them in the Worker
      (each as its own secret, e.g. `RAPIDAPI_KEY_1..N`) to raise effective throughput before a
      wider launch.
- [x] ~~Daily upstream `CEILING`~~ — set to **1000**.
- [x] ~~Turnstile launch vs defer~~ — **deferred** (rate-limit + ceiling cap the bill).
- [x] ~~Arabic wordmark for "Isfar"~~ — **إسفار**.
- [x] ~~Domain + Cloudflare + secrets + GitHub hosting~~ — all wired; site auto-deploys on push.
