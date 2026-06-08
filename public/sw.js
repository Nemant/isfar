/* ===========================================================================
   Isfar — service worker
   Makes the app available offline (airplane mode) and installable.

   Strategy:
   - Same-origin app files → NETWORK-FIRST (always fresh when online, falls
     back to cache when offline). Navigations fall back to the cached shell.
   - Cross-origin requests (none ship by default now that fonts + React + adhan
     are bundled same-origin) → CACHE-FIRST, cached on first use.

   PRECACHE: the CORE list below is GENERATED at build time from the Astro build
   output by scripts/gen-sw-precache.mjs — every emitted asset (hashed JS/CSS,
   self-hosted font woff2, the shell, manifest, icons, og-cover) is precached so
   the very first offline load works. Do NOT hand-edit the list — re-run the
   build. The cache name is bumped each cutover so stale assets are purged.
   =========================================================================== */

const CACHE = "isfar-v6";

// __PRECACHE__ — replaced at build time with the real, hashed asset list.
const CORE = ["/"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // add individually so a single failure doesn't abort the whole install
    await Promise.allSettled(CORE.map((u) => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // network-first: fresh when online, cached when offline
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await caches.match("/index.html", { ignoreSearch: true }) ||
                        await caches.match("/", { ignoreSearch: true });
          if (shell) return shell;
        }
        throw err;
      }
    })());
  } else {
    // cache-first for any cross-origin resources
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
