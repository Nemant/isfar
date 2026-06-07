/* ===========================================================================
   Isfar — service worker
   Makes the app available offline (airplane mode) and installable.

   Strategy:
   - Same-origin app files → NETWORK-FIRST (always fresh when online, falls
     back to cache when offline). Navigations fall back to the cached shell.
   - Cross-origin libraries + fonts (immutable, versioned) → CACHE-FIRST, and
     are cached on first use so they're there next time you're offline.
   =========================================================================== */

const CACHE = "isfar-v1";

// Core shell precached on install so the very first offline load works.
const CORE = [
  "index.html",
  "styles.css",
  "data.js",
  "engine.js",
  "tweaks-panel.jsx",
  "components.jsx",
  "arc.jsx",
  "cards.jsx",
  "app.jsx",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "https://unpkg.com/react@18.3.1/umd/react.development.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js",
  "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js",
  "https://cdn.jsdelivr.net/npm/adhan@4.4.3/lib/bundles/adhan.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Hanken+Grotesk:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;600&display=swap"
];

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
          const shell = await caches.match("index.html", { ignoreSearch: true });
          if (shell) return shell;
        }
        throw err;
      }
    })());
  } else {
    // cache-first for CDN libraries + fonts
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
